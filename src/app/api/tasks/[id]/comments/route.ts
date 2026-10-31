import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { recordTaskEvent } from '@/lib/taskrecord'
import { sendSystemMail } from '@/lib/mailer'

/**
 * Discussion threads on tasks, the in-context alternative to WhatsApp groups.
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
  await recordTaskEvent(id, 'COMMENT', userId, 'added a comment')

  // @mentions: a tagged teammate gets a system mail. Only people who can see
  // this task anyway can be tagged (creator, assignee, the team roster), the
  // suppression list stays law, the mail is best effort: a failed send never
  // eats a comment that is already saved.
  const memberIds = [task.creatorId, task.assigneeId].filter((x): x is string => !!x)
  const teamUsers = task.teamId
    ? (await db.teamMember.findMany({
        where: { teamId: task.teamId },
        include: { user: { select: { id: true, name: true, email: true } } },
      })).map((tm) => tm.user)
    : []
  const extras = memberIds.length
    ? await db.user.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true, email: true } })
    : []
  const pool = [...teamUsers, ...extras]
  const mentioned: { id: string; name: string; email: string }[] = []
  for (const u of pool) {
    if (u.id === userId || mentioned.some((m) => m.id === u.id)) continue
    if (!body.includes(`@${u.email}`)) continue
    mentioned.push(u)
    if (mentioned.length >= 5) break
  }
  if (mentioned.length > 0) {
    const dead = await db.suppression.findMany({
      where: { email: { in: mentioned.map((m) => m.email) } },
      select: { email: true },
    })
    const deadSet = new Set(dead.map((d) => d.email.toLowerCase()))
    const author = await db.user.findUnique({ where: { id: userId }, select: { name: true } })
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://www.hustleportal.online'
    for (const m of mentioned) {
      if (deadSet.has(m.email.toLowerCase())) continue
      try {
        await sendSystemMail({
          to: m.email,
          subject: `${author?.name || 'A teammate'} tagged you on "${task.title}"`,
          body: [
            `Hi ${m.name.split(' ')[0] || 'there'},`,
            '',
            `${author?.name || 'A teammate'} tagged you in a comment on the task "${task.title}".`,
            '',
            `Open the app and check your tasks: ${appUrl}`,
            '',
            'You are getting this because the task is yours, assigned to you, or lives in your team.',
          ].join('\n'),
        })
      } catch { /* best effort, the comment is already saved */ }
    }
  }

  return NextResponse.json({ comment })
}
