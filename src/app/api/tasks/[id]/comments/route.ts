import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { recordTaskEvent } from '@/lib/taskrecord'
import { sendSystemMail } from '@/lib/mailer'

/**
 * Conversations on tasks — the in-context alternative to WhatsApp groups.
 * GET  /api/tasks/[id]/comments → messages (oldest first) with author names,
 *                                  attachments and signing cards
 * POST /api/tasks/[id]/comments { body, urgent?, copiedEmails?, docIds?, sessionId? }
 *
 * Visibility rule mirrors task edit rights: creator, assignee, or any member
 * of the task's team. Personal tasks stay private to their owner/assignee.
 * An URGENT message emails everyone who can see the task plus any copied-in
 * addresses; ordinary messages only mail @mentioned teammates. The suppression
 * list stays law for every send, and mail is always best effort: a failed send
 * never eats a message that is already saved.
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s]+$/

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
    include: {
      user: { select: { id: true, name: true } },
      docs: { select: { id: true, filename: true, size: true } },
      session: {
        select: {
          id: true, token: true, docTitle: true, signerName: true,
          signerEmail: true, status: true, signedAt: true,
        },
      },
    },
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

  const bodyJson = (await req.json().catch(() => ({}))) as {
    body?: string
    urgent?: boolean
    copiedEmails?: string
    docIds?: string[]
    sessionId?: string
  }
  const body = String(bodyJson.body || '').trim()
  if (!body) return NextResponse.json({ error: 'Write something first.' }, { status: 400 })
  if (body.length > 4000) return NextResponse.json({ error: 'Message too long (4000 chars max).' }, { status: 400 })

  // Attachments: only documents that already belong to this task can ride a
  // message here (uploaded through /api/docs, whose rows the task's Documents
  // panel and this thread share).
  const docIds = Array.isArray(bodyJson.docIds) ? bodyJson.docIds.slice(0, 5) : []
  if (docIds.length > 0) {
    const valid = await db.docFile.count({ where: { id: { in: docIds }, taskId: id } })
    if (valid !== new Set(docIds).size) {
      return NextResponse.json({ error: 'One of the attachments is not on this task.' }, { status: 400 })
    }
  }

  // Signing card: the session must have been created for a document on this
  // task (via /api/docs/<id>/esign) — no cross-task linking.
  let sessionId: string | undefined
  if (bodyJson.sessionId) {
    const session = await db.esignSession.findUnique({
      where: { id: bodyJson.sessionId },
      include: { docFile: { select: { taskId: true } } },
    })
    if (!session || session.docFile?.taskId !== id) {
      return NextResponse.json({ error: 'Signing session not found for this task.' }, { status: 400 })
    }
    sessionId = session.id
  }

  // Copied-in addresses: parsed from free text (commas, semicolons, spaces),
  // validated, capped — they receive the urgent fanout like the team does.
  const copied = [...new Set(
    String(bodyJson.copiedEmails || '')
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  )]
  if (copied.some((e) => !EMAIL_RE.test(e))) {
    return NextResponse.json({ error: 'One of the copied addresses does not look like an email.' }, { status: 400 })
  }
  if (copied.length > 10) {
    return NextResponse.json({ error: 'Copy at most 10 addresses.' }, { status: 400 })
  }

  const urgent = !!bodyJson.urgent
  const comment = await db.taskComment.create({
    data: {
      taskId: id,
      userId,
      body,
      urgent,
      copiedEmails: copied.length > 0 ? copied.join(', ') : null,
      sessionId,
      ...(docIds.length > 0 ? { docs: { connect: docIds.map((did) => ({ id: did })) } } : {}),
    },
    include: {
      user: { select: { id: true, name: true } },
      docs: { select: { id: true, filename: true, size: true } },
      session: {
        select: {
          id: true, token: true, docTitle: true, signerName: true,
          signerEmail: true, status: true, signedAt: true,
        },
      },
    },
  })
  await recordTaskEvent(
    id,
    'COMMENT',
    userId,
    sessionId ? 'sent a document for signature' : urgent ? 'sent an URGENT message' : 'added a comment',
  )

  const author = await db.user.findUnique({ where: { id: userId }, select: { name: true } })
  const authorName = author?.name || 'A teammate'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://www.hustleportal.online'

  if (urgent) {
    // URGENT fanout: everyone who can see the task (team roster, creator,
    // assignee) plus the copied-in addresses. The author never mails themself.
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
    const recipients = [...new Set(
      [...teamUsers, ...extras, ...copied.map((email) => ({ id: '', name: email.split('@')[0], email }))]
        .filter((u) => u.email && u.id !== userId)
        .map((u) => JSON.stringify({ email: u.email.toLowerCase(), name: u.name })),
    )].map((s) => JSON.parse(s) as { email: string; name: string })
    const dead = await db.suppression.findMany({
      where: { email: { in: recipients.map((r) => r.email) } },
      select: { email: true },
    })
    const deadSet = new Set(dead.map((d) => d.email.toLowerCase()))
    for (const r of recipients) {
      if (deadSet.has(r.email)) continue
      try {
        await sendSystemMail({
          to: r.email,
          subject: `URGENT — ${task.title}`,
          body: [
            `Hi ${r.name.split(' ')[0] || 'there'},`,
            '',
            `${authorName} marked a message on the task "${task.title}" as URGENT:`,
            '',
            `"${body}"`,
            '',
            `Open the task and reply in the conversation: ${appUrl}/tasks`,
            '',
            'You are getting this because the task is yours, assigned to you, lives in your team, or you were copied in.',
          ].join('\n'),
          title: task.title,
          headline: 'Urgent message',
          value: { text: body.slice(0, 140), caption: `From ${authorName} on "${task.title}"` },
          ctaLabel: 'Open the conversation',
          ctaUrl: `${appUrl}/tasks`,
          preheader: `${authorName} flagged something urgent`,
        })
      } catch { /* best effort, the message is already saved */ }
    }
  } else {
    // Ordinary message: only @mentioned teammates hear about it (max 5), the
    // original behaviour.
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
    const dead = await db.suppression.findMany({
      where: { email: { in: mentioned.map((m) => m.email) } },
      select: { email: true },
    })
    const deadSet = new Set(dead.map((d) => d.email.toLowerCase()))
    for (const m of mentioned) {
      if (deadSet.has(m.email.toLowerCase())) continue
      try {
        await sendSystemMail({
          to: m.email,
          subject: `${authorName} tagged you on "${task.title}"`,
          body: [
            `Hi ${m.name.split(' ')[0] || 'there'},`,
            '',
            `${authorName} mentioned you in a conversation on the task "${task.title}".`,
            '',
            `Open the app and check your tasks: ${appUrl}`,
            '',
            'You are getting this because the task is yours, assigned to you, or lives in your team.',
          ].join('\n'),
        })
      } catch { /* best effort, the message is already saved */ }
    }
  }

  return NextResponse.json({ comment })
}
