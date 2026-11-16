// ============ CORPORATE: the brand strategist program (Task 208) ============
//
// The boss equips brand strategists to close corporate deals on HustlePortal's
// behalf. Each strategist gets a branded door: /corporate/<slug>. The page is
// the tool; the referral law is the economics:
//
//   R50 per managed lead delivered to a corporate account the strategist
//   referred. When the lead is sourced by a member the strategist enrolled,
//   the R50 splits: R25 to the strategist, R25 to the sourcing member.
//
// Attribution rides the claim: the corporate claim form posts refSlug (the
// strategist) and refMember (which enrolled member sourced it), stored on the
// CorporateLead row. Tracking lives in /api/admin/exec/corporate (exec only).
// Payout accrual against delivered leads lands with DFY billing (Task 203
// roadmap) — the claim attribution is the honest root of that ledger.

export interface StrategistMember {
  /** Short code the member puts in their outreach link: ?via=<code> */
  code: string
  name: string
}

export interface Strategist {
  slug: string
  /** The person the boss pays. */
  name: string
  company: string
  tagline: string
  /** Company image under /corporate/ (public/corporate/). */
  image: string
  members: StrategistMember[]
}

/** The referral law, in cents. One source of truth for page, calculator and API. */
export const REFERRAL_PER_LEAD_CENTS = 5000 // R50 per managed lead to the strategist
export const MEMBER_SPLIT_CENTS = 2500 // R25 of it when a enrolled member sourced the lead

export const STRATEGISTS: Strategist[] = [
  {
    slug: 'trinitydirect',
    name: 'Kelo Martin',
    company: 'TrinityDirect Consortium',
    tagline: 'Corporate sales floors, equipped.',
    image: '/corporate/trinitydirect-logo.jpg',
    members: [],
  },
]

export function getStrategist(slug: string): Strategist | undefined {
  return STRATEGISTS.find((s) => s.slug === slug.toLowerCase().trim())
}

export function getStrategistMember(slug: string, code: string): StrategistMember | undefined {
  const s = getStrategist(slug)
  if (!s) return undefined
  return s.members.find((m) => m.code.toLowerCase().trim() === code.toLowerCase().trim())
}

export function rand(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`
}
