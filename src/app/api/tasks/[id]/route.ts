import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'
import { recordTaskEvent, STATUS_LABEL } from '@/lib/taskrecord'
import { canSeeDeal } from '@/lib/dealroom'
import { sendTaskAssignedMail } from '@/lib/taskmail'

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
  const allowed = ['title', 'notes', 'status', 'priority', 'isPrivate', 'assigneeId', 'teamId']
  const data: Record<string, unknown> = {}
  for (const k of allowed) if (k in body) data[k] = body[k]
  if ('dueDate' in body) data.dueDate = body.dueDate ? new Date(body.dueDate) : null
  if (data.assigneeId === '') data.assigneeId = null
  // Deal room link (Task 213): attach the task to a deal the user can see,
  // or unlink with null. The deal room shows every task wired to it.
  if ('dealId' in body) {
    if (body.dealId) {
      const deal = await canSeeDeal(String(body.dealId), userId)
      if (!deal) return NextResponse.json({ error: 'That deal does not exist.' }, { status: 404 })
      data.dealId = deal.id
    } else {
      data.dealId = null
    }
  }
  // Moving a task onto a team follows the same law as creating it there:
  // the mover must belong to the target team, and team tasks are never private.
  if ('teamId' in body) {
    if (body.teamId) {
      const member = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId: String(body.teamId), userId } },
      })
      if (!member) return NextResponse.json({ error: 'You are not a member of that team.' }, { status: 403 })
      data.teamId = String(body.teamId)
      data.isPrivate = false
    } else {
      data.teamId = null
    }
  }
  // Assignment integrity, same wall as creation (Hayley case, round 2): a task
  // can only land on someone who is actually IN the team it lives in, and a
  // personal task can never be assigned across the desk — forwarding a private
  // task to a teammate means moving it onto the shared team IN THE SAME PATCH.
  if ('assigneeId' in data) {
    const newAssignee = data.assigneeId ? String(data.assigneeId) : null
    const effectiveTeamId = ('teamId' in data ? (data.teamId as string | null) : task.teamId) || null
    if (newAssignee && newAssignee !== userId && !effectiveTeamId) {
      return NextResponse.json({ error: 'Personal tasks can only be assigned to you. Move the task onto a team to send it.' }, { status: 400 })
    }
    if (newAssignee && newAssignee !== userId && effectiveTeamId) {
      const assigneeMember = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId: effectiveTeamId, userId: newAssignee } },
      })
      if (!assigneeMember) return NextResponse.json({ error: 'That person is not a member of this team.' }, { status: 400 })
    }
  }

  const updated = await db.task.update({
    where: { id },
    data,
    include: {
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true } },
      team: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true, stage: true } },
    },
  })
  // The record witnesses every change of hands and state.
  if (data.status && String(data.status) !== task.status) {
    await recordTaskEvent(id, 'STATUS', userId, `moved to ${STATUS_LABEL[String(data.status)] || String(data.status)}`)
  }
  if ('assigneeId' in data) {
    const newAssignee = data.assigneeId ? String(data.assigneeId) : null
    if (newAssignee && newAssignee !== task.assigneeId) {
      const u = await db.user.findUnique({ where: { id: newAssignee }, select: { name: true } })
      await recordTaskEvent(id, 'SENT', userId, `sent to ${u?.name || 'a teammate'}`)
      // Forwarding announces itself: the new assignee hears it in the inbox
      // through the same door creation uses (taskmail.ts).
      if (newAssignee !== userId) {
        const mover = await db.user.findUnique({ where: { id: userId }, select: { name: true } })
        await sendTaskAssignedMail(updated, mover?.name || 'A teammate')
      }
    }
  }
  if ('teamId' in data && data.teamId !== task.teamId) {
    await recordTaskEvent(
      id,
      'EDIT',
      userId,
      data.teamId ? `moved onto the team ${updated.team?.name || ''}`.trim() : 'moved back to personal tasks',
    )
  }
  if ('dealId' in data && data.dealId !== task.dealId) {
    await recordTaskEvent(id, 'EDIT', userId, data.dealId ? 'linked it to a deal' : 'unlinked it from the deal')
  }
  const detailEdits = ['title', 'notes', 'priority', 'dueDate', 'isPrivate'].filter((k) => k in data)
  if (detailEdits.length > 0) {
    await recordTaskEvent(id, 'EDIT', userId, 'updated the details')
  }
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
