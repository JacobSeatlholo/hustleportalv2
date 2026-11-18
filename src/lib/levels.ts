/**
 * levels.ts, the pure hustle ladder, safe to import from client components
 * (no database here). gamification.ts builds on it server-side.
 */
export const LEVELS = [
  { level: 1, name: 'Seedling', min: 0, icon: '🌱', rewardCents: 0, reward: 'Starter credits on signup' },
  { level: 2, name: 'Builder', min: 100, icon: '🔧', rewardCents: 500, reward: 'R5 wallet credit' },
  { level: 3, name: 'Operator', min: 300, icon: '⚡', rewardCents: 1000, reward: 'R10 wallet credit + R15 lead reveals' },
  { level: 4, name: 'Closer', min: 700, icon: '🎯', rewardCents: 1500, reward: 'R15 wallet credit + R15 lead reveals' },
  { level: 5, name: 'Boss', min: 1200, icon: '👑', rewardCents: 2500, reward: 'R25 wallet credit + R15 lead reveals' },
  { level: 6, name: 'Tycoon', min: 2500, icon: '🏆', rewardCents: 5000, reward: 'R50 wallet credit + R15 lead reveals' },
]

export function levelFor(xp: number) {
  let current = LEVELS[0]
  for (const l of LEVELS) if (xp >= l.min) current = l
  const next = LEVELS.find((l) => l.min > current.min) || null
  const span = next ? next.min - current.min : 1
  const progress = next ? Math.min(100, Math.round(((xp - current.min) / span) * 100)) : 100
  return { ...current, next, progress }
}

// ---- Lead reveal pricing: the level perk, one source of truth ----
// The list price (R18) is what anyone pays at the reveal till; Operator (L3)
// and up have earned the R15 price. Enforced server-side at the till, the UI
// only displays it.
export const STANDARD_REVEAL_PRICE_CENTS = 1800
export const DISCOUNTED_REVEAL_PRICE_CENTS = 1500
export const REVEAL_DISCOUNT_MIN_LEVEL = 3

export function revealPriceForLevel(level: number) {
  return level >= REVEAL_DISCOUNT_MIN_LEVEL ? DISCOUNTED_REVEAL_PRICE_CENTS : STANDARD_REVEAL_PRICE_CENTS
}

// ---- The self-serve ladder (Task 215, pricing strategy 4.1/4.2; live from
// Task 217) ----
// New accounts from 18 November 2026 pay R60 per reveal at levels 1-2 and the
// price falls as the member levels up: R48 at Operator 3, R36 at Closer 4,
// R24 at Boss 5, R15 at Tycoon 6. Accounts created before the cutoff keep the
// launch economics permanently (R18 list, R15 at Operator 3) — nobody's money
// shrinks, credit balances keep their exact purchasing power. The cohort is
// DERIVED from createdAt, so no migration touches existing accounts.
// Task 217 (owner, at the Trinity Direct verdict): the ladder was brought
// forward from 1 December — the R60 entry rate IS the DIY offer the main page
// now advertises, and the R18-welcome-parity Kelo flagged dies today.
export const LADDER_START_ISO = '2026-11-18T00:00:00+02:00'
const LADDER_START = new Date(LADDER_START_ISO).getTime()
export const LADDER_REVEAL_CENTS = [6000, 6000, 4800, 3600, 2400, 1500] as const
export type PricingCohort = 'LEGACY' | 'LADDER'

export function cohortFor(createdAt?: string | Date | null): PricingCohort {
  if (!createdAt) return 'LEGACY'
  const t = new Date(createdAt).getTime()
  return Number.isFinite(t) && t >= LADDER_START ? 'LADDER' : 'LEGACY'
}

export function ladderRevealPriceForLevel(level: number): number {
  const idx = Math.min(Math.max(level, 1), LADDER_REVEAL_CENTS.length) - 1
  return LADDER_REVEAL_CENTS[idx]
}

// ---- B2B done-for-you track ----
// The corporate rate: R110 per qualified lead reveal, standardised with the
// Trinity Direct Consortium partnership terms (Kelo's email, Nov 2026) so the
// R550 starting credit is exactly five managed leads. Flat and contractual —
// the level ladder and operator promos belong to the self-serve (B2C) world
// and never discount a DFY contract.
export const DFY_REVEAL_PRICE_CENTS = 11000
export type PricingTier = 'SELF_SERVE' | 'PREMIUM_DFY'
export const PRICING_TIERS: PricingTier[] = ['SELF_SERVE', 'PREMIUM_DFY']

export function isPremiumTier(tier?: string | null): boolean {
  return tier === 'PREMIUM_DFY'
}

/** The till's price for one reveal — the whole pricing rule in one place. */
export function revealPriceFor(tier: string | null | undefined, level: number, cohort?: PricingCohort | string | null): number {
  if (isPremiumTier(tier)) return DFY_REVEAL_PRICE_CENTS
  if (cohort === 'LADDER') return ladderRevealPriceForLevel(level)
  return revealPriceForLevel(level)
}

// ---- The till's anchor line (Task 206, on the record) ----
// Anchoring psychology: the first rand figure the eye reads becomes the
// reference the member judges their own price against, so the till shows the
// big comparisons with the member's price, never the member's price alone.
// The two anchors are ones the portal owns honestly: our own managed rate,
// and the "from R250/lead" that South African pay-per-lead agencies advertise
// (web-sourced Nov 2026, used as a labeled market reference, not a quote).
export const AGENCY_PER_LEAD_CENTS = 25000

export function tillAnchorLine(tier: string | null | undefined, level: number, cohort?: PricingCohort | string | null): string | null {
  if (isPremiumTier(tier)) {
    // DFY accounts never see their own rate beside R15 — their anchor is the market only.
    return 'Agencies charge R250+ per lead — this one is managed, and verified before a cent moves.'
  }
  // The managed-rate anchor is derived from the DFY constant so the two can
  // never drift apart (the R108→R110 standardisation missed this line once).
  const managed = (DFY_REVEAL_PRICE_CENTS / 100).toFixed(0)
  const self = (revealPriceFor(tier, level, cohort) / 100).toFixed(0)
  return `Managed rate R${managed} · agencies charge R250+ per lead · your price R${self}, verified or you don't pay.`
}
