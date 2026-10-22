import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { recordTaskEvent, verifyChain } from '@/lib/taskrecord'

/**
 * GET /api/tasks/[id]/record, the sealed accountability record.
 *
 * Returns the task's full hash-chained event history (created, sent, opened,
 * status moves, comments, edits) plus a `verified` flag: true only when every
 * seal recomputes cleanly, so anyone on the task can trust what they read.
 *
 * Opening the record IS the "opened" moment: the first time anyone other than
 * the creator reads it, an OPENED event is sealed into the chain with their
 * name and the exact time. That is the timestamp teams hold each other to.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const task = await db.task.findUnique({ where: { id } })
  if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
  const allowed =
    task.creatorId === userId ||
    task.assigneeId === userId ||
    (task.teamId
      ? Boolean(
          await db.teamMember.findUnique({ where: { teamId_userId: { teamId: task.teamId, userId } } })
        )
      : false)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // First read by anyone other than the creator is the accountability moment:
  // seal OPENED into the chain with their name and the exact time.
  const alreadyOpened = await db.taskEvent.findFirst({
    where: { taskId: id, type: 'OPENED', actorId: userId },
    select: { id: true },
  })
  if (!alreadyOpened && userId !== task.creatorId) {
    await recordTaskEvent(id, 'OPENED', userId, 'opened it')
  }

  const events = await db.taskEvent.findMany({
    where: { taskId: id },
    orderBy: { seq: 'asc' },
    take: 300,
  })
  const verified = verifyChain(events)
  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      seq: e.seq,
      type: e.type,
      actorName: e.actorName,
      detail: e.detail,
      createdAt: e.createdAt.toISOString(),
      hash: e.hash,
    })),
    verified,
  })
}
