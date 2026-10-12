import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

/**
 * Discussion threads on tasks — the in-context alternative to WhatsApp groups.
 * GET  /api/tasks/[id]/comments → comments (oldest first) with author names
 * POST /api/tasks/[id]/comments { body } → new comment
 *
 * Visibility rule mirrors task edit rights: creator, assignee, or any member
 * of the task's team. Personal tasks stay private to their owner/assignee.
 */
async function canSeeTask(taskId: string, userId: string) {
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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { task, ok } = await canSeeTask(id, userId)
  if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const comments = await db.taskComment.findMany({
    where: { taskId: id },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
    take: 200,
  })
  return NextResponse.json({ comments })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { task, ok } = await canSeeTask(id, userId)
  if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const bodyJson = await req.json().catch(() => ({}))
  const body = String(bodyJson.body || '').trim()
  if (!body) return NextResponse.json({ error: 'Write something first.' }, { status: 400 })
  if (body.length > 4000) return NextResponse.json({ error: 'Comment too long (4000 chars max).' }, { status: 400 })

  const comment = await db.taskComment.create({
    data: { taskId: id, userId, body },
    include: { user: { select: { id: true, name: true } } },
  })
  return NextResponse.json({ comment })
}
