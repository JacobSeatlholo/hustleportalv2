/**
 * Subscription plans — the predictable-MRR engine.
 * Target: R45,000/month. e.g. 100 Operator + 50 Boss = R44,850, or 226 Operator.
 * ZAR only. Plans sold via Yoco Checkout (manual renewal — the user is never
 * auto-charged); renewal nudged in-app + by email 5 days out.
 *
 * Lead-reveal delivery: each successful plan activation/renewal grants the
 * month's reveal quota as wallet credits (revealCredits, priced at the lead
 * reveal price). Credits NEVER expire — unused reveals roll over for as long
 * as the plan stays active. That makes the subscription an asset, not a rental.
 */

export interface PlanDef {
  id: 'HUSTLER' | 'BOSS'
  name: string
  tagline: string
  priceCents: number
  /** Annual price in cents = 10 months (2 months free). */
  annualCents: number
  /** Lead-reveal credits granted on every activation/renewal (cents of wallet credit). */
  revealCredits: number
  perks: string[]
  highlight?: boolean
}

/** Wallet-cent price of one verified lead reveal (keep in sync with CONFIG_KEYS.LEAD_PRICE default). */
export const LEAD_REVEAL_PRICE_CENTS = 1500

function annualOf(priceCents: number): number {
  return priceCents * 10
}

export const PLANS: PlanDef[] = [
  {
    id: 'HUSTLER',
    name: 'Operator',
    tagline: 'For owner-operators building steady momentum.',
    priceCents: 19900, // R199
    annualCents: annualOf(19900), // R1,990/yr — 2 months free
    revealCredits: 5 * LEAD_REVEAL_PRICE_CENTS, // 5 verified reveals
    perks: [
      'Unlimited AI Co-Founder & email drafts',
      '5 verified lead reveals every month — unused ones roll over',
      'Invoices, calendar, reports, exports',
      'Invite & earn R50 per paying member',
      'Your business listed in the public business directory',
    ],
  },
  {
    id: 'BOSS',
    name: 'Boss',
    tagline: 'For teams ready to outscale the competition.',
    priceCents: 49900, // R499
    annualCents: annualOf(49900), // R4,990/yr — 2 months free
    revealCredits: 12 * LEAD_REVEAL_PRICE_CENTS, // 12 verified reveals — the better per-lead deal
    perks: [
      'Everything in Operator',
      '12 verified lead reveals every month — the best per-lead price, unused ones roll over',
      'Up to 5 team seats, shared pipeline',
      'Priority AI (longer context, faster replies)',
      'Founding Member badge on your profile',
    ],
    highlight: true,
  },
]

export function getPlan(id: string): PlanDef | undefined {
  return PLANS.find((p) => p.id === id)
}

/**
 * Nonprofit rate — registered NPOs (and NGOs) run their organisation on
 * HustlePortal at 30% off every plan, monthly or annual. The number is taken
 * on honour, stored on the subscription, and may be re-checked before renewal.
 */
export const NPO_DISCOUNT_RATE = 0.3

export function priceWithNpoDiscount(cents: number): number {
  return Math.round(cents * (1 - NPO_DISCOUNT_RATE))
}

/** SA NPO numbers look like 044-291, 123-456, NPO 078-112 or plain 123456. */
export function isValidNpoNumber(v: string): boolean {
  const s = v.trim().toUpperCase().replace(/^NPO[\s-]*/, '')
  return /^\d{2,3}[\s-]?\d{3,4}$/.test(s)
}

export function normalizeNpoNumber(v: string): string {
  return v.trim().toUpperCase().replace(/^NPO[\s-]*/, 'NPO ')
}

/**
 * Deliver the plan's monthly lead-reveal quota as wallet credits. Called once
 * per successful activation/renewal (idempotent via the PENDING→ACTIVE claim),
 * so every paid month lands the promised reveals in the wallet automatically.
 */
export async function grantPlanRevealCredits(userId: string, plan: PlanDef): Promise<void> {
  const { addCredits } = await import('@/lib/wallet')
  const reveals = Math.round(plan.revealCredits / LEAD_REVEAL_PRICE_CENTS)
  await addCredits(
    userId,
    plan.revealCredits,
    'BONUS',
    `${plan.name} plan — ${reveals} verified lead reveals${reveals >= 12 ? ' (best per-lead price)' : ''}`,
  )
}

/** Monthly recurring revenue target for the platform owner, in cents. */
export const MRR_TARGET_CENTS = 4_500_000 // R45,000

/** Referral rewards: credited to the referrer's wallet. */
export const REFERRAL_REWARD_SIGNUP_CENTS = 1000 // R10 when an invitee signs up
export const REFERRAL_REWARD_PAID_CENTS = 5000 // R50 when an invitee subscribes
