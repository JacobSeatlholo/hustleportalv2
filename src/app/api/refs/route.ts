import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { ensureRefCode, refLink } from '@/lib/referral'

// GET /api/refs — my referral code, link, stats and recent invites.
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const code = await ensureRefCode(userId)
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
    link: refLink(code),
    stats: { signedUp, subscribed, earnedCents: earned._sum.amount || 0 },
    recent,
    invitedBy: referrer?.referrer.name || null,
  })
}
