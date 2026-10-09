import { NextResponse } from 'next/server'
import { getSessionUser, publicUser } from '@/lib/auth'
import { levelFor, todaysChallenges } from '@/lib/gamification'
import { ensureWallet } from '@/lib/wallet'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ user: null }, { status: 401 })
  const wallet = await ensureWallet(user.id)
  const challenges = await todaysChallenges(user.id)
  return NextResponse.json({
    user: publicUser(user),
    wallet: { balance: wallet.balance },
    level: levelFor(user.xp),
    challenges,
    team: user.memberships?.[0]?.team
      ? { id: user.memberships[0].team.id, name: user.memberships[0].team.name, role: user.memberships[0].role }
      : null,
  })
}
