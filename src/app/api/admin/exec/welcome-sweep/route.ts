import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { runWelcomeSweep, sweepPendingWelcome } from '@/lib/welcomesweep'

// POST /api/admin/exec/welcome-sweep — the boss's run-now control for the
// automated fresh-signup lead sweep.
//
// Body: { userId?: string, force?: boolean }
//   userId missing  -> sweep every eligible recent signup (bounded, 3).
//   userId given    -> sweep that one account. force:true overrides the bench
//                      guard for a deliberate verification run on a QA seat
//                      (the seat is internal-flagged, KPIs stay human-only).
// Every result is the sweep's own honest summary: shipped count, the skip
// reason, or the companies that landed.

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({}))
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  const force = body?.force === true

  if (userId) {
    const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
    if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    const result = await runWelcomeSweep(userId, { force })
    return NextResponse.json({ ok: true, ran: 1, results: [{ email: target.email, ...result }] })
  }

  // No target named: sweep the pending new accounts (never the bench — the
  // guard inside the sweep decides).
  const results = await sweepPendingWelcome(3)
  return NextResponse.json({
    ok: true,
    ran: results.length,
    results: results.map((r) => ({ email: r.email, ...r.result })),
  })
}
