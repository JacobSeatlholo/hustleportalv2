/**
 * leadsignal.ts, the learning loop.
 *
 * Every save is a right swipe, every dismissal a left swipe with a reason.
 * The signals build a per seller taste profile: which trades they keep, which
 * they reject, and the faces they never want to see again. The discovery
 * engine reads this file's aggregates on every scan, so the deck a seller
 * sees tomorrow is shaped by what they taught it today. That compounding
 * profile is the moat: it lives in our database, keyed to our member, and
 * no competitor can buy it or copy it.
 */

import { db } from '@/lib/db'
import { normKey } from '@/lib/leadpool'
import { resolveTrade } from '@/lib/taxonomy'

export const SIGNAL_SAVE = 'SAVE'
export const SIGNAL_DISMISS = 'DISMISS'

/** One tap reasons a seller can give when a lead is not for them. */
export const DISMISS_REASONS = [
  'WRONG_INDUSTRY',
  'TOO_FAR',
  'TOO_BIG',
  'TOO_SMALL',
  'ALREADY_CLIENT',
  'NOT_NOW',
] as const
export type DismissReason = (typeof DISMISS_REASONS)[number]

const SIGNALS = new Set([SIGNAL_SAVE, SIGNAL_DISMISS])
const REASONS = new Set<string>(DISMISS_REASONS)

export interface LeadSignalInput {
  signal: string
  reason?: string | null
  company: string
  industry?: string | null
  city?: string | null
  source?: string | null
}

/** Persist one swipe. The trade is resolved server side so the client never dictates it. */
export async function recordLeadSignal(userId: string, input: LeadSignalInput): Promise<boolean> {
  const signal = String(input.signal || '').toUpperCase()
  if (!SIGNALS.has(signal)) return false
  const company = String(input.company || '').trim()
  if (!company || company.length > 200) return false
  let reason: string | null = null
  if (signal === SIGNAL_DISMISS && input.reason) {
    const r = String(input.reason).toUpperCase()
    reason = REASONS.has(r) ? r : null
  }
  const industry = String(input.industry || '').trim().slice(0, 120) || null
  const city = String(input.city || '').trim().slice(0, 80) || null
  const trade = resolveTrade(`${industry || ''} ${company}`)
  try {
    await db.leadSignal.create({
      data: {
        userId,
        signal,
        reason,
        companyKey: normKey(company),
        categoryKey: trade?.key ?? null,
        city,
        industry,
        source: String(input.source || '').trim().slice(0, 30) || null,
      },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Faces the seller swiped left on never serve again. Same contract as
 * userSavedKeys, fed from the dismissal signals.
 */
export async function userDismissedKeys(userId: string): Promise<Set<string>> {
  try {
    const rows = await db.leadSignal.findMany({
      where: { userId, signal: SIGNAL_DISMISS },
      select: { companyKey: true },
      take: 2000,
    })
    return new Set(rows.map((r) => r.companyKey).filter(Boolean))
  } catch {
    return new Set()
  }
}

/**
 * The taste profile, per trade, as a multiplier on the fit part of the
 * composite. Saves pull the trade up, dismissals pull it down, and a
 * WRONG_INDUSTRY dismissal speaks twice as loud as any other reason.
 * Counts saturate so one wild day cannot dominate forever, and the whole
 * curve is clamped: the seller keeps meeting new trades even after a bad
 * streak, they just see less of what they rejected.
 */
export async function categoryWeights(userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const rows = await db.leadSignal.findMany({
      where: { userId, categoryKey: { not: null } },
      select: { signal: true, reason: true, categoryKey: true },
      take: 3000,
      orderBy: { createdAt: 'desc' },
    })
    const saves = new Map<string, number>()
    const hard = new Map<string, number>()
    for (const r of rows) {
      const k = r.categoryKey as string
      if (r.signal === SIGNAL_SAVE) saves.set(k, Math.min(6, (saves.get(k) || 0) + 1))
      else if (r.signal === SIGNAL_DISMISS) {
        const weight = r.reason === 'WRONG_INDUSTRY' ? 1.5 : 1
        hard.set(k, Math.min(6, (hard.get(k) || 0) + weight))
      }
    }
    const keys = new Set([...saves.keys(), ...hard.keys()])
    for (const k of keys) {
      const mult = 1 + 0.14 * (saves.get(k) || 0) - 0.2 * (hard.get(k) || 0)
      out.set(k, Math.max(0.5, Math.min(1.4, mult)))
    }
  } catch {
    /* the loop must never break a scan: no signals, neutral weights */
  }
  return out
}
