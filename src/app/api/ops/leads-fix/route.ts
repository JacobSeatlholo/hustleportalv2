import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * ONE-TIME DOOR #2 — Task 174 verify-pass repair (Task 146 precedent).
 * The MX verify pass on the staged cold list found exactly two queued rows
 * whose domains cannot receive mail at all (no MX, no A record): a QA probe
 * artifact and a truncated scrape. Both are certain hard bounces, and the
 * review's own law says stale rows never ride a blast. This door flips ONLY
 * those two QUEUED rows to SKIPPED with an honest note, returns the queue
 * summary, and dies. It never sends anything and cannot touch any other row.
 */

const DOOR_TOKEN = '709866ce3589f21fee284c7c36bd2b5bf803a1f8fab9df86'
const CAMPAIGN_TAG = 'cold-intro-2026-11'
const DEAD = ['probe@example.co.za', 'n@ramjee.aesthe']
const NOTE = 'Verify pass: domain has no MX record, would hard bounce (Task 174, pre-Start)'

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const rows = await db.emailLog.findMany({
    where: { campaign: CAMPAIGN_TAG, toEmail: { in: DEAD } },
    select: { id: true, toEmail: true, status: true },
  })

  const queued = rows.filter((r) => r.status === 'QUEUED')
  if (queued.length === 0) {
    return NextResponse.json({
      ok: true,
      flipped: 0,
      rows,
      note: 'Nothing in QUEUED state among the dead-domain rows. The door changes nothing.',
    })
  }

  const res = await db.emailLog.updateMany({
    where: { campaign: CAMPAIGN_TAG, status: 'QUEUED', toEmail: { in: queued.map((r) => r.toEmail) } },
    data: { status: 'SKIPPED', error: NOTE },
  })

  const [q, s, total] = await Promise.all([
    db.emailLog.count({ where: { campaign: CAMPAIGN_TAG, status: 'QUEUED' } }),
    db.emailLog.count({ where: { campaign: CAMPAIGN_TAG, status: 'SKIPPED' } }),
    db.emailLog.count({ where: { campaign: CAMPAIGN_TAG } }),
  ])

  return NextResponse.json({
    ok: true,
    flipped: res.count,
    flippedTo: 'SKIPPED',
    note: NOTE,
    queueSummary: { queued: q, skipped: s, total },
  })
}
