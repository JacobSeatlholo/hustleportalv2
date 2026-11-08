import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { tregBalanceMicro, tregToolsCatalog } from '@/lib/tregverify'

export const dynamic = 'force-dynamic'

/**
 * ONE-TIME DOOR (Task 146 precedent) — Task 176 recon: (1) treg's live team
 * balance + full tool catalog, to answer "will the balance hold for a search
 * of 1000 relevant people"; (2) current status of the two awkward cold-intro
 * inboxes (Yoco support, Justice complaints) plus the whole tag's bounce
 * state, for the worst-case question; (3) bench + today's send progress.
 * READ-ONLY: no sends, no writes, no token/PII beyond the tag's own rows.
 * Used once, deleted in the same session.
 */

const DOOR_TOKEN = 'df77ae6da4536c067370b1797617dd36ec635b41253fe933'

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

const PLATFORM_SOURCES = ['WEB', 'AI_SEARCH', 'POOL', 'OSM', 'EXPLEE']

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const TAG = 'cold-intro-2026-11'
  const AWKWARD = ['support@yoco.com', 'complaints.ir@justice.gov.za']
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)

  const [
    balanceMicro,
    catalog,
    tagCounts,
    tagRows,
    awkwardRows,
    suppressAwkward,
    suppressTotal,
    benchBySource,
    benchUntouchedSample,
    sentToday,
    sesConfig,
    probeSpend,
    abandonedPending,
  ] = await Promise.all([
    tregBalanceMicro({ fresh: true }),
    tregToolsCatalog(),
    db.emailLog.groupBy({ by: ['status'], where: { campaign: TAG }, _count: { _all: true } }),
    db.emailLog.findMany({
      where: { campaign: TAG, status: { in: ['BOUNCED', 'FAILED', 'COMPLAINT'] } },
      select: { toEmail: true, status: true, error: true, sentAt: true, openedAt: true },
    }),
    db.emailLog.findMany({
      where: { toEmail: { in: AWKWARD } },
      select: { toEmail: true, subject: true, status: true, error: true, provider: true, campaign: true, sentAt: true, openedAt: true, openCount: true, createdAt: true },
    }),
    db.suppression.findMany({ where: { email: { in: AWKWARD } }, select: { email: true, reason: true, note: true, createdAt: true } }),
    db.suppression.count(),
    db.lead.groupBy({
      by: ['source'],
      where: { stage: 'NEW', email: { not: null } },
      _count: { _all: true },
    }),
    db.lead.findMany({
      where: {
        stage: 'NEW',
        email: { not: null },
        source: { in: PLATFORM_SOURCES },
        emailLogs: { none: {} },
      },
      select: { email: true, source: true, company: true, city: true },
      take: 30,
    }),
    db.emailLog.count({ where: { status: 'SENT', sentAt: { gte: dayStart } } }),
    Promise.resolve({
      webhookSecretSet: Boolean(process.env.SES_WEBHOOK_SECRET?.trim()),
      configSetSet: Boolean(process.env.SES_CONFIG_SET?.trim()),
    }),
    (async () => {
      try {
        const row = await db.platformConfig.findUnique({ where: { key: 'TREG_PROBE_SPEND' } })
        return row?.value ? Number(row.value) : 0
      } catch {
        return null
      }
    })(),
    db.topUp.count({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 30 * 60_000) } } }),
  ])

  // untouched bench count (full, no cap) — the sample above is capped at 30
  const benchUntouchedCount = await db.lead.count({
    where: {
      stage: 'NEW',
      email: { not: null },
      source: { in: PLATFORM_SOURCES },
      emailLogs: { none: {} },
    },
  })

  return NextResponse.json({
    ok: true,
    treg: {
      enabled: (process.env.TREG_TOKEN || process.env.TREG_API_TOKEN || '').trim().length > 20,
      balanceMicro,
      probeSpendMicro: probeSpend,
      catalog,
    },
    campaign: {
      tag: TAG,
      counts: tagCounts.map((c) => ({ status: c.status, count: c._count._all })),
      bounceFailRows: tagRows,
    },
    awkward: { rows: awkwardRows, suppression: suppressAwkward },
    suppressionTotal: suppressTotal,
    bench: {
      bySourceWithNewEmail: benchBySource.map((b) => ({ source: b.source, count: b._count._all })),
      platformUntouchedCount: benchUntouchedCount,
      platformUntouchedSample: benchUntouchedSample,
    },
    progress: { sentTodayUtc: sentToday },
    sesFeedback: sesConfig,
    abandonedCheckoutsPending: abandonedPending,
  })
}
