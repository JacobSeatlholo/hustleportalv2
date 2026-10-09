import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'

// GET /api/tasks?scope=mine|team
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') || 'mine'

  const memberships = await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })
  const teamIds = memberships.map((m) => m.teamId)

  let where: Record<string, unknown>
  if (scope === 'team') {
    if (teamIds.length === 0) return NextResponse.json({ tasks: [] })
    where = { teamId: { in: teamIds } }
  } else if (teamIds.length > 0) {
    where = {
      OR: [
        { assigneeId: userId },
        { creatorId: userId, teamId: null },
        { assigneeId: userId, teamId: { in: teamIds } },
      ],
    }
  } else {
    where = { OR: [{ assigneeId: userId }, { creatorId: userId, teamId: null }] }
  }
  const tasks = await db.task.findMany({
    where,
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    include: {
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
    take: 300,
  })
  return NextResponse.json({ tasks })
}

// POST /api/tasks — create (personal or team)
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { title, notes, priority, dueDate, isPrivate, teamId, assigneeId } = body
  if (!title || !String(title).trim()) {
    return NextResponse.json({ error: 'Task title is required.' }, { status: 400 })
  }
  if (teamId) {
    const member = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } })
    if (!member) return NextResponse.json({ error: 'Not a member of that team.' }, { status: 403 })
    // team tasks cannot be private
  } else if (assigneeId && assigneeId !== userId) {
    return NextResponse.json({ error: 'Personal tasks can only be assigned to you.' }, { status: 400 })
  }
  const task = await db.task.create({
    data: {
      title: String(title).trim(),
      notes: notes || null,
      priority: priority || 'MEDIUM',
      dueDate: dueDate ? new Date(dueDate) : null,
      isPrivate: teamId ? false : Boolean(isPrivate),
      teamId: teamId || null,
      creatorId: userId,
      assigneeId: assigneeId || userId,
    },
    include: {
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
  })
  await bumpChallenge(userId, 'add_task')
  return NextResponse.json({ task })
}
