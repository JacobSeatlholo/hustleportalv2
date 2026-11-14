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

// ---- B2B done-for-you track ----
// The strategist agreement's R108: the premium rate companies pay for managed,
// done-for-you lead work for their teams. Flat and contractual — the level
// ladder and operator promos belong to the self-serve (B2C) world and never
// discount a DFY contract.
export const DFY_REVEAL_PRICE_CENTS = 10800
export type PricingTier = 'SELF_SERVE' | 'PREMIUM_DFY'
export const PRICING_TIERS: PricingTier[] = ['SELF_SERVE', 'PREMIUM_DFY']

export function isPremiumTier(tier?: string | null): boolean {
  return tier === 'PREMIUM_DFY'
}

/** The till's price for one reveal — the whole pricing rule in one place. */
export function revealPriceFor(tier: string | null | undefined, level: number): number {
  return isPremiumTier(tier) ? DFY_REVEAL_PRICE_CENTS : revealPriceForLevel(level)
}
