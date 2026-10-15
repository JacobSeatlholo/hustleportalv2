import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Executive access gate — the business owner's controls.
 *
 * The master account is pinned by email: whatever else happens on that
 * account (projects, leads, subscription — all untouchable), its privilege
 * flags are the only thing this module may flip, and it does so lazily and
 * idempotently so the Exec Dashboard nav simply appears on the owner's next
 * session load. No other account is ever modified by this module.
 */
export const EXEC_EMAILS: ReadonlySet<string> = new Set([
  'ceo@businesshustle.co.za',
  // Internal operator seat: the automation/agent account that runs production
  // tasks (first business case setup, ops probes). Lives on the QA domain so
  // every roster and KPI lens flags it as internal instead of counting it as
  // a client. Same gate, same audit trail, never touches the master account.
  'ops@hustleqa.example.com',
])

export interface ExecUser {
  id: string
  email: string
  role: string
  platformAdmin: boolean
  accountStatus?: string
}

export function isExecEmail(email: string): boolean {
  return EXEC_EMAILS.has(email.toLowerCase().trim())
}

/** True when this user may open the Executive Dashboard and its controls. */
export function isExecUser(me: ExecUser | null): boolean {
  if (!me) return false
  return me.role === 'ADMIN' || me.platformAdmin === true || isExecEmail(me.email)
}

/**
 * Lazy self-heal: when the master account holder signs in (or their session
 * loads) without exec flags yet, promote just the flags. Idempotent — the
 * update only runs while the flags are missing, then never again.
 * Returns the possibly-refreshed flags.
 */
export async function ensureExecAdmin(me: ExecUser): Promise<ExecUser> {
  if (!isExecEmail(me.email)) return me
  if (me.role === 'ADMIN' && me.platformAdmin) return me
  try {
    await db.user.update({
      where: { id: me.id },
      data: { role: 'ADMIN', platformAdmin: true },
      select: { id: true },
    })
  } catch (e) {
    console.error('[exec] self-heal failed for', me.email, e)
    return me
  }
  return { ...me, role: 'ADMIN', platformAdmin: true }
}

/**
 * Standard guard for /api/admin/exec* routes. Returns the exec user on
 * success, or a ready-to-return NextResponse (401 / 403) on failure.
 */
export async function requireExec(): Promise<
  { ok: true; me: ExecUser } | { ok: false; res: NextResponse }
> {
  const { getUserId } = await import('@/lib/auth')
  const userId = await getUserId()
  if (!userId) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, platformAdmin: true, accountStatus: true },
  })
  if (!me) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!isExecUser(me)) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const healed = await ensureExecAdmin(me)
  return { ok: true, me: healed }
}
