import { NextResponse } from 'next/server'
import { getSessionUser, publicUser } from '@/lib/auth'
import { levelFor, todaysChallenges, loginStreak } from '@/lib/gamification'
import { ensureWallet } from '@/lib/wallet'
import { listProjects, getOrCreateDefaultProject } from '@/lib/workspace'

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ user: null }, { status: 401 })
    const wallet = await ensureWallet(user.id)
    const challenges = await todaysChallenges(user.id)
    await getOrCreateDefaultProject(user.id)
    const projects = await listProjects(user.id)
    return NextResponse.json({
      user: publicUser(user),
      wallet: { balance: wallet.balance },
      level: levelFor(user.xp),
      challenges,
      streak: await loginStreak(user.id),
      team: user.memberships?.[0]?.team
        ? { id: user.memberships[0].team.id, name: user.memberships[0].team.name, role: user.memberships[0].role }
        : null,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        isDefault: p.isDefault,
        counts: p.counts,
      })),
    })
  } catch (e) {
    console.error('auth/me error', e)
    return NextResponse.json(
      { error: 'Session loaded but workspace setup failed. If this persists, contact support.' },
      { status: 500 }
    )
  }
}
