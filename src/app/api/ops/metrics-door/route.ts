import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isProbeEmail, isInternalEmail } from '@/lib/probe'
import { isExecEmail } from '@/lib/admin'

/**
 * ONE-TIME metrics door (Task 146 precedent: built, read, deleted in the same
 * session). Exists for a single purpose: return PLATFORM-LEVEL AGGREGATE
 * counters for the boss's growth review. No names, no emails, no bodies, no
 * personal data of any kind leaves through here — only counts, sums and
 * campaign slugs. The token is a one-shot random hex embedded for one deploy
 * cycle; the route is deleted immediately after the read. GET only.
 */
const DOOR_TOKEN = '629aa07ee48b72df063ef9e5340d48c5749b3161a4f7e443'

async function safe<T>(name: string, fn: () => Promise<T>): Promise<Record<string, unknown>> {
  try {
    return { [name]: await fn() }
  } catch (e) {
    return { [name]: { error: (e as Error).message.slice(0, 160) } }
  }
}

export async function GET(req: NextRequest) {
  if ((req.headers.get('x-door-token') || '') !== DOOR_TOKEN) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const now = Date.now()
  const d7 = new Date(now - 7 * 86_400_000)
  const d30 = new Date(now - 30 * 86_400_000)
  const d14 = new Date(now - 14 * 86_400_000)
  const d90 = new Date(now - 90 * 86_400_000)

  // --- seat classification (emails are read ONLY to count; nothing leaves) ---
  const seatRows = await db.user.findMany({ select: { email: true } })
  const seats = { probe: 0, internal: 0, exec: 0 }
  for (const r of seatRows) {
    const e = r.email.toLowerCase().trim()
    if (isProbeEmail(e)) seats.probe++
    else if (isInternalEmail(e)) seats.internal++
    else if (isExecEmail(e)) seats.exec++
  }

  // --- daily buckets (JS-side; only date fields selected) ---
  const [signupRows, mailRows] = await Promise.all([
    db.user.findMany({ where: { createdAt: { gte: d30 } }, select: { createdAt: true } }),
    db.emailLog.findMany({ where: { createdAt: { gte: d30 }, campaign: { not: null } }, select: { createdAt: true, status: true } }),
  ])
  const day = (dt: Date) => dt.toISOString().slice(0, 10)
  const days: string[] = []
  for (let i = 13; i >= 0; i--) days.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10))
  const signupsByDay: Record<string, number> = Object.fromEntries(days.map((k) => [k, 0]))
  for (const r of signupRows) { const k = day(r.createdAt); if (k in signupsByDay) signupsByDay[k]++ }
  const mailByDay: Record<string, { queued: number; sent: number; failed: number }> = Object.fromEntries(days.map((k) => [k, { queued: 0, sent: 0, failed: 0 }]))
  for (const r of mailRows) {
    const k = day(r.createdAt)
    if (!(k in mailByDay)) continue
    if (r.status === 'SENT') mailByDay[k].sent++
    else if (r.status === 'FAILED') mailByDay[k].failed++
    else if (r.status === 'QUEUED') mailByDay[k].queued++
  }

  const results: Record<string, unknown> = {
    takenAt: new Date().toISOString(),
    ...await safe('users', async () => {
      const [total, active7, active30, suspended, admins, onboarded, withLeads, sentMail, winbackTarget] = await Promise.all([
        db.user.count(),
        db.user.count({ where: { lastLoginAt: { gte: d7 } } }),
        db.user.count({ where: { lastLoginAt: { gte: d30 } } }),
        db.user.count({ where: { accountStatus: 'SUSPENDED' } }),
        db.user.count({ where: { platformAdmin: true } }),
        db.user.count({ where: { onboardedAt: { not: null } } }),
        db.user.count({ where: { leads: { some: {} } } }),
        db.user.count({ where: { emailLogs: { some: { status: 'SENT' } } } }),
        db.user.count({ where: { emailLogs: { some: { campaign: { startsWith: 'winback-' } } } } }),
      ])
      const [personas, professions, noStamp] = await Promise.all([
        db.user.groupBy({ by: ['persona'], _count: { _all: true } }),
        db.user.groupBy({ by: ['profession'], _count: { _all: true } }),
        db.user.count({ where: { lastLoginAt: null } }),
      ])
      return { total, activeLast7d: active7, activeLast30d: active30, suspended, platformAdmins: admins, onboarded, everCreatedALead: withLeads, everSentMail: sentMail, everWinbacked: winbackTarget, noLoginStamp: noStamp, seats, personas, professions }
    }),
    ...await safe('signupsByDay30', async () => ({ byDay: signupsByDay, last7d: signupRows.filter((r) => r.createdAt >= d7).length, last30d: signupRows.length })),
    ...await safe('money', async () => {
      const [topups, subs, wallets, creditByType, invoices, subsActiveSum] = await Promise.all([
        db.topUp.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amountCents: true, creditCents: true } }),
        db.subscription.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amountCents: true } }),
        db.wallet.aggregate({ _sum: { balance: true }, _count: { _all: true } }),
        db.creditTx.groupBy({ by: ['type'], _count: { _all: true }, _sum: { amount: true } }),
        db.invoice.groupBy({ by: ['kind', 'status'], _count: { _all: true }, _sum: { total: true } }),
        db.subscription.aggregate({ where: { status: 'ACTIVE' }, _sum: { amountCents: true }, _count: { _all: true } }),
      ])
      return { topups, subscriptions: subs, subscriptionsActive: subsActiveSum, walletCentsTotal: wallets, creditTxByType: creditByType, invoices }
    }),
    ...await safe('leads', async () => {
      const [byStage, bySource, total, unlocked, recent7, recent30, quality, pool, scans, hits, cpl] = await Promise.all([
        db.lead.groupBy({ by: ['stage'], _count: { _all: true } }),
        db.lead.groupBy({ by: ['source'], _count: { _all: true } }),
        db.lead.count(),
        db.lead.count({ where: { unlocked: true } }),
        db.lead.count({ where: { createdAt: { gte: d7 } } }),
        db.lead.count({ where: { createdAt: { gte: d30 } } }),
        db.lead.groupBy({ by: ['qualityFeedback'], _count: { _all: true } }),
        db.leadPool.aggregate({ _count: { _all: true }, _sum: { feedbackGood: true, feedbackBad: true } }),
        db.scanRun.aggregate({ _count: { _all: true } }),
        db.leadPoolHit.aggregate({ _count: { _all: true } }),
        db.clientPoolLead.groupBy({ by: ['status'], _count: { _all: true } }),
      ])
      return { total, byStage, bySource, unlocked, last7d: recent7, last30d: recent30, qualityFeedback: quality, poolTotal: pool, scanRuns: scans, poolHits: hits, clientPoolByStatus: cpl }
    }),
    ...await safe('mail', async () => {
      const [byStatus, byTheme, byProvider, opened, distinctRecips, campaigns, openedByCampaign, winback, byDay30, sentLast7, sentLast30, bouncedEmails] = await Promise.all([
        db.emailLog.groupBy({ by: ['status'], _count: { _all: true } }),
        db.emailLog.groupBy({ by: ['theme'], _count: { _all: true } }),
        db.emailLog.groupBy({ by: ['provider'], _count: { _all: true } }),
        db.emailLog.count({ where: { openCount: { gt: 0 } } }),
        db.emailLog.findMany({ select: { toEmail: true }, distinct: ['toEmail'] }),
        db.emailLog.groupBy({ by: ['campaign'], _count: { _all: true }, where: { campaign: { not: null } }, orderBy: { _count: { campaign: 'desc' } }, take: 12 }),
        db.emailLog.groupBy({ by: ['campaign'], _count: { _all: true }, where: { campaign: { not: null }, openCount: { gt: 0 } } }),
        db.emailLog.groupBy({ by: ['status'], _count: { _all: true }, where: { campaign: { startsWith: 'winback-' } } }),
        db.emailLog.groupBy({ by: ['status'], _count: { _all: true }, where: { createdAt: { gte: d30 }, campaign: { not: null } } }),
        db.emailLog.count({ where: { status: 'SENT', sentAt: { gte: d7 } } }),
        db.emailLog.count({ where: { status: 'SENT', sentAt: { gte: d30 } } }),
        db.emailLog.findMany({ where: { status: 'BOUNCED' }, select: { toEmail: true }, distinct: ['toEmail'] }),
      ])
      return {
        byStatus, byTheme, byProvider, openedRows: opened, distinctRecipients: distinctRecips.length,
        topCampaigns: campaigns, openedByCampaign, winbackRows: winback, campaignRowsLast30d: byDay30,
        sentLast7d: sentLast7, sentLast30d: sentLast30, distinctBounced: bouncedEmails.length,
        mailByDay,
      }
    }),
    ...await safe('workspace', async () => {
      const one = (p: Promise<number>) => p.catch(() => -1)
      const [clients, tasks, projects, appointments, finance, inventory, wa, waLinks, aiUsage, aiMsgs, xp, meetings, referrals, challenges, stmtAcc, stmtEnt, plans] = await Promise.all([
        one(db.client.count()), one(db.task.count()), one(db.project.count()), one(db.appointment.count()),
        one(db.financeEntry.count()), one(db.inventoryItem.count()),
        one(db.waMessage.count()), one(db.waBotLink.count()), one(db.aiUsage.count()), one(db.aiMessage.count()),
        one(db.xpEvent.count()), db.meeting.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => ({ error: 'x' })),
        db.referral.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => ({ error: 'x' })),
        one(db.challengeProgress.count()), one(db.statementAccount.count()), one(db.statementEntry.count()),
        one(db.aiPlan.count()),
      ])
      return { clients, tasks, projects, appointments, financeEntries: finance, inventoryItems: inventory, waMessages: wa, waBotLinks: waLinks, aiUsage, aiMessages: aiMsgs, xpEvents: xp, meetings, referrals, challengeProgress: challenges, statementAccounts: stmtAcc, statementEntries: stmtEnt, aiPlans: plans }
    }),
    ...await safe('suppression', async () => db.suppression.groupBy({ by: ['reason'], _count: { _all: true } })),
    ...await safe('campaignStates', async () => {
      const rows = await db.platformConfig.findMany({ where: { key: { startsWith: 'campaign_state:' } }, select: { key: true, value: true } })
      return rows.map((r) => {
        try { return { tag: r.key.replace('campaign_state:', ''), ...(JSON.parse(r.value) as Record<string, unknown>) } }
        catch { return { tag: r.key, parseError: true } }
      })
    }),
    ...await safe('recentCohort', async () => {
      const rows = await db.user.findMany({ where: { createdAt: { gte: d90 } }, select: { createdAt: true, lastLoginAt: true, onboardedAt: true } })
      const week = (dt: Date) => { const t = dt.getTime(); return String(Math.floor((now - t) / (7 * 86_400_000))) }
      const buckets: Record<string, { n: number; returned: number; onboarded: number }> = {}
      for (const r of rows) {
        const w = week(r.createdAt)
        buckets[w] ||= { n: 0, returned: 0, onboarded: 0 }
        buckets[w].n++
        if (r.lastLoginAt && r.lastLoginAt > r.createdAt) buckets[w].returned++
        if (r.onboardedAt) buckets[w].onboarded++
      }
      return buckets
    }),
  }

  return NextResponse.json(results, { headers: { 'cache-control': 'no-store' } })
}
