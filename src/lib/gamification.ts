import { db } from '@/lib/db'

export const LEVELS = [
  { level: 1, name: 'Seedling', min: 0, icon: '🌱' },
  { level: 2, name: 'Grinder', min: 100, icon: '🔧' },
  { level: 3, name: 'Hustler', min: 300, icon: '⚡' },
  { level: 4, name: 'Closer', min: 700, icon: '🎯' },
  { level: 5, name: 'Boss', min: 1200, icon: '👑' },
  { level: 6, name: 'Tycoon', min: 2500, icon: '🏆' },
]

export function levelFor(xp: number) {
  let current = LEVELS[0]
  for (const l of LEVELS) if (xp >= l.min) current = l
  const next = LEVELS.find((l) => l.min > current.min) || null
  const span = next ? next.min - current.min : 1
  const progress = next ? Math.min(100, Math.round(((xp - current.min) / span) * 100)) : 100
  return { ...current, next, progress }
}

export async function awardXp(userId: string, type: string, amount: number, description?: string) {
  await db.xpEvent.create({ data: { userId, type, amount, description } })
  const user = await db.user.update({
    where: { id: userId },
    data: { xp: { increment: amount } },
  })
  return { xp: user.xp, level: levelFor(user.xp) }
}

export const CHALLENGES = [
  { key: 'login', label: 'Check in today', xp: 15, target: 1 },
  { key: 'add_lead', label: 'Add a new lead', xp: 30, target: 1 },
  { key: 'add_task', label: 'Plan your day — add a task', xp: 20, target: 1 },
  { key: 'complete_task', label: 'Complete a task', xp: 25, target: 1 },
  { key: 'log_expense', label: 'Log a finance entry', xp: 20, target: 1 },
  { key: 'ai_chat', label: 'Ask the AI Advisor something', xp: 25, target: 1 },
  { key: 'move_stage', label: 'Move a lead forward in the pipeline', xp: 35, target: 1 },
]

function today() {
  const d = new Date()
  // Africa/Johannesburg is UTC+2
  const jhb = new Date(d.getTime() + 2 * 60 * 60 * 1000)
  return jhb.toISOString().slice(0, 10)
}

export async function bumpChallenge(userId: string, key: string) {
  const day = today()
  const def = CHALLENGES.find((c) => c.key === key)
  if (!def) return null
  const existing = await db.challengeProgress.findUnique({
    where: { userId_day_key: { userId, day, key } },
  })
  if (!existing) {
    const created = await db.challengeProgress.create({
      data: { userId, day, key, count: 1, done: 1 >= def.target },
    })
    if (created.done) await awardXp(userId, 'CHALLENGE', def.xp, `Challenge: ${def.label}`)
    return created
  }
  if (existing.done) return existing
  const count = existing.count + 1
  const done = count >= def.target
  const updated = await db.challengeProgress.update({
    where: { id: existing.id },
    data: { count, done },
  })
  if (done) await awardXp(userId, 'CHALLENGE', def.xp, `Challenge: ${def.label}`)
  return updated
}

export async function todaysChallenges(userId: string) {
  const day = today()
  const rows = await db.challengeProgress.findMany({ where: { userId, day } })
  return CHALLENGES.map((c) => {
    const row = rows.find((r) => r.key === c.key)
    return {
      key: c.key,
      label: c.label,
      xp: c.xp,
      target: c.target,
      count: row?.count || 0,
      done: row?.done || false,
    }
  })
}
