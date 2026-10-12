import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'

const PAUSE_DAYS = 30

/**
 * POST /api/subscribe/pause { action: 'pause' | 'resume' }
 *
 * Pause freezes the plan for 30 days instead of losing the member to a cancel:
 *  - status flips to PAUSED, pausedUntil = +30 days.
 *  - The plan auto-resumes after pausedUntil (GET /api/subscribe) and renewsAt
 *    shifts by the frozen duration — every paid day is preserved.
 *  - Early resume shifts renewsAt by exactly the frozen time so far.
 * PAUSED members keep app access (plan reads as active in GET).
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json().catch(() => ({}))
  const sub = await db.subscription.findUnique({ where: { userId } })
  if (!sub) return NextResponse.json({ error: 'No subscription to pause.' }, { status: 404 })

  if (String(action).toLowerCase() === 'pause') {
    if (sub.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Only an active plan can be paused.' }, { status: 400 })
    }
    const pausedUntil = new Date(Date.now() + PAUSE_DAYS * 24 * 60 * 60 * 1000)
    const updated = await db.subscription.update({
      where: { id: sub.id },
      data: { status: 'PAUSED', pausedUntil },
    })
    return NextResponse.json({ ok: true, subscription: updated, note: `Plan paused until ${pausedUntil.toDateString()} — your days are frozen, not lost.` })
  }

  if (String(action).toLowerCase() === 'resume') {
    if (sub.status !== 'PAUSED' || !sub.pausedUntil) {
      return NextResponse.json({ error: 'The plan is not paused.' }, { status: 400 })
    }
    const pausedFrom = sub.pausedUntil.getTime() - PAUSE_DAYS * 24 * 60 * 60 * 1000
    const frozenMs = Math.max(0, Date.now() - pausedFrom)
    const updated = await db.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        pausedUntil: null,
        ...(sub.renewsAt ? { renewsAt: new Date(sub.renewsAt.getTime() + frozenMs) } : {}),
      },
    })
    return NextResponse.json({ ok: true, subscription: updated })
  }

  return NextResponse.json({ error: 'Unknown action — use pause or resume.' }, { status: 400 })
}
