import { NextResponse } from 'next/server'
import { getSessionUser, publicUser } from '@/lib/auth'
import { levelFor, todaysChallenges, loginStreak } from '@/lib/gamification'
import { ensureWallet } from '@/lib/wallet'
import { listProjects, getOrCreateDefaultProject } from '@/lib/workspace'
import { opportunisticTick } from '@/lib/campaignqueue'
import { hasStatementAccess } from '@/lib/statements'

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ user: null }, { status: 401 })
    const wallet = await ensureWallet(user.id)
    const challenges = await todaysChallenges(user.id)
    await getOrCreateDefaultProject(user.id)
    const projects = await listProjects(user.id)
    // Member sessions are the steadiest human traffic the platform sees, so
    // they carry the queue heartbeat too (cooldown gated, DB paced, silent on
    // failure, and it never adds work while no campaign is ACTIVE).
    await opportunisticTick()
    return NextResponse.json({
      user: publicUser(user),
      wallet: { balance: wallet.balance },
      level: levelFor(user.xp),
      challenges,
      streak: await loginStreak(user.id),
      team: user.memberships?.[0]?.team
        ? { id: user.memberships[0].team.id, name: user.memberships[0].team.name, role: user.memberships[0].role }
        : null,
      // The SEH statements book is a narrow door: master, exec seats, and the
      // master's own team members only. One flag drives the nav item.
      statementAccess: await hasStatementAccess({
        id: user.id,
        email: user.email,
        role: user.role,
        platformAdmin: user.platformAdmin === true,
      }),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        isDefault: p.isDefault,
        counts: p.counts,
        // The Lead Finder reads these two: website prefills its website box,
        // profileReady decides whether to show the "fill in your details"
        // tip (a scan with no description AND no saved profile runs blind).
        // The member's own workspace data, back to their own session.
        website: p.website,
        profileReady: Boolean(
          String(p.website || '').trim() || String(p.offerings || '').trim() || String(p.valueProp || '').trim()
        ),
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
