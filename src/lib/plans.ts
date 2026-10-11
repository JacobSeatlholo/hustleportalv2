/**
 * Subscription plans — the predictable-MRR engine.
 * Target: R45,000/month. e.g. 100 Hustler + 50 Boss = R44,850, or 226 Hustler.
 * ZAR only. Monthly plans sold via Yoco Checkout; renewal nudged in-app 5 days out.
 */

export interface PlanDef {
  id: 'HUSTLER' | 'BOSS'
  name: string
  tagline: string
  priceCents: number
  perks: string[]
  highlight?: boolean
}

export const PLANS: PlanDef[] = [
  {
    id: 'HUSTLER',
    name: 'Hustler',
    tagline: 'For the solo grinder building momentum.',
    priceCents: 19900, // R199
    perks: [
      'Unlimited AI Co-Founder & email drafts',
      '30 verified lead reveals every month',
      'Invoices, calendar, reports, exports',
      'Invite & earn R50 per paying member',
      'Your business listed in the hustle directory',
    ],
  },
  {
    id: 'BOSS',
    name: 'Boss',
    tagline: 'For teams ready to outscale the competition.',
    priceCents: 49900, // R499
    perks: [
      'Everything in Hustler',
      '100 verified lead reveals every month',
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

/** Monthly recurring revenue target for the platform owner, in cents. */
export const MRR_TARGET_CENTS = 4_500_000 // R45,000

/** Referral rewards: credited to the referrer's wallet. */
export const REFERRAL_REWARD_SIGNUP_CENTS = 1000 // R10 when an invitee signs up
export const REFERRAL_REWARD_PAID_CENTS = 5000 // R50 when an invitee subscribes
