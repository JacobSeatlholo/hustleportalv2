import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'hustleportal-dev-secret-change-in-prod-2026'
)
const COOKIE = 'hp_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10)
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash)
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(SECRET)
  const store = await cookies()
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
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
    const { payload } = await jwtVerify(token, SECRET)
    return (payload.sub as string) || null
  } catch {
    return null
  }
}

export async function getSessionUser() {
  const userId = await getUserId()
  if (!userId) return null
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { wallet: true, memberships: { include: { team: true } } },
  })
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
  role: string
  xp: number
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
    role: u.role,
    xp: u.xp,
    createdAt: u.createdAt,
  }
}
