'use client'

/**
 * Conversion touchpoints, every key moment in the product is a potential,
 * GENTLE introduction to a Business Hustle service or store package.
 *
 * The rules that keep this trust-first (never sales-heavy):
 *   1. CONTEXT ONLY, a touchpoint fires at the exact moment it is useful.
 *      Never banners-on-every-page, never popups over popups.
 *   2. NEVER BLOCKING, the user's work always completes first; the card
 *      appears after success, as a natural next step.
 *   3. FREQUENCY-CAPPED, each touchpoint can snooze itself for days or
 *      retire permanently (per device), so regulars never feel nagged.
 *   4. PROFESSIONAL TONE, outcome-first copy, real prices, one tap to act,
 *      one tap to dismiss.
 *
 * Tagline that anchors the whole system:
 *   "We feed your pipeline. You run your business."
 */

export interface TpRecord {
  retired?: boolean
  /** Epoch ms until which this touchpoint is snoozed. */
  until?: number
  shows?: number
}

const storageKey = (id: string) => `hp_tp:${id}`

function read(id: string): TpRecord {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(storageKey(id)) || '{}') as TpRecord
  } catch {
    return {}
  }
}

function write(id: string, rec: TpRecord) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(rec))
  } catch {
    // private mode, touchpoints simply reappear, acceptable
  }
}

/** Whether this touchpoint is allowed to show right now (not retired / not snoozed). */
export function tpCanShow(id: string): boolean {
  const r = read(id)
  return !r.retired && Date.now() >= (r.until || 0)
}

/** Record one showing; auto-retire once maxShows is reached. */
export function tpMarkShown(id: string, maxShows = 2) {
  const r = read(id)
  r.shows = (r.shows || 0) + 1
  if (r.shows >= maxShows) r.retired = true
  write(id, r)
}

export function tpSnooze(id: string, days: number) {
  write(id, { ...read(id), until: Date.now() + days * 86_400_000 })
}

export function tpRetire(id: string) {
  write(id, { ...read(id), retired: true })
}
