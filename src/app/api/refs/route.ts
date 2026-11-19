import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { ensureRefCode, refLink } from '@/lib/referral'
import { getStrategist } from '@/lib/corporate'

// GET /api/refs, my referral code, link, stats and recent invites.
// Task 221 round 4 (owner, network effect): a floor member's link runs on the
// strategist's own domain — app.<brand>/?ref=CODE lands on the marketing door
// there, so the signup attributes to the strategist funnel AND to the member
// who shared the link. Everyone else keeps the main-site link.
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const code = await ensureRefCode(userId)
  const me = await db.user.findUnique({ where: { id: userId }, select: { corporatePartner: true } })
  const partner = me?.corporatePartner ? getStrategist(me.corporatePartner) : undefined
  const link = partner?.appDomain ? `https://${partner.appDomain}/?ref=${code}` : refLink(code)
  const [signedUp, subscribed, earned, recent, referrer] = await Promise.all([
    db.referral.count({ where: { referrerId: userId } }),
    db.referral.count({ where: { referrerId: userId, status: 'SUBSCRIBED' } }),
    db.creditTx.aggregate({ where: { userId, type: 'BONUS', description: { contains: 'Referral reward' } }, _sum: { amount: true } }),
    db.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, invitedEmail: true, status: true, rewardCents: true, createdAt: true, invitedUser: { select: { name: true } } },
    }),
    db.referral.findFirst({ where: { invitedUserId: userId }, select: { referrer: { select: { name: true } } } }),
  ])

  return NextResponse.json({
    code,
    link,
    // The strategist's brand: Grow's share text stays brandless on partner
    // hosts (whitelabel law), and DFY members never see the self-serve plans.
    partnerCompany: partner?.company || null,
    stats: { signedUp, subscribed, earnedCents: earned._sum.amount || 0 },
    recent,
    invitedBy: referrer?.referrer.name || null,
  })
}
