import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'

async function canEditTask(taskId: string, userId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } })
  if (!task) return { task: null, ok: false }
  if (task.creatorId === userId || task.assigneeId === userId) return { task, ok: true }
  if (task.teamId) {
    const member = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId: task.teamId, userId } },
    })
    if (member) return { task, ok: true }
  }
  return { task, ok: false }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { task, ok } = await canEditTask(id, userId)
  if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const allowed = ['title', 'notes', 'status', 'priority', 'isPrivate', 'assigneeId']
  const data: Record<string, unknown> = {}
  for (const k of allowed) if (k in body) data[k] = body[k]
  if ('dueDate' in body) data.dueDate = body.dueDate ? new Date(body.dueDate) : null
  if (data.assigneeId === '') data.assigneeId = null

  const updated = await db.task.update({
    where: { id },
    data,
    include: {
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
  })
  if (data.status === 'DONE' && task.status !== 'DONE') {
    await bumpChallenge(userId, 'complete_task')
  }
  return NextResponse.json({ task: updated })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { task, ok } = await canEditTask(id, userId)
  if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await db.task.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
