import { db } from '@/lib/db'
import { planState } from '@/lib/limits'

/**
 * Daily AI cost guard — the DB is the only place a spend limit is real.
 * One atomic upsert per call: the count increments and the caller learns
 * whether the day's allowance is used up BEFORE any Gemini/DeepSeek money
 * is spent. Parallel calls cannot race past the cap (the row upsert is
 * serialized by the unique index).
 *
 * Limits are deliberately generous — this is an abuse ceiling, not a
 * product meter: free 60 AI documents a day, paid 600. A human tapping
 * pitch/email/plan buttons never touches these numbers; a script hammering
 * the endpoints burns our API bill instead.
 */

export const FREE_AI_DAILY = 60
export const PAID_AI_DAILY = 600

/** "Today" in South Africa — the whole customer base lives in SAST. */
export function aiDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())
}

export interface AiBudgetVerdict {
  ok: boolean
  used: number
  limit: number
  retryAfterSec?: number
}

/**
 * Check + consume one AI action for the user on this SAST day.
 * Consume-then-tell: the row increments first, and if the count exceeds the
 * cap the caller must refuse the work (a marginal overshoot of one call on
 * a tie is acceptable; missing a real user's action is not).
 */
export async function consumeAiBudget(userId: string): Promise<AiBudgetVerdict> {
  const { paid } = await planState(userId)
  const limit = paid ? PAID_AI_DAILY : FREE_AI_DAILY
  const day = aiDay()
  const row = await db.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    update: { count: { increment: 1 } },
    create: { userId, day, count: 1 },
  })
  if (row.count > limit) {
    // Reopens at midnight SAST — say so honestly instead of a cold 429.
    return { ok: false, used: row.count, limit, retryAfterSec: 3600 }
  }
  return { ok: true, used: row.count, limit }
}

/** Shared 429 body for the AI budget. */
export function aiBudgetExceeded(v: AiBudgetVerdict): { error: string; used: number; limit: number } {
  return {
    error:
      `You have used today's ${v.limit} AI generations. The counter resets at midnight (South African time) — or go Operator for 600 a day.`,
    used: v.used,
    limit: v.limit,
  }
}
