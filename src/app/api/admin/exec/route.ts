import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { getYocoKeyMode, getYocoWebhookSecret } from '@/lib/yoco'
import { getConfig, CONFIG_KEYS } from '@/lib/config'

// GET /api/admin/exec — the Executive Dashboard feed: platform KPIs + the full
// client roster (plan, account status, wallet, activity). Exec only.
export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const now = Date.now()
  const d7 = new Date(now - 7 * 86_400_000)
  const d30 = new Date(now - 30 * 86_400_000)

  const [userCount, new7, new30, subs, topupsByProvider, walletAgg, leadCount, poolNew, poolArrivals24h, poolByUser, recentPaid, webhookSecret, webhookModeRow] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: d7 } } }),
    db.user.count({ where: { createdAt: { gte: d30 } } }),
    db.subscription.findMany({
      select: { userId: true, plan: true, status: true, billingCycle: true, amountCents: true, renewsAt: true, npoNumber: true, provider: true },
    }),
    // Revenue splits by provider: YOCO rows are real card money; SANDBOX rows
    // are QA top ups from probe runs. Launch numbers count live money only.
    db.topUp.groupBy({ by: ['provider'], where: { status: 'PAID', paidAt: { gte: d30 } }, _sum: { amountCents: true } }),
    db.wallet.aggregate({ _sum: { balance: true } }),
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
  ])

  // Lazy subscription truth: ACTIVE only while renewsAt stands; PAUSED, PAST_DUE, CANCELED as-is.
  // MRR counts live Yoco plans only, so QA sandbox activations never dress up
  // the revenue number. Non-live plans stay visible in the roster as always.
  const activeSubs = subs.filter((s) => s.status === 'ACTIVE' && (!s.renewsAt || s.renewsAt.getTime() >= now))
  const liveSubs = activeSubs.filter((s) => s.provider === 'YOCO')
  const testSubs = activeSubs.filter((s) => s.provider !== 'YOCO')
  const mrrCents = liveSubs.reduce((a, s) => a + s.amountCents, 0)
  const testMrrCents = testSubs.reduce((a, s) => a + s.amountCents, 0)
  const topupSum = (p: string) => topupsByProvider.find((t) => t.provider === p)?._sum.amountCents || 0

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

  return NextResponse.json({
    kpis: {
      members: userCount,
      new7,
      new30,
      subscribers: liveSubs.length,
      mrrCents,
      subsPastDue: subs.filter((s) => s.status === 'PAST_DUE' || (s.status === 'ACTIVE' && s.renewsAt && s.renewsAt.getTime() < now)).length,
      subsPaused: subs.filter((s) => s.status === 'PAUSED').length,
      subsCanceled: subs.filter((s) => s.status === 'CANCELED').length,
      topups30dCents: topupSum('YOCO'),
      sandboxTopups30dCents: topupSum('SANDBOX'),
      testMrrCents,
      walletFloatCents: walletAgg._sum.balance || 0,
      leadsPlatform: leadCount,
      poolNew,
      poolArrivals24h,
      suspended: roster.filter((r) => r.accountStatus === 'SUSPENDED').length,
    },
    roster,
    // Payments: gateway mode + webhook state + the money pulse. The owner sees
    // at a glance that real rands flow and that Yoco confirmations land.
    payments: {
      keyMode: getYocoKeyMode(),
      webhookConfigured: Boolean(webhookSecret),
      webhookSource: process.env.YOCO_WEBHOOK_SECRET ? 'env' : webhookSecret ? 'config' : 'none',
      webhookMode: webhookModeRow || null,
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
