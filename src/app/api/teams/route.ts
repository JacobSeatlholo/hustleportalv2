import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { sendSystemMail } from '@/lib/mailer'

// GET /api/teams — my team(s) + members + pending invites
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const memberships = await db.teamMember.findMany({
    where: { userId },
    include: {
      team: {
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } } },
          invites: { where: { acceptedAt: null }, orderBy: { createdAt: 'desc' } },
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
      // pending invites are only the owner's business — hide them from other members
      pending: m.role === 'OWNER' || m.team.ownerId === userId
        ? m.team.invites.map((i) => ({ id: i.id, email: i.email }))
        : [],
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
    const normalized = String(email).toLowerCase().trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return NextResponse.json({ error: 'That email does not look right — check for typos.' }, { status: 400 })
    }
    const invitee = await db.user.findUnique({ where: { email: normalized } })
    const already = invitee
      ? await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: invitee.id } } })
      : null
    if (already) return NextResponse.json({ error: 'Already a member.' }, { status: 409 })

    const inviter = await db.user.findUnique({ where: { id: userId }, select: { name: true } })
    const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://hustleportal.online'

    if (invitee) {
      // Has an account → add instantly and email them the good news.
      await db.teamMember.create({ data: { teamId, userId: invitee.id, role: 'MEMBER' } })
      try {
        const first = (invitee.name || 'there').split(/\s+/)[0]
        await sendSystemMail({
          to: normalized,
          subject: `${inviter?.name || 'Your teammate'} added you to "${team.name}" on HustlePortal`,
          body: [
            `Hi ${first},`,
            '',
            `${inviter?.name || 'A teammate'} just added you to the team "${team.name}" on HustlePortal.`,
            'Shared tasks and pipelines for this team are now in your account — sign in to see them.',
            '',
            `Sign in: ${base}/?view=tasks`,
            '',
            'The HustlePortal team',
            'Business Hustle · businesshustle.co.za',
          ].join('\n'),
        })
      } catch { /* notification is best-effort */ }
      return NextResponse.json({ ok: true, added: true })
    }

    // No account yet → park the invite; the moment they register with this email
    // they are attached to the team automatically (see /api/auth register).
    await db.teamInvite.upsert({
      where: { teamId_email: { teamId, email: normalized } },
      create: { teamId, email: normalized, invitedById: userId },
      update: { invitedById: userId, acceptedAt: null },
    })
    try {
      await sendSystemMail({
        to: normalized,
        subject: `${inviter?.name || 'A teammate'} invited you to "${team.name}" on HustlePortal`,
        body: [
          'Hi there,',
          '',
          `${inviter?.name || 'A teammate'} uses HustlePortal to run their business and invited you to the team "${team.name}".`,
          '',
          'Register free with THIS email address and you will land in the team automatically —',
          'no setup, no codes. You get R99 in free lead credits too.',
          '',
          `Join here: ${base}/?ref=&view=dashboard`,
          '',
          'The HustlePortal team',
          'Business Hustle · businesshustle.co.za',
        ].join('\n'),
      })
    } catch { /* invitation email is best-effort */ }
    return NextResponse.json({ ok: true, invited: true })
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

// DELETE /api/teams?inviteId= — owner cancels a pending invite
export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const inviteId = new URL(req.url).searchParams.get('inviteId') || ''
  const invite = await db.teamInvite.findUnique({ where: { id: inviteId }, include: { team: true } })
  if (!invite) return NextResponse.json({ error: 'Invite not found.' }, { status: 404 })
  const me = await db.teamMember.findUnique({
    where: { teamId_userId: { teamId: invite.teamId, userId } },
  })
  if (!me || (me.role !== 'OWNER' && invite.team.ownerId !== userId)) {
    return NextResponse.json({ error: 'Only the team owner can cancel invites.' }, { status: 403 })
  }
  await db.teamInvite.delete({ where: { id: inviteId } })
  return NextResponse.json({ ok: true })
}
