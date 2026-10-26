import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { ensureExecAdmin, isExecEmail, type ExecUser } from '@/lib/admin'

/**
 * Session secret policy (hardened):
 *  - Production REQUIRES process.env.AUTH_SECRET, there is no fallback a
 *    stranger could read in the repo. Boot fails loudly without it, which is
 *    the correct behaviour for a live deployment carrying real accounts.
 *  - Outside production (sandbox/dev) a random per-boot secret is generated,
 *    so every developer run is self-contained and nothing guessable ships.
 */
function loadSecret(): Uint8Array {
  const env = process.env.AUTH_SECRET?.trim()
  if (env && env.length >= 16) return new TextEncoder().encode(env)
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is missing or too short, refusing to sign sessions with a guessable key.')
  }
  const g = globalThis as { __hpDevSecret?: Uint8Array }
  if (!g.__hpDevSecret) {
    const bytes = crypto.getRandomValues(new Uint8Array(48))
    g.__hpDevSecret = new TextEncoder().encode(Buffer.from(bytes).toString('hex'))
  }
  return g.__hpDevSecret
}

const SECRET = loadSecret()
const COOKIE = 'hp_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days
const IS_PROD = process.env.NODE_ENV === 'production'

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10)
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash)
}

export async function createSession(userId: string) {
  // Embed the account's session epoch: bumping it (password reset) instantly
  // invalidates every token issued before it.
  const user = await db.user.findUnique({ where: { id: userId }, select: { sessionEpoch: true } })
  const epoch = user?.sessionEpoch ?? 1
  const token = await new SignJWT({ sub: userId, ep: epoch })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(SECRET)
  const store = await cookies()
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD, // HTTPS only in production (Caddy terminates TLS)
    path: '/',
    maxAge: MAX_AGE,
  })
  // The login stamp: the win-back engine's only honest "when were they last
  // here". Best effort, a failed stamp must never block a successful login.
  try {
    await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
  } catch (e) {
    console.error('[auth] lastLoginAt stamp failed:', e instanceof Error ? e.message : e)
  }
}

export async function destroySession() {
  const store = await cookies()
  store.delete(COOKIE)
}

export async function getUserId(): Promise<string | null> {
  try {
    const store = await cookies()
    const token = store.get(COOKIE)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ['HS256'] })
    const sub = (payload.sub as string) || null
    if (!sub) return null
    // A paused (suspended) account is locked out of EVERYTHING immediately,
    // the JWT itself stays valid, but the person behind it no longer does.
    const status = await db.user.findUnique({
      where: { id: sub },
      select: { accountStatus: true, sessionEpoch: true },
    })
    if (!status || status.accountStatus === 'SUSPENDED') return null
    // Session epoch check: tokens issued before a password reset carry no ep
    // claim (treated as epoch 1) or a stale one, both die the moment the
    // epoch moves, so a stolen cookie cannot outlive the owner's new password.
    const tokenEpoch = typeof payload.ep === 'number' ? payload.ep : 1
    if (tokenEpoch !== (status.sessionEpoch ?? 1)) return null
    return sub
  } catch {
    return null
  }
}

/**
 * Invalidate every existing session for this account (password reset/change).
 * The next createSession() after this issues tokens under the new epoch.
 */
export async function bumpSessionEpoch(userId: string) {
  await db.user.update({ where: { id: userId }, data: { sessionEpoch: { increment: 1 } } }).catch(() => {})
}

export async function getSessionUser() {
  const userId = await getUserId()
  if (!userId) return null
  let user = await db.user.findUnique({
    where: { id: userId },
    include: { wallet: true, memberships: { include: { team: true } } },
  })
  if (!user) return null
  // Master account self-heal: the owner's exec flags appear on session load
  // without touching anything else on the account.
  if (isExecEmail(user.email) && (user.role !== 'ADMIN' || !user.platformAdmin)) {
    const healed = await ensureExecAdmin(user as unknown as ExecUser)
    user = { ...user, role: healed.role, platformAdmin: healed.platformAdmin }
  }
  return user
}

/** Lightweight current-user lookup (id + role) for capability checks. */
export async function getUser(): Promise<{ id: string; role: string } | null> {
  const userId = await getUserId()
  if (!userId) return null
  return db.user.findUnique({ where: { id: userId }, select: { id: true, role: true } })
}

export function publicUser(u: {
  id: string
  email: string
  name: string
  businessName?: string | null
  industry?: string | null
  city?: string | null
  phone?: string | null
  videoTheme?: string | null
  role: string
  xp: number
  persona?: string | null
  profession?: string | null
  onboardedAt?: Date | null
  createdAt: Date
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    businessName: u.businessName || null,
    industry: u.industry || null,
    city: u.city || null,
    phone: u.phone || null,
    videoTheme: u.videoTheme || null,
    role: u.role,
    xp: u.xp,
    persona: u.persona || null,
    profession: u.profession || null,
    onboardedAt: u.onboardedAt || null,
    createdAt: u.createdAt,
  }
}
