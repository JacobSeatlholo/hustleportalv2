import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { systemBlastAudience } from '@/lib/audience'

// GET /api/admin/exec/campaigns/audience — the honest roster readout for the
// "everyone on the system" blast audience. Exec seat only.
//
// GET /api/admin/exec/campaigns/audience?source=<tag> — what ONE campaign's
// own history can serve an "Add email" follow-up: who it actually reached
// (SENT rows), how many opened, and one sample account so the draft preview
// greets by a real name. No addresses are returned in bulk: staging recomputes
// the same law server side (POST followUp), so the number the boss reads here
// is the number that queues, nothing more.

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const params = new URL(req.url).searchParams
  const source = params.get('source')?.trim().toLowerCase()
  if (source) {
    const sentRows = await db.emailLog.findMany({
      where: { campaign: source, status: 'SENT' },
      select: { toEmail: true, openedAt: true },
    })
    // One row per address; when an address was mailed twice, opened wins.
    const reached = new Map<string, boolean>()
    for (const r of sentRows) reached.set(r.toEmail, reached.get(r.toEmail) || Boolean(r.openedAt))
    const total = reached.size
    const opened = [...reached.values()].filter(Boolean).length
    // A real account among the openers, so the preview greets the way the
    // merge will (first name, then business name, then the honest "there").
    let sample: { name: string; email: string } | null = null
    const openers = [...reached.entries()].filter(([, o]) => o).map(([e]) => e)
    if (openers.length > 0) {
      const acct = await db.user.findFirst({
        where: { email: { in: openers } },
        select: { email: true, name: true, businessName: true },
      })
      const first = acct ? (acct.name || '').trim().split(/\s+/)[0] : ''
      sample = acct
        ? { name: first || (acct.businessName || '').trim() || 'there', email: acct.email }
        : { name: 'there', email: openers[0] }
    }
    return NextResponse.json({
      ok: true,
      source: { tag: source, found: sentRows.length > 0, total, opened, unopened: total - opened, sample },
    })
  }

  const skipPaying = params.get('skipPaying') !== 'false'
  const { segments } = await systemBlastAudience({ skipPaying })
  return NextResponse.json({ ok: true, skipPaying, segments })
}
