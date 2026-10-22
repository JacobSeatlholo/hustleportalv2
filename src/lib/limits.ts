/**
 * Free-plan ceilings, the server is the only place a limit is real.
 * Client meters are cosmetic; every route enforces here BEFORE the work happens.
 *
 * The 402 shape is a contract: the client api() helper sees { upgrade: true } and
 * opens the upgrade dialog with the brand voice from upgrade-copy.ts. Callers only
 * ever see a thrown Error with a friendly message, so no screen needs special code.
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { upgradeCopyFor } from '@/lib/upgrade-copy'

export const FREE_LIMITS = {
  /** Real leads per AI search on the free plan. */
  discoverLeads: 5,
  /** Stock items tracked on the free plan. */
  inventoryItems: 3,
  /** Emails sent from the account on the free plan (failed sends never burn one). */
  emailSends: 6,
} as const

/**
 * The caller's plan state with the SAME lazy lifecycle as GET /api/subscribe:
 * PAUSED past its date auto-resumes, ACTIVE past renewsAt decays to PAST_DUE.
 * PAUSED still counts as paid: pausing keeps the plan, it never cancels it.
 */
export async function planState(userId: string): Promise<{ paid: boolean; plan: string }> {
  let sub = await db.subscription.findUnique({ where: { userId } })
  if (!sub) return { paid: false, plan: 'FREE' }

  if (sub.status === 'PAUSED' && sub.pausedUntil && sub.pausedUntil.getTime() <= Date.now()) {
    const shiftMs = 30 * 24 * 60 * 60 * 1000
    sub = await db.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        pausedUntil: null,
        ...(sub.renewsAt ? { renewsAt: new Date(sub.renewsAt.getTime() + shiftMs) } : {}),
      },
    })
  }

  if (sub.status === 'ACTIVE' && sub.renewsAt && sub.renewsAt.getTime() < Date.now()) {
    sub = await db.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } })
  }

  const paid = sub.status === 'ACTIVE' || sub.status === 'PAUSED'
  return { paid, plan: paid ? sub.plan : 'FREE' }
}

/** The one 402 every gate returns. */
export function upgradeJson(feature: string, limit: number): NextResponse {
  const copy = upgradeCopyFor(feature)
  return NextResponse.json(
    { error: copy.notice, upgrade: true, feature, limit },
    { status: 402 },
  )
}
