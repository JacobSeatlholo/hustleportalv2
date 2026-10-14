import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { MRR_TARGET_CENTS } from '@/lib/plans'

// GET /api/admin/growth — owner revenue dashboard: MRR vs target, referrals, churn.
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await db.user.findUnique({ where: { id: userId }, select: { role: true, platformAdmin: true } })
  if (!me || (me.role !== 'ADMIN' && !me.platformAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [subs, users, referrals, topReferrers, topups, newThisMonth, activeSubs] = await Promise.all([
    db.subscription.findMany({ select: { plan: true, status: true, amountCents: true, renewsAt: true, startedAt: true, userId: true, provider: true } }),
    db.user.count(),
    db.referral.findMany({ select: { status: true, referrerId: true, invitedUserId: true } }),
    db.referral.groupBy({
      by: ['referrerId'],
      where: {},
      _count: { _all: true },
      orderBy: { _count: { referrerId: 'desc' } },
      take: 5,
    }),
    // Real card money only: sandbox QA top ups never dress up the revenue line.
    db.topUp.aggregate({ where: { status: 'PAID', paidAt: { gte: monthAgo }, provider: 'YOCO' }, _sum: { amountCents: true } }),
    db.user.count({ where: { createdAt: { gte: monthAgo } } }),
    db.subscription.findMany({ where: { status: 'ACTIVE' }, select: { userId: true } }),
  ])

  // Lazy expiry view: only count ACTIVE subs whose renewsAt hasn't passed.
  // Revenue counts live Yoco plans only; QA sandbox plans stay in the roster,
  // never in the mission math.
  const now = Date.now()
  const active = subs.filter((s) => s.status === 'ACTIVE' && (!s.renewsAt || s.renewsAt.getTime() >= now))
  const liveActive = active.filter((s) => s.provider === 'YOCO')
  const pastDue = subs.filter((s) => s.status === 'PAST_DUE' || (s.status === 'ACTIVE' && s.renewsAt && s.renewsAt.getTime() < now)).length
  const canceled = subs.filter((s) => s.status === 'CANCELED').length

  const mrrCents = liveActive.reduce((a, s) => a + s.amountCents, 0)
  const byPlan = {
    HUSTLER: liveActive.filter((s) => s.plan === 'HUSTLER').length,
    BOSS: liveActive.filter((s) => s.plan === 'BOSS').length,
  }

  const referrerIds = topReferrers.map((r) => r.referrerId)
  const referrerUsers = await db.user.findMany({
    where: { id: { in: referrerIds } },
    select: { id: true, name: true, businessName: true },
  })
  const leaderboard = topReferrers.map((r) => {
    const u = referrerUsers.find((x) => x.id === r.referrerId)
    const invites = referrals.filter((x) => x.referrerId === r.referrerId)
    return {
      name: u?.name || 'Unknown',
      businessName: u?.businessName || null,
      invites: r._count._all,
      subscribed: invites.filter((x) => x.status === 'SUBSCRIBED').length,
    }
  })

  const retainedActive = activeSubs.filter((s) => {
    // how many active subs came from referrals (network effects at work)
    return referrals.some((r) => r.invitedUserId === s.userId && r.status === 'SUBSCRIBED')
  }).length

  return NextResponse.json({
    mrr: {
      cents: mrrCents,
      targetCents: MRR_TARGET_CENTS,
      percent: Math.min(100, Math.round((mrrCents / MRR_TARGET_CENTS) * 100)),
    },
    members: { total: users, newThisMonth, subscribers: liveActive.length, byPlan },
    subscriptions: { active: liveActive.length, pastDue, canceled },
    referrals: {
      total: referrals.length,
      subscribed: referrals.filter((r) => r.status === 'SUBSCRIBED').length,
      viaReferralActive: retainedActive,
    },
    topups: { last30DaysCents: topups._sum.amountCents || 0 },
    leaderboard,
  })
}
