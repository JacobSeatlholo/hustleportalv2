import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'

// GET /api/admin/exec — the Executive Dashboard feed: platform KPIs + the full
// client roster (plan, account status, wallet, activity). Exec only.
export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const now = Date.now()
  const d7 = new Date(now - 7 * 86_400_000)
  const d30 = new Date(now - 30 * 86_400_000)

  const [userCount, new7, new30, subs, topupAgg, walletAgg, leadCount] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: d7 } } }),
    db.user.count({ where: { createdAt: { gte: d30 } } }),
    db.subscription.findMany({
      select: { userId: true, plan: true, status: true, billingCycle: true, amountCents: true, renewsAt: true, npoNumber: true },
    }),
    db.topUp.aggregate({ where: { status: 'PAID', paidAt: { gte: d30 } }, _sum: { amountCents: true } }),
    db.wallet.aggregate({ _sum: { balance: true } }),
    db.lead.count(),
  ])

  // Lazy subscription truth: ACTIVE only while renewsAt stands; PAUSED, PAST_DUE, CANCELED as-is.
  const activeSubs = subs.filter((s) => s.status === 'ACTIVE' && (!s.renewsAt || s.renewsAt.getTime() >= now))
  const mrrCents = activeSubs.reduce((a, s) => a + s.amountCents, 0)

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
      lastActiveAt: lastActive,
    }
  })

  return NextResponse.json({
    kpis: {
      members: userCount,
      new7,
      new30,
      subscribers: activeSubs.length,
      mrrCents,
      subsPastDue: subs.filter((s) => s.status === 'PAST_DUE' || (s.status === 'ACTIVE' && s.renewsAt && s.renewsAt.getTime() < now)).length,
      subsPaused: subs.filter((s) => s.status === 'PAUSED').length,
      subsCanceled: subs.filter((s) => s.status === 'CANCELED').length,
      topups30dCents: topupAgg._sum.amountCents || 0,
      walletFloatCents: walletAgg._sum.balance || 0,
      leadsPlatform: leadCount,
      suspended: roster.filter((r) => r.accountStatus === 'SUSPENDED').length,
    },
    roster,
  })
}
