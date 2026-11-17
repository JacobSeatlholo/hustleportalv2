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

import type { Metadata } from 'next'

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
  /** Gated partner dashboard (?key=) — the strategist's own funnel metrics. */
  dashboardKey: string
  /** Where the background digest lands (the partner's own inbox). */
  contactEmail?: string
}

/** The referral law, in cents. One source of truth for page, calculator and API. */
export const REFERRAL_PER_LEAD_CENTS = 5000 // R50 per managed lead to the strategist
export const MEMBER_SPLIT_CENTS = 2500 // R25 of it when a enrolled member sourced the lead

export const STRATEGISTS: Strategist[] = [
  {
    slug: 'trinitydirect',
    // Formal entity identity per Kelo Anthony Martins' partnership letter.
    name: 'Kelo Anthony Martins',
    company: 'Trinity Direct Consortium (Pty) Ltd',
    tagline: 'Corporate sales floors, equipped.',
    image: '/corporate/trinitydirect-logo.jpg',
    members: [],
    // The partner dashboard gate. Separate from the deal-room key on
    // purpose: the dashboard is the strategist's daily surface, the deal
    // room holds documents and the e-sign sender.
    dashboardKey: 'bh-tdc-dashboard-8v3nq5',
    // The background digest lands here — the deal-room signer's address,
    // the partnership's working inbox.
    contactEmail: 'kelo@trinitydirect.co.za',
  },
]

// The corporate rate, aligned to the TDC agreement terms (Kelo's email,
// Nov 2026): customer-facing R110 per qualified lead reveal, split R60 to the
// Business Hustle entity and R50 to Trinity Direct Consortium (Pty) Ltd on
// clients introduced by the Consortium. R110 makes the R550 starting credit
// exactly five managed leads, which is why it beats the old R108.
export const MANAGED_PER_LEAD_CENTS = 11000

export function getStrategist(slug: string): Strategist | undefined {
  return STRATEGISTS.find((s) => s.slug === slug.toLowerCase().trim())
}

export function getStrategistMember(slug: string, code: string): StrategistMember | undefined {
  const s = getStrategist(slug)
  if (!s) return undefined
  return s.members.find((m) => m.code.toLowerCase().trim() === code.toLowerCase().trim())
}

// ============ WHITELABEL HEAD (Task 214) ============
// The root layout ships HustlePortal-branded metadata (og:title, application
// name, apple web app title, keywords). Every partner surface overrides ALL of
// it with the strategist's brand — link shares, app titles and search snippets
// must never reveal the engine behind the door.
export function whitelabelMeta(s: Strategist, title: string, description: string): Metadata {
  const og = { title, description, siteName: s.company, images: [{ url: s.image }] }
  return {
    title,
    description,
    applicationName: s.company,
    keywords: [s.company, s.name, 'verified leads', 'corporate sales', 'lead generation South Africa'],
    appleWebApp: { capable: true, title: s.company, statusBarStyle: 'black-translucent' },
    openGraph: { ...og, url: `/corporate/${s.slug}`, type: 'website' },
    twitter: { card: 'summary_large_image', ...og },
  }
}

/** Neutral head for signing pages: brand without the engine's name. */
export function neutralSignMeta(brand: string): Metadata {
  const og = { title: 'Sign document', description: 'First-party electronic signing — review, initial each page and sign.', siteName: brand, images: [] as { url: string }[] }
  return {
    title: `Sign document — ${brand}`,
    applicationName: brand,
    keywords: ['electronic signature', 'ECT Act 25 of 2002', 'sign document'],
    appleWebApp: { capable: true, title: brand, statusBarStyle: 'black-translucent' },
    openGraph: { ...og, type: 'website' },
    twitter: { card: 'summary', ...og },
  }
}

export function rand(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`
}
