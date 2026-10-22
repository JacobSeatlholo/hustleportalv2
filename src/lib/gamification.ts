import { db } from '@/lib/db'
import { LEVELS, levelFor } from '@/lib/levels'

export { LEVELS, levelFor }

/**
 * The hustle ladder lives in levels.ts (pure, client-safe). XP is earned by
 * doing real work in the platform, and every level pays a REAL wallet credit
 *, gamification with money on the line, because a title alone does not feed
 * a pipeline. Rewards are granted automatically inside awardXp the moment a
 * level is crossed.
 */

/**
 * Award XP and, when a level is crossed, pay the level reward into the
 * wallet immediately. The reward is a real CreditTx, spendable on lead
 * reveals like any other credit. Level-up never blocks the caller: a
 * wallet hiccup costs the bonus, never the XP.
 */
export async function awardXp(userId: string, type: string, amount: number, description?: string) {
  const before = await db.user.findUnique({ where: { id: userId }, select: { xp: true } })
  await db.xpEvent.create({ data: { userId, type, amount, description } })
  const user = await db.user.update({
    where: { id: userId },
    data: { xp: { increment: amount } },
  })
  const beforeLevel = levelFor(before?.xp ?? 0)
  const afterLevel = levelFor(user.xp)
  let rewardCents = 0
  if (afterLevel.level > beforeLevel.level) {
    const reached = LEVELS.find((l) => l.level === afterLevel.level)
    if (reached && reached.rewardCents > 0) {
      try {
        const { addCredits } = await import('@/lib/wallet')
        await addCredits(userId, reached.rewardCents, 'BONUS', `Level up: ${reached.name}, ${reached.reward}`)
        rewardCents = reached.rewardCents
        await db.xpEvent.create({
          data: { userId, type: 'LEVEL_REWARD', amount: 0, description: `${reached.icon} ${reached.name} unlocked, ${reached.reward}` },
        })
      } catch { /* the XP stands even if the wallet blink fails */ }
    }
  }
  return { xp: user.xp, level: afterLevel, rewardCents, leveledUp: afterLevel.level > beforeLevel.level }
}

/**
 * Daily missions. Targets above 1 turn the checklist into progress bars,
 * a half-full bar pulls the brain back to finish the job. Every key here is
 * bumped from a real server action; nothing is self-reported.
 */
export const CHALLENGES = [
  { key: 'login', label: 'Check in today', xp: 15, target: 1 },
  { key: 'add_lead', label: 'Add new leads', xp: 30, target: 2 },
  { key: 'add_task', label: 'Plan your day, add a task', xp: 20, target: 1 },
  { key: 'complete_task', label: 'Complete tasks', xp: 25, target: 2 },
  { key: 'log_expense', label: 'Log a finance entry', xp: 20, target: 1 },
  { key: 'ai_chat', label: 'Ask the AI Advisor something', xp: 25, target: 1 },
  { key: 'move_stage', label: 'Move leads forward in the pipeline', xp: 35, target: 2 },
  { key: 'reveal_lead', label: 'Reveal a verified contact', xp: 40, target: 1 },
  { key: 'browse_store', label: 'Browse the Store', xp: 15, target: 1 },
  { key: 'explore_resources', label: 'Explore the Resource Hub', xp: 20, target: 1 },
  { key: 'add_client', label: 'Add a client to your CRM', xp: 25, target: 1 },
  { key: 'explore_services', label: 'Explore Our Services', xp: 15, target: 1 },
  { key: 'google_profile', label: 'Polish your Google profile', xp: 25, target: 1 },
]

/** Streak milestones that pay bonus XP, consistency compounds, visibly. */
export const STREAK_MILESTONES: Record<number, number> = { 7: 50, 14: 100, 30: 250 }

function today() {
  const d = new Date()
  // Africa/Johannesburg is UTC+2
  const jhb = new Date(d.getTime() + 2 * 60 * 60 * 1000)
  return jhb.toISOString().slice(0, 10)
}

function dayShift(day: string, deltaDays: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

/**
 * The check-in streak: consecutive SAST days with a completed login
 * challenge, counting today (if already checked in) or ending yesterday.
 * One query, walked in memory, cheap enough to run on every session load.
 */
export async function loginStreak(userId: string): Promise<number> {
  const day = today()
  const rows = await db.challengeProgress.findMany({
    where: { userId, key: 'login', done: true, day: { gte: dayShift(day, -60) } },
    select: { day: true },
  })
  const done = new Set(rows.map((r) => r.day))
  let streak = 0
  let cursor = done.has(day) ? day : dayShift(day, -1)
  while (done.has(cursor)) {
    streak++
    cursor = dayShift(cursor, -1)
  }
  return streak
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
    if (created.done) {
      await awardXp(userId, 'CHALLENGE', def.xp, `Challenge: ${def.label}`)
      if (key === 'login') await rewardStreakMilestone(userId)
    }
    return created
  }
  if (existing.done) return existing
  const count = existing.count + 1
  const done = count >= def.target
  const updated = await db.challengeProgress.update({
    where: { id: existing.id },
    data: { count, done },
  })
  if (done) {
    await awardXp(userId, 'CHALLENGE', def.xp, `Challenge: ${def.label}`)
    if (key === 'login') await rewardStreakMilestone(userId)
  }
  return updated
}

/** On the day the streak hits a milestone, pay the bonus exactly once. */
async function rewardStreakMilestone(userId: string) {
  const streak = await loginStreak(userId)
  const bonus = STREAK_MILESTONES[streak]
  if (!bonus) return
  const day = today()
  const already = await db.xpEvent.findFirst({
    where: { userId, type: 'STREAK', description: { endsWith: `${streak} day streak` }, createdAt: { gte: new Date(`${day}T00:00:00+02:00`) } },
    select: { id: true },
  })
  if (already) return
  await awardXp(userId, 'STREAK', bonus, `Consistency pays: ${streak} day streak`)
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
