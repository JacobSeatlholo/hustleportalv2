import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { readCampaignStates, unsubscribeUrl } from '@/lib/campaignqueue'
import { TEAM_INBOX, sendCampaignMailViaSes, sendCampaignMail } from '@/lib/mailer'

/**
 * TASK 177 ONE-TIME DOOR (deleted after use — Task 146/174/176 pattern).
 * Token-gated POST, no session, no GET, nothing here ever sends except the
 * one explicitly boss-ordered action: a single goldrush test mail to the
 * boss's own gmail. Read actions return counts and first-party campaign
 * addresses only; the audit copy lands in tool-results/ and the door dies.
 *
 *  status         campaign queue overview + open/pipeline linkage stats
 *  backfillOpens  link already-OPENED leadId-null campaign rows to the
 *                 sender's own bench Lead rows (NEW -> CONTACTED), the same
 *                 law the pixel route applies from now on — only read
 *                 receipts move rows, silence never does
 *  sendTest       ONE themed test mail (theme forced goldrush) to the boss's
 *                 gmail, using the live staged draft + the campaign's own
 *                 From/provider lane; idempotent, max one send ever
 */

const DOOR_TOKEN = 'ba9ee3a155d72a07534b382dd940de08cce49a2fb031dfa8'
const TEST_TARGET = 'seatlholojacob@gmail.com'
const TEST_TAG = 'theme-test-goldrush'

function tokenOk(req: NextRequest): boolean {
  const got = req.headers.get('x-door-token') || ''
  if (!got || got.length !== DOOR_TOKEN.length) return false
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(DOOR_TOKEN))
  } catch {
    return false
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(req: NextRequest) {
  if (!tokenOk(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = String(body.action || '')

  // --------------------------------------------------------------- status
  if (action === 'status') {
    const [rows, states, suppressionTotal, bouncedTotal] = await Promise.all([
      db.emailLog.findMany({
        where: { campaign: { not: null } },
        orderBy: { createdAt: 'asc' },
        take: 6000,
        select: {
          id: true, campaign: true, toEmail: true, status: true, error: true,
          openedAt: true, openCount: true, leadId: true, userId: true, sentAt: true,
        },
      }),
      readCampaignStates(),
      db.suppression.count(),
      db.emailLog.count({ where: { campaign: { not: null }, status: 'BOUNCED' } }),
    ])

    const per: Record<string, { queued: number; sent: number; failed: number; bounced: number; skipped: number; opened: number; leadLinked: number; total: number }> = {}
    const failedErrors: Record<string, number> = {}
    for (const r of rows) {
      const tag = r.campaign as string
      const c = (per[tag] ||= { queued: 0, sent: 0, failed: 0, bounced: 0, skipped: 0, opened: 0, leadLinked: 0, total: 0 })
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
      if (r.openedAt) c.opened++
      if (r.leadId) c.leadLinked++
    }

    // Linkage viability for the new pixel-route fallback: of the leadId-null
    // campaign rows, how many already have a same-owner Lead row we can move?
    const unlinked = rows.filter((r) => !r.leadId && EMAIL_RE.test(r.toEmail))
    const emails = [...new Set(unlinked.map((r) => r.toEmail.toLowerCase()))].slice(0, 2000)
    const userIds = [...new Set(unlinked.map((r) => r.userId))]
    const benchRows = emails.length
      ? await db.lead.findMany({
          where: { email: { in: emails }, userId: { in: userIds }, stage: { in: ['NEW', 'CONTACTED'] } },
          select: { id: true, userId: true, email: true, stage: true },
        })
      : []
    const benchKey = new Map(benchRows.map((l) => [`${l.userId}|${(l.email || '').toLowerCase()}`, l.stage]))
    let unlinkedWithBenchNew = 0
    let unlinkedWithBenchContacted = 0
    for (const r of unlinked) {
      const st = benchKey.get(`${r.userId}|${r.toEmail.toLowerCase()}`)
      if (st === 'NEW') unlinkedWithBenchNew++
      if (st === 'CONTACTED') unlinkedWithBenchContacted++
    }

    const openedDetail = rows
      .filter((r) => r.openedAt)
      .map((r) => ({
        campaign: r.campaign,
        toEmail: r.toEmail,
        openedAt: r.openedAt,
        openCount: r.openCount,
        status: r.status,
        leadLinked: Boolean(r.leadId),
      }))

    return NextResponse.json({
      ok: true,
      now: new Date().toISOString(),
      replyTo: TEAM_INBOX,
      suppressionTotal,
      campaignBouncedTotal: bouncedTotal,
      campaigns: Object.keys(per).map((tag) => ({ tag, state: states[tag] || null, counts: per[tag] })),
      failedErrors,
      linkage: {
        campaignRows: rows.length,
        leadLinked: rows.filter((r) => r.leadId).length,
        leadNull: unlinked.length,
        leadNullWithBenchNew: unlinkedWithBenchNew,
        leadNullWithBenchContacted: unlinkedWithBenchContacted,
      },
      openedDetail,
    })
  }

  // --------------------------------------------------------- backfillOpens
  if (action === 'backfillOpens') {
    const opened = await db.emailLog.findMany({
      where: { campaign: { not: null }, openedAt: { not: null }, leadId: null },
      take: 1000,
      select: { id: true, userId: true, toEmail: true },
    })
    const emails = [...new Set(opened.map((r) => r.toEmail.toLowerCase()))]
    const userIds = [...new Set(opened.map((r) => r.userId))]
    const leads = emails.length
      ? await db.lead.findMany({
          where: { email: { in: emails }, userId: { in: userIds }, stage: { in: ['NEW', 'CONTACTED'] } },
          select: { id: true, userId: true, email: true, stage: true },
          orderBy: { createdAt: 'asc' },
        })
      : []
    const firstLead = new Map<string, { id: string; stage: string }>()
    for (const l of leads) {
      const k = `${l.userId}|${(l.email || '').toLowerCase()}`
      if (!firstLead.has(k)) firstLead.set(k, { id: l.id, stage: l.stage })
    }
    let linked = 0
    let flipped = 0
    for (const r of opened) {
      const lead = firstLead.get(`${r.userId}|${r.toEmail.toLowerCase()}`)
      if (!lead) continue
      await db.emailLog.update({ where: { id: r.id }, data: { leadId: lead.id } })
      linked++
      if (lead.stage === 'NEW') {
        const claim = await db.lead.updateMany({
          where: { id: lead.id, stage: 'NEW' },
          data: { stage: 'CONTACTED' },
        })
        if (claim.count === 1) flipped++
      }
    }
    return NextResponse.json({ ok: true, openedRows: opened.length, linked, flippedToContacted: flipped })
  }

  // -------------------------------------------------------------- sendTest
  if (action === 'sendTest') {
    // Idempotent: the door sends AT MOST ONE test mail, ever. A second call
    // just reports the first one.
    const existing = await db.emailLog.findFirst({
      where: { campaign: TEST_TAG },
      select: { id: true, status: true, error: true, providerId: true, sentAt: true },
    })
    if (existing) return NextResponse.json({ ok: true, already: true, test: existing })

    // The live staged draft: the treg JHB campaign if it exists, else the
    // cold-intro queue. Subject/body exactly as staged — the boss sees what
    // HIS recipients see, only through the goldrush chrome.
    const source =
      (await db.emailLog.findFirst({
        where: { campaign: 'treg-intro-2026-11-jhb' },
        orderBy: { createdAt: 'asc' },
        select: { subject: true, body: true, userId: true },
      })) ||
      (await db.emailLog.findFirst({
        where: { campaign: 'cold-intro-2026-11' },
        orderBy: { createdAt: 'asc' },
        select: { subject: true, body: true, userId: true },
      }))
    if (!source) return NextResponse.json({ error: 'No staged draft found to preview.' }, { status: 404 })

    const states = await readCampaignStates()
    const state = states['treg-intro-2026-11-jhb'] || states['cold-intro-2026-11']

    const row = await db.emailLog.create({
      data: {
        userId: source.userId,
        toEmail: TEST_TARGET,
        subject: source.subject,
        body: source.body,
        status: 'QUEUED',
        provider: 'PLATFORM',
        campaign: TEST_TAG,
      },
    })

    const mail = {
      to: TEST_TARGET,
      subject: source.subject,
      body: source.body,
      from: state?.from,
      theme: 'goldrush' as const,
      pixelUrl: `https://www.hustleportal.online/api/mail/open/${row.id}`,
      unsubscribeUrl: unsubscribeUrl(row.id),
    }
    const r = state?.provider === 'RESEND'
      ? await sendCampaignMail(mail)
      : await sendCampaignMailViaSes(mail)

    await db.emailLog.update({
      where: { id: row.id },
      data: r.ok
        ? { status: 'SENT', sentAt: new Date(), providerId: r.providerId ?? null, error: null }
        : { status: 'FAILED', sentAt: new Date(), error: (r.error || 'send failed').slice(0, 500) },
    })
    return NextResponse.json({
      ok: r.ok,
      test: {
        id: row.id, to: TEST_TARGET, subject: source.subject, theme: 'goldrush',
        from: mail.from, lane: state?.provider || 'SES(default)', via: r.via, providerId: r.providerId,
        error: r.ok ? undefined : r.error,
      },
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
