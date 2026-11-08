import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { readCampaignStates } from '@/lib/campaignqueue'

/**
 * TASK 178 ONE-TIME READ DOOR (deleted after use — Task 146/174/176/177
 * pattern). Token-gated POST, ONE action, zero send paths, zero writes:
 * the boss's "how goes the campaign now and email health" check.
 */

const DOOR_TOKEN = 'c59150c6692b82ecc80e9a4f2c0f042d081b183b66e42bad'
const READ_SINCE = '2026-11-08T07:17:14.277Z' // the Task 177 status read

function tokenOk(req: NextRequest): boolean {
  const got = req.headers.get('x-door-token') || ''
  if (!got || got.length !== DOOR_TOKEN.length) return false
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(DOOR_TOKEN))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  if (!tokenOk(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (String(body.action || '') !== 'status') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const since = new Date(READ_SINCE)
  const [rows, states, suppressionByReason] = await Promise.all([
    db.emailLog.findMany({
      where: { campaign: { not: null } },
      orderBy: { createdAt: 'asc' },
      take: 6000,
      select: {
        id: true, campaign: true, toEmail: true, status: true, error: true,
        openedAt: true, openCount: true, sentAt: true, createdAt: true,
      },
    }),
    readCampaignStates(),
    db.suppression.groupBy({ by: ['reason'], _count: { _all: true } }),
  ])

  const per: Record<string, {
    queued: number; sent: number; failed: number; bounced: number; skipped: number
    opened: number; total: number; lastSentAt: string | null
    sentSince: number; bouncedSince: number; opensSince: number
  }> = {}
  const failedErrors: Record<string, number> = {}
  for (const r of rows) {
    const tag = r.campaign as string
    const c = (per[tag] ||= {
      queued: 0, sent: 0, failed: 0, bounced: 0, skipped: 0,
      opened: 0, total: 0, lastSentAt: null, sentSince: 0, bouncedSince: 0, opensSince: 0,
    })
    c.total++
    if (r.status === 'QUEUED') c.queued++
    if (r.status === 'SENT') c.sent++
    if (r.status === 'FAILED') {
      c.failed++
      const key = (r.error || 'unknown').slice(0, 120)
      failedErrors[key] = (failedErrors[key] || 0) + 1
    }
    if (r.status === 'BOUNCED') c.bounced++
    if (r.status === 'SKIPPED') c.skipped++
    if (r.openedAt) {
      c.opened++
      if (r.openedAt > since) c.opensSince++
    }
    if (r.sentAt && (r.status === 'SENT' || r.status === 'BOUNCED')) {
      c.lastSentAt = c.lastSentAt && c.lastSentAt > r.sentAt.toISOString() ? c.lastSentAt : r.sentAt.toISOString()
      if (r.sentAt > since) {
        c.sentSince++
        if (r.status === 'BOUNCED') c.bouncedSince++
      }
    }
  }

  // Send velocity since the last read, hourly buckets (UTC), treg campaigns.
  const velocity: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    const tag = r.campaign as string
    if (!tag.startsWith('treg-') || !r.sentAt || r.sentAt <= since) continue
    const bucket = r.sentAt.toISOString().slice(0, 13) // YYYY-MM-DDTHH
    ;(velocity[tag] ||= {})[bucket] = ((velocity[tag] || {})[bucket] || 0) + 1
  }

  const testRow = await db.emailLog.findFirst({
    where: { campaign: 'theme-test-goldrush' },
    select: { status: true, openedAt: true, openCount: true, sentAt: true },
  })

  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    readSince: READ_SINCE,
    suppressionByReason: suppressionByReason.map((s) => ({ reason: s.reason, n: s._count._all })),
    campaigns: Object.keys(per).map((tag) => ({ tag, state: states[tag] || null, counts: per[tag] })),
    velocity,
    failedErrors,
    goldrushTest: testRow,
  })
}
