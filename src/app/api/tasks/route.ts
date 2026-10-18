import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'
import { recordTaskEvent } from '@/lib/taskrecord'

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
      _count: { select: { comments: true } },
    },
    take: 300,
  })
  // Accountability at a glance: when each task was first opened by its person.
  const ids = tasks.map((t) => t.id)
  const opened = ids.length
    ? await db.taskEvent.findMany({
        where: { taskId: { in: ids }, type: 'OPENED' },
        select: { taskId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : []
  const firstOpen = new Map<string, Date>()
  for (const o of opened) if (!firstOpen.has(o.taskId)) firstOpen.set(o.taskId, o.createdAt)
  return NextResponse.json({
    tasks: tasks.map((t) => ({ ...t, _openedAt: firstOpen.get(t.id)?.toISOString() || null })),
  })
}

// POST /api/tasks — create (personal or team), optionally tied to a pipeline contact.
// Backfill support: status and createdAt let a record of ALREADY completed work be
// logged with its real date. createdAt can never be in the future, and the sealed
// TaskEvent still stamps the true moment the record was logged.
const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE']
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { title, notes, priority, dueDate, isPrivate, teamId, assigneeId, leadId, status, createdAt } = body
  if (!title || !String(title).trim()) {
    return NextResponse.json({ error: 'Task title is required.' }, { status: 400 })
  }
  const taskStatus = TASK_STATUSES.includes(String(status)) ? String(status) : 'TODO'
  let backCreatedAt: Date | undefined
  if (createdAt) {
    const d = new Date(String(createdAt))
    if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now()) backCreatedAt = d
  }
  // A task can belong to a contact. Same access wall as the lead detail:
  // own lead, or one shared via a team the user belongs to.
  let linkedLeadId: string | null = null
  if (leadId) {
    const memberships = await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })
    const teamIds = memberships.map((m) => m.teamId)
    const lead = await db.lead.findFirst({
      where: { id: String(leadId), OR: [{ userId }, { teamId: { in: teamIds } }] },
      select: { id: true },
    })
    if (!lead) return NextResponse.json({ error: 'That contact does not exist.' }, { status: 404 })
    linkedLeadId = lead.id
  }
  if (teamId) {
    const member = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } })
    if (!member) return NextResponse.json({ error: 'Not a member of that team.' }, { status: 403 })
    // Assignment integrity: a team task can only land on someone who is
    // actually IN that team — no assigning across the membership wall.
    if (assigneeId && assigneeId !== userId) {
      const assignee = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: assigneeId } } })
      if (!assignee) return NextResponse.json({ error: 'That person is not a member of this team.' }, { status: 400 })
    }
    // team tasks cannot be private
  } else if (assigneeId && assigneeId !== userId) {
    return NextResponse.json({ error: 'Personal tasks can only be assigned to you.' }, { status: 400 })
  }
  const task = await db.task.create({
    data: {
      title: String(title).trim(),
      notes: notes || null,
      priority: priority || 'MEDIUM',
      status: taskStatus,
      dueDate: dueDate ? new Date(dueDate) : null,
      isPrivate: teamId ? false : Boolean(isPrivate),
      teamId: teamId || null,
      leadId: linkedLeadId,
      creatorId: userId,
      assigneeId: assigneeId || userId,
      ...(backCreatedAt ? { createdAt: backCreatedAt } : {}),
    },
    include: {
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      _count: { select: { comments: true } },
    },
  })
  await bumpChallenge(userId, 'add_task')
  // The record starts the moment the task exists: either it was SENT to a teammate
  // (the accountability clock starts at the send) or the owner CREATED it for self.
  if (task.assignee && task.assignee.id !== userId) {
    await recordTaskEvent(task.id, 'SENT', userId, `sent to ${task.assignee.name}`)
  } else {
    await recordTaskEvent(
      task.id,
      'CREATED',
      userId,
      taskStatus === 'DONE' ? 'logged it as already complete (backdated record)' : 'created it',
    )
  }
  return NextResponse.json({ task: { ...task, _openedAt: null } })
}
