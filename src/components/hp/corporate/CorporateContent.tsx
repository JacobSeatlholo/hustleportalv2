import { BadgeCheck, Building2, Handshake, ShieldCheck, Users, Wallet, FileSignature } from 'lucide-react'
import type { Strategist } from '@/lib/corporate'
import CorporateClaimForm from '@/components/hp/CorporateClaimForm'

// Task 208: the corporate content, shared by the generic door (/corporate) and
// every strategist door (/corporate/<slug>). Laws carried over from Task 207:
// truthful numbers only; the corporate rate never sits beside self-serve prices; no dashes
// in the copy; the partnership is named exactly as the owner stated it.
// Task 210 law (boss): every door is PURE SALES. The referral law, splits and
// member mechanics are internal only (claim API + exec rollup track them); no
// commission content, calculator or ?via talk ever renders client-facing.

const TILES = [
  { icon: Wallet, big: 'R550', small: 'in starting credit for your corporate account, applied at setup' },
  { icon: BadgeCheck, big: 'R110', small: 'per qualified lead reveal, flat, done for you' },
  { icon: Building2, big: 'R250+', small: 'the going agency rate per lead, advertised' },
  { icon: ShieldCheck, big: 'R0', small: 'to claim your credit, and no card is needed' },
]

const STEPS = [
  {
    n: '1',
    title: 'Claim your credit',
    body: 'Fill in the form below. Our corporate team reaches out personally, sets your account up, and applies the R550 starting credit before you spend a cent.',
  },
  {
    n: '2',
    title: 'We find and verify',
    body: 'Managed sourcing runs inside HustlePortal. Businesses are found, contact details are verified by hand and machine, and the leads land in your pipeline ready to work.',
  },
  {
    n: '3',
    title: 'Your sellers close',
    body: 'Verified before a cent moves: an unverified lead is never charged. Your sellers spend their time selling, not hunting for numbers that work.',
  },
]

const WHO = [
  'Sales teams that need a full pipeline, not a lead here and there',
  'Agencies that resell lead generation to their own clients',
  'Franchisors feeding new customer pipelines to their branches',
  'Property, insurance and finance teams working by appointment',
]

// Task 213: the conversion section. Every claim is a real product behaviour —
// verification-before-payment is enforced by the billing code, the flat rate
// is the contractual rate, the e-sign engine is our own (Task 212) and the
// POPIA opt-out is the public /remove-listing flow. No invented testimonials.
const TRUST = [
  {
    icon: ShieldCheck,
    title: 'Verified before a cent moves',
    body: 'Contact details are checked by hand and machine before delivery. An unverified lead is never charged — the check is the guarantee, and it is written into how billing works.',
  },
  {
    icon: Wallet,
    title: 'One flat rate. No ladder.',
    body: 'R110 per qualified lead reveal, contractually fixed. No tiered pricing, no promo games, no surprise line items when volume grows.',
  },
  {
    icon: FileSignature,
    title: 'Signed in minutes, not weeks',
    body: 'Your agreement is signed on our own e-sign system with a timestamped audit certificate under the Electronic Communications and Transactions Act. No printing, no scanning, no chasing signatures.',
  },
  {
    icon: Building2,
    title: 'Done for you',
    body: 'Managed sourcing runs inside the platform: businesses found, verified and delivered into your pipeline ready to work. Your sellers spend their day selling.',
  },
  {
    icon: BadgeCheck,
    title: 'R550 starting credit on us',
    body: 'Applied at setup before you spend a cent — five qualified lead reveals to judge the quality first, with no card needed to claim.',
  },
  {
    icon: Users,
    title: 'POPIA-aware sourcing',
    body: 'Business contact data is processed lawfully under POPIA. Any listed business can remove itself from the pipeline in one click, and the suppression holds.',
  },
]

export default function CorporateContent({ partner }: { partner?: Strategist }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-14 space-y-12">
      <header className="space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5" />
          {partner ? `${partner.company} · HustlePortal Corporate` : 'HustlePortal Corporate'}
        </p>
        <h1 className="font-display text-4xl leading-tight">
          Verified leads for corporate sales floors. Done for you.
        </h1>
        <p className="text-muted-foreground">
          Your sellers close; our engine finds and verifies the businesses they sell to. Real contact
          details of real businesses, delivered into your pipeline at one flat managed rate, with
          R550 in starting credit to open the account.
        </p>
        {partner ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Handshake className="h-4 w-4 text-brand" />
            Presented by {partner.name} of {partner.company}, in strategic partnership with HustlePortal.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Handshake className="h-4 w-4 text-brand" />
            Delivered by the Business Hustle corporate desk, on the same verified engine behind HustlePortal.
          </p>
        )}
      </header>

      {partner && (
        <section className="flex items-center gap-5 rounded-2xl border border-border bg-card p-5">
          {/* White frame keeps the logo's own white field crisp on both looks. */}
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-border">
            <img src={partner.image} alt={`${partner.company} logo`} className="h-full w-full object-contain" />
          </div>
          <div className="space-y-1">
            <p className="font-semibold">{partner.company}</p>
            <p className="text-sm text-muted-foreground">{partner.tagline}</p>
            <p className="text-xs text-muted-foreground">Led by {partner.name}</p>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3">
        {TILES.map((t) => (
          <div key={t.big} className="rounded-2xl border border-border bg-card p-5 space-y-1.5">
            <t.icon className="h-5 w-5 text-brand" />
            <p className="font-display text-2xl">{t.big}</p>
            <p className="text-xs text-muted-foreground">{t.small}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl">The maths your CFO will actually like</h2>
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm font-semibold">The market: R250+ per lead, advertised</p>
            <p className="text-sm text-muted-foreground mt-1">
              South African pay-per-lead agencies advertise from R250 per lead, quoted per industry
              and volume. That is the price of doing it through someone else.
            </p>
          </div>
          <div className="rounded-2xl border border-brand/40 bg-brand/5 p-5">
            <p className="text-sm font-semibold text-brand">The corporate rate: R110 per qualified lead reveal, flat</p>
            <p className="text-sm text-muted-foreground mt-1">
              Our team runs the finding, the verification and the delivery into your pipeline. One
              flat contractual rate, no ladder, no promos. The R550 starting credit is exactly five
              managed leads, on us. The rate is the rate.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm font-semibold">Your side of the maths: your margin</p>
            <p className="text-sm text-muted-foreground mt-1">
              Bring your average deal value to the table and the arithmetic finishes itself. One
              closed deal covers more than a hundred managed leads at most margins.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl">How it works</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card p-5 space-y-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white text-sm font-semibold">
                {s.n}
              </span>
              <p className="font-semibold text-sm">{s.title}</p>
              <p className="text-xs text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl">Built for rooms like yours</h2>
        <ul className="space-y-2">
          {WHO.map((w) => (
            <li key={w} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4 mt-0.5 text-brand shrink-0" /> {w}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl">Why corporate floors sign with HustlePortal</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {TRUST.map((t) => (
            <div key={t.title} className="rounded-2xl border border-border bg-card p-5 space-y-1.5">
              <t.icon className="h-5 w-5 text-brand" />
              <p className="text-sm font-semibold">{t.title}</p>
              <p className="text-xs text-muted-foreground">{t.body}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Every corporate account is opened on a written agreement signed on our own e-sign system,
          with a timestamped audit certificate. Business contact data is handled under POPIA and any
          listed business can opt out in one click, so the pipeline you buy stays clean.
        </p>
      </section>

      <section className="space-y-4" id="claim">
        <h2 className="font-display text-2xl">Claim your R550 starting credit</h2>
        <CorporateClaimForm refSlug={partner?.slug} />
      </section>
    </div>
  )
}
