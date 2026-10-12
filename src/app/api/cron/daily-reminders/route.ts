import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendPushToUser } from '@/lib/push'

export const maxDuration = 60

/**
 * Daily task reminders — Vercel Cron hits this every morning (05:00 UTC / 07:00 SAST).
 * Pushes "N tasks due today" to every user with push subscriptions + tasks due today.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
 * If the env is absent we accept the call (it only sends notifications — harmless).
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return true // no secret configured — rely on the endpoint being harmless
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // "Today" in South Africa — the whole customer base is SAST (UTC+2) today.
  const now = new Date()
  const start = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }))
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setHours(23, 59, 59, 999)
  // Convert SAST wall clock back to UTC instants (+2h ahead → subtract 2h)
  const startUtc = new Date(start.getTime() - 2 * 60 * 60 * 1000)
  const endUtc = new Date(end.getTime() - 2 * 60 * 60 * 1000)

  const due = await db.task.findMany({
    where: {
      status: { not: 'DONE' },
      dueDate: { gte: startUtc, lte: endUtc },
    },
    select: { assigneeId: true, creatorId: true, title: true },
    take: 2000,
  })

  // group per recipient: assignee wins, else creator
  const perUser = new Map<string, number>()
  for (const t of due) {
    const uid = t.assigneeId || t.creatorId
    if (!uid) continue
    perUser.set(uid, (perUser.get(uid) || 0) + 1)
  }

  let notified = 0
  for (const [userId, count] of perUser) {
    const r = await sendPushToUser(userId, {
      title: count === 1 ? '1 task due today 📌' : `${count} tasks due today 📌`,
      body: 'Open HustlePortal to knock them out — small daily wins compound.',
      url: '/?view=tasks',
      tag: 'daily-tasks',
    })
    if (r.sent > 0) notified++
  }

  return NextResponse.json({ ok: true, usersWithDueTasks: perUser.size, notified })
}
