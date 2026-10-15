import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendPushToUser } from '@/lib/push'
import { globalCooldown } from '@/lib/ratelimit'

export const maxDuration = 60

/**
 * Daily task reminders — Vercel Cron hits this every morning (05:00 UTC / 07:00 SAST).
 * Pushes "N tasks due today" to every user with push subscriptions + tasks due today.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
 * If the env is absent we accept the call (it only sends notifications — harmless),
 * BUT behind a 10-minute global cooldown: the scheduled pinger fires once a day and
 * sails through, while a stranger hammering the URL gets honest "already ran" answers
 * instead of a push blast to every user on the platform.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return true // no secret configured — cooldown below keeps abuse bounded
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const cooldown = globalCooldown('cron:daily-reminders', 10 * 60 * 1000)
  if (!cooldown.ran) {
    return NextResponse.json({ ok: true, skipped: 'cooldown', retryAfterSec: cooldown.retryAfterSec })
  }

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
    select: { assigneeId: true, creatorId: true, title: true, dueDate: true },
    orderBy: { dueDate: 'asc' },
    take: 2000,
  })

  // group per recipient: assignee wins, else creator — and keep the day's schedule
  // (times shown in SAST, the timezone this whole customer base lives in)
  const perUser = new Map<string, { count: number; lines: string[] }>()
  for (const t of due) {
    const uid = t.assigneeId || t.creatorId
    if (!uid) continue
    const entry = perUser.get(uid) || { count: 0, lines: [] }
    entry.count++
    if (entry.lines.length < 3) {
      const time = t.dueDate
        ? new Date(t.dueDate).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })
        : null
      const hasTime = t.dueDate && (new Date(t.dueDate).getUTCHours() !== 0 || new Date(t.dueDate).getUTCMinutes() !== 0)
      entry.lines.push(`${hasTime && time ? `${time} ` : ''}${t.title.slice(0, 60)}`)
    }
    perUser.set(uid, entry)
  }

  // Paused accounts get silence: a suspended owner's tasks stay due, but the
  // push door stays shut until the exec restores them.
  const recipientIds = [...perUser.keys()]
  const statusRows = recipientIds.length
    ? await db.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, accountStatus: true } })
    : []
  const activeIds = new Set(statusRows.filter((s) => s.accountStatus !== 'SUSPENDED').map((s) => s.id))

  let notified = 0
  let skippedSuspended = 0
  for (const [userId, { count, lines }] of perUser) {
    if (!activeIds.has(userId)) { skippedSuspended++; continue }
    const body = [
      'Open HustlePortal to knock them out — small daily wins compound.',
      lines.length ? lines.join('\n') : '',
      count > lines.length ? `+ ${count - lines.length} more` : '',
    ].filter(Boolean).join('\n')
    const r = await sendPushToUser(userId, {
      title: count === 1 ? '1 task due today 📌' : `${count} tasks due today 📌`,
      body,
      url: '/?view=tasks',
      tag: 'daily-tasks',
    })
    if (r.sent > 0) notified++
  }

  return NextResponse.json({ ok: true, usersWithDueTasks: perUser.size, notified, skippedSuspended })
}
