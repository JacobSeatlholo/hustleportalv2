import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

// GET /api/teams — my team(s) + members
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const memberships = await db.teamMember.findMany({
    where: { userId },
    include: {
      team: {
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } } },
        },
      },
    },
  })
  return NextResponse.json({
    teams: memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      role: m.role,
      members: m.team.members.map((tm) => ({
        id: tm.user.id,
        name: tm.user.name,
        email: tm.user.email,
        role: tm.role,
      })),
    })),
  })
}

// POST /api/teams — create team, or { action:'invite', teamId, email } to add a member
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()

  if (body.action === 'invite') {
    const { teamId, email } = body
    const team = await db.team.findUnique({ where: { id: teamId } })
    if (!team) return NextResponse.json({ error: 'Team not found.' }, { status: 404 })
    const me = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } })
    if (!me || (me.role !== 'OWNER' && team.ownerId !== userId)) {
      return NextResponse.json({ error: 'Only the team owner can invite members.' }, { status: 403 })
    }
    const invitee = await db.user.findUnique({
      where: { email: String(email).toLowerCase().trim() },
    })
    if (!invitee) {
      return NextResponse.json({
        error: 'No HustlePortal account with that email yet. Ask your teammate to register first, then invite them.',
      }, { status: 404 })
    }
    const already = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: invitee.id } },
    })
    if (already) return NextResponse.json({ error: 'Already a member.' }, { status: 409 })
    await db.teamMember.create({ data: { teamId, userId: invitee.id, role: 'MEMBER' } })
    return NextResponse.json({ ok: true })
  }

  // create team
  const { name } = body
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Team name is required.' }, { status: 400 })
  }
  const team = await db.team.create({ data: { name: String(name).trim(), ownerId: userId } })
  await db.teamMember.create({ data: { teamId: team.id, userId, role: 'OWNER' } })
  return NextResponse.json({ team })
}
