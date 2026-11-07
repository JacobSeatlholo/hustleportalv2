import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { readCampaignStates } from '@/lib/campaignqueue'

export const dynamic = 'force-dynamic'

/**
 * ONE-TIME DOOR (Task 146 precedent) — Task 175 forensics: what actually left
 * the queue of cold-intro-2026-11 before the boss hit stop. READ-ONLY: every
 * row under the tag with status and timestamps, plus the live campaign state.
 * No sends, no writes, no PII beyond the addresses of the tag's own rows.
 * Used once, deleted in the same session.
 */

const DOOR_TOKEN = 'bf20e72f9bfcb49e01a3283de615c66ddb4dd630d8f5ff17'

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const TAG = 'cold-intro-2026-11'
  const [rows, states, counts] = await Promise.all([
    db.emailLog.findMany({
      where: { campaign: TAG },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, toEmail: true, subject: true, status: true, error: true,
        provider: true, providerId: true, sentAt: true, openedAt: true, createdAt: true,
      },
    }),
    readCampaignStates(),
    db.emailLog.groupBy({
      by: ['status'],
      where: { campaign: TAG },
      _count: { _all: true },
    }),
  ])

  return NextResponse.json({
    ok: true,
    campaign: TAG,
    state: states[TAG] || null,
    counts: counts.map((c) => ({ status: c.status, count: c._count._all })),
    rows,
  })
}
