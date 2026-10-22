import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { requireExec, isExecEmail } from '@/lib/admin'
import { db } from '@/lib/db'
import { getYocoKeyMode, getYocoWebhookSecret } from '@/lib/yoco'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import { isProbeEmail, isInternalEmail } from '@/lib/probe'

// GET /api/admin/exec, the Executive Dashboard feed: platform KPIs + the full
// client roster (plan, account status, wallet, activity). Exec only.
//
// The lens shows the REAL business. Every automated probe address, house owned
// account (staff, demo, e2e) and the owner's own seat is excluded from the KPIs
// and the newest members spotlight, and flagged on roster rows, so the numbers
// the owner acts on are humans only. Test bench rows stay visible on the roster.
const isNoiseEmail = (email: string) => isProbeEmail(email) || isInternalEmail(email) || isExecEmail(email)

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const now = Date.now()
  const d7 = new Date(now - 7 * 86_400_000)
  const d30 = new Date(now - 30 * 86_400_000)

  const [userCount, new7rows, new30rows, subs, topups30, wallets, leadCount, poolNew, poolArrivals24h, poolByUser, recentPaid, webhookSecret, webhookModeRow, meetings, meetingTallyRows] = await Promise.all([
    db.user.count(),
    db.user.findMany({ where: { createdAt: { gte: d7 } }, select: { email: true } }),
    db.user.findMany({ where: { createdAt: { gte: d30 } }, select: { email: true } }),
    db.subscription.findMany({
      include: { user: { select: { email: true, name: true, businessName: true } } },
    }),
    // The money lens counts HUMANS only: every test bench top up (sandbox rows
    // and test era card rows on probe wallets) is noise, never revenue.
    db.topUp.findMany({
      where: { status: 'PAID', paidAt: { gte: d30 } },
      select: { amountCents: true, provider: true, user: { select: { email: true } } },
    }),
    db.wallet.findMany({ select: { balance: true, user: { select: { email: true } } } }),
    db.lead.count(),
    db.clientPoolLead.count({ where: { status: 'NEW' } }),
    db.clientPoolLead.count({ where: { createdAt: { gte: new Date(now - 86_400_000) } } }),
    db.clientPoolLead.groupBy({ by: ['userId'], where: { status: 'NEW' }, _count: { _all: true } }),
    // The money pulse: latest settled payments, newest first.
    db.topUp.findMany({
      where: { status: 'PAID' },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      select: { id: true, userId: true, amountCents: true, creditCents: true, provider: true, reference: true, createdAt: true, paidAt: true },
    }),
    getYocoWebhookSecret(),
    getConfig(CONFIG_KEYS.YOCO_WEBHOOK_MODE),
    // Facilitated meetings: the newest 20 for the Meetings card.
    db.meeting.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, title: true, memberName: true, memberEmail: true, memberBusiness: true,
        guestName: true, guestEmail: true, startsAt: true, endsAt: true, meetLink: true,
        location: true,
        status: true, invitedAt: true, confirmedAt: true, createdAt: true,
        shareToken: true,
        _count: { select: { comments: true } },
      },
    }),
    // The whole book for the KPI tally (tiny table), so "Meetings set" counts
    // real humans only, not the QA suite practicing on itself.
    db.meeting.findMany({ select: { status: true, memberEmail: true, guestEmail: true } }),
  ])

  const new7 = new7rows.filter((u) => !isNoiseEmail(u.email)).length
  const new30 = new30rows.filter((u) => !isNoiseEmail(u.email)).length

  // Lazy subscription truth: ACTIVE only while renewsAt stands; PAUSED, PAST_DUE, CANCELED as-is.
  // MRR counts live Yoco plans on human accounts only, so QA activations never
  // dress up the revenue number. Non-live plans stay visible in the roster.
  const activeSubs = subs.filter((s) => s.status === 'ACTIVE' && (!s.renewsAt || s.renewsAt.getTime() >= now))
  const liveSubs = activeSubs.filter((s) => s.provider === 'YOCO' && !isNoiseEmail(s.user.email))
  const testSubs = activeSubs.filter((s) => s.provider !== 'YOCO')
  const mrrCents = liveSubs.reduce((a, s) => a + s.amountCents, 0)
  const testMrrCents = testSubs.reduce((a, s) => a + s.amountCents, 0)
  const humanTopupSum = (p: string) => topups30.filter((t) => t.provider === p && !isNoiseEmail(t.user.email)).reduce((a, t) => a + t.amountCents, 0)
  const topups30dCents = humanTopupSum('YOCO')
  const sandboxTopups30dCents = topups30
    .filter((t) => t.provider === 'SANDBOX' || isNoiseEmail(t.user.email))
    .reduce((a, t) => a + t.amountCents, 0)
  const walletFloatCents = wallets.reduce((a, w) => a + w.balance, 0)
  const humanWalletFloatCents = wallets.filter((w) => !isNoiseEmail(w.user.email)).reduce((a, w) => a + w.balance, 0)

  // The till: humans sitting on a PENDING checkout right now. This is the most
  // expensive silence on the platform, so the desk names them while they wait.
  const pendingSubs = subs
    .filter((s) => s.status === 'PENDING' && !isNoiseEmail(s.user.email))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    .slice(0, 10)

  // Name the money pulse rows (one small query for the distinct payers).
  const payerIds = [...new Set(recentPaid.map((t) => t.userId))]
  const payers = payerIds.length
    ? await db.user.findMany({ where: { id: { in: payerIds } }, select: { id: true, name: true, businessName: true } })
    : []
  const payerMap = new Map(payers.map((u) => [u.id, u]))

  const rosterRows = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true, name: true, email: true, businessName: true, city: true, industry: true,
      role: true, platformAdmin: true, accountStatus: true, suspendedAt: true, createdAt: true,
      wallet: { select: { balance: true } },
      subscription: {
        select: { plan: true, status: true, billingCycle: true, amountCents: true, renewsAt: true, npoNumber: true },
      },
      _count: { select: { leads: true, clients: true, invoices: true, projects: true } },
    },
  })

  // Last real activity per client: latest credit ledger movement or lead touch.
  const [txMax, leadMax] = await Promise.all([
    db.creditTx.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.lead.groupBy({ by: ['userId'], _max: { updatedAt: true } }),
  ])
  const txMap = new Map(txMax.map((r) => [r.userId, r._max.createdAt]))
  const leadMap = new Map(leadMax.map((r) => [r.userId, r._max.updatedAt]))
  const poolMap = new Map(poolByUser.map((r) => [r.userId, r._count._all]))

  const roster = rosterRows.map((u) => {
    const sub = u.subscription
    const subLive = sub && sub.status === 'ACTIVE' && (!sub.renewsAt || sub.renewsAt.getTime() >= now)
    const lastActive = [txMap.get(u.id), leadMap.get(u.id)].filter(Boolean).sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0] || null
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      businessName: u.businessName,
      city: u.city,
      industry: u.industry,
      joinedAt: u.createdAt,
      accountStatus: u.accountStatus,
      suspendedAt: u.suspendedAt,
      isAdmin: u.role === 'ADMIN' || u.platformAdmin,
      isQa: isNoiseEmail(u.email),
      isInternal: isInternalEmail(u.email) && !isProbeEmail(u.email),
      walletCents: u.wallet?.balance ?? 0,
      plan: sub ? sub.plan : null,
      subStatus: sub ? (subLive ? 'ACTIVE' : sub.status === 'ACTIVE' ? 'PAST_DUE' : sub.status) : 'NONE',
      subCycle: sub?.billingCycle ?? null,
      subAmountCents: sub?.amountCents ?? 0,
      renewsAt: sub?.renewsAt ?? null,
      npoNumber: sub?.npoNumber ?? null,
      counts: { leads: u._count.leads, clients: u._count.clients, invoices: u._count.invoices, projects: u._count.projects },
      poolCount: poolMap.get(u.id) ?? 0,
      lastActiveAt: lastActive,
    }
  })

  const humanMeetings = meetingTallyRows.filter((m) => !isNoiseEmail(m.memberEmail) && !isNoiseEmail(m.guestEmail))
  const statusCount = (s: string) => humanMeetings.filter((m) => m.status === s).length
  const meetingsKpi = {
    total: statusCount('PROPOSED') + statusCount('CONFIRMED'),
    confirmed: statusCount('CONFIRMED'),
    awaiting: statusCount('PROPOSED'),
    declined: statusCount('DECLINED'),
  }

  // Meetings set before sharing existed get their share token on first sight,
  // idempotent, and the token only ever reaches the owner and the parties.
  const meetingRows = await Promise.all(
    meetings.map(async (m) => {
      let shareToken = m.shareToken
      if (!shareToken) {
        shareToken = crypto.randomBytes(16).toString('base64url')
        await db.meeting.update({ where: { id: m.id }, data: { shareToken } }).catch(() => {})
      }
      const { _count, ...rest } = m
      return { ...rest, shareToken, comments: _count.comments }
    }),
  )

  const qaAccounts = rosterRows.filter((u) => isProbeEmail(u.email)).length
  const internalAccounts = rosterRows.filter((u) => !isProbeEmail(u.email) && (isInternalEmail(u.email) || isExecEmail(u.email))).length

  return NextResponse.json({
    kpis: {
      members: userCount,
      qaAccounts,
      internalAccounts,
      realMembers: Math.max(0, userCount - qaAccounts - internalAccounts),
      new7,
      new30,
      subscribers: liveSubs.length,
      mrrCents,
      subsPastDue: subs.filter((s) => s.status === 'PAST_DUE' || (s.status === 'ACTIVE' && s.renewsAt && s.renewsAt.getTime() < now)).length,
      subsPaused: subs.filter((s) => s.status === 'PAUSED').length,
      subsCanceled: subs.filter((s) => s.status === 'CANCELED').length,
      subsPending: pendingSubs.length,
      topups30dCents,
      sandboxTopups30dCents,
      testMrrCents,
      walletFloatCents,
      humanWalletFloatCents,
      leadsPlatform: leadCount,
      poolNew,
      poolArrivals24h,
      suspended: roster.filter((r) => r.accountStatus === 'SUSPENDED').length,
      meetingsSet: meetingsKpi.total,
      meetingsConfirmed: meetingsKpi.confirmed,
      meetingsAwaiting: meetingsKpi.awaiting,
    },
    meetings: meetingRows,
    meetingsKpi,
    roster,
    // Payments: gateway mode + webhook state + the money pulse. The owner sees
    // at a glance that real rands flow and that Yoco confirmations land.
    payments: {
      // Key text decides the mode; when it is silent, Yoco's own word at the
      // last webhook registration fills the gap.
      keyMode: getYocoKeyMode() ?? ((webhookModeRow as 'live' | 'test' | null) || null),
      webhookConfigured: Boolean(webhookSecret),
      webhookSource: process.env.YOCO_WEBHOOK_SECRET ? 'env' : webhookSecret ? 'config' : 'none',
      webhookMode: webhookModeRow || null,
      // The till: humans with a checkout open right now.
      pending: pendingSubs.map((s) => ({
        id: s.id,
        name: s.user?.name || 'Client',
        businessName: s.user?.businessName ?? null,
        email: s.user?.email ?? '',
        plan: s.plan,
        amountCents: s.amountCents,
        billingCycle: s.billingCycle,
        npoNumber: s.npoNumber,
        createdAt: s.createdAt,
      })),
      recent: recentPaid.map((t) => ({
        id: t.id,
        amountCents: t.amountCents,
        creditCents: t.creditCents,
        provider: t.provider,
        reference: t.reference,
        paidAt: t.paidAt,
        createdAt: t.createdAt,
        clientName: payerMap.get(t.userId)?.name || 'Client',
        clientBusiness: payerMap.get(t.userId)?.businessName ?? null,
      })),
    },
  })
}
