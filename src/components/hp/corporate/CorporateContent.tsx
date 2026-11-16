import { BadgeCheck, Building2, Handshake, ShieldCheck, Users, Wallet, Link2 } from 'lucide-react'
import type { Strategist } from '@/lib/corporate'
import { REFERRAL_PER_LEAD_CENTS, MEMBER_SPLIT_CENTS, rand } from '@/lib/corporate'
import CorporateClaimForm from '@/components/hp/CorporateClaimForm'
import EarningsCalculator from '@/components/hp/corporate/EarningsCalculator'

// Task 208: the corporate content, shared by the generic door (/corporate) and
// every strategist door (/corporate/<slug>). Laws carried over from Task 207:
// truthful numbers only; the corporate rate never sits beside self-serve prices; no dashes
// in the copy; the partnership is named exactly as the owner stated it.

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
            Delivered through brand strategists we trust, starting with TrinityDirect Consortium.
          </p>
        )}
      </header>

      {partner && (
        <section className="flex items-center gap-5 rounded-2xl border border-border bg-card p-5">
          {/* White frame keeps the logo's own white field crisp on both looks. */}
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
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

      {partner ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">For {partner.name}'s partners and team</h2>
          <p className="text-sm text-muted-foreground">
            This page is {partner.company}'s corporate door. When an office you refer claims their
            credit here, the claim is tracked to {partner.name} and the referral law pays:{' '}
            {rand(REFERRAL_PER_LEAD_CENTS)} per managed lead the account takes. Leads sourced by a
            member you enrolled split {rand(REFERRAL_PER_LEAD_CENTS - MEMBER_SPLIT_CENTS)} to you and{' '}
            {rand(MEMBER_SPLIT_CENTS)} to them, so your network earns with you. Share your door's
            address, and add <span className="font-mono text-brand">?via=yours</span> once your member
            code is registered.
          </p>
          <EarningsCalculator partnerName={partner.company} />
        </section>
      ) : (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Our brand strategists</h2>
          <p className="text-sm text-muted-foreground">
            Corporate accounts come through strategists we trust, each running their own door with the
            same offer, the same rate and the same verified pipeline behind it.
          </p>
          <a
            href="/corporate/trinitydirect"
            className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition hover:border-brand/50"
          >
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/corporate/trinitydirect-logo.jpg" alt="TrinityDirect Consortium logo" className="h-full w-full object-contain" />
            </div>
            <div className="flex-1">
              <p className="font-semibold flex items-center gap-2">
                TrinityDirect Consortium <Link2 className="h-3.5 w-3.5 text-brand" />
              </p>
              <p className="text-sm text-muted-foreground">Led by Kelo Martin · corporate sales floors, equipped.</p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide text-brand">Visit the door</span>
          </a>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-2xl">About the partnership</h2>
        <p className="text-sm text-muted-foreground">
          {partner ? (
            <>
              HustlePortal Corporate is delivered in strategic partnership with Trinity Direct
              Consortium (Pty) Ltd, led by Director Kelo Anthony Martins. The corporate edition of the
              platform reaches sales teams, agencies and franchisors through the consortium, while
              sourcing, verification and delivery stay on the HustlePortal engine the solo version
              runs on. Per the partnership terms: on clients introduced by the Consortium, the
              customer-facing rate is R110 per qualified lead reveal, of which R60 runs the engine and
              R50 is the Consortium's referral share. One engine, two doors: self-serve for owner
              operators, managed for corporate floors.
            </>
          ) : (
            <>
              HustlePortal Corporate is delivered through brand strategists in strategic partnership with
              HustlePortal. Each strategist runs their own door, presents the same offer, and is tracked
              and paid on the referrals they bring. Sourcing, verification and delivery stay on the
              HustlePortal engine the solo version runs on. One engine, many doors: self-serve for owner
              operators, managed for corporate floors.
            </>
          )}
        </p>
      </section>

      <section className="space-y-4" id="claim">
        <h2 className="font-display text-2xl">Claim your R550 starting credit</h2>
        <CorporateClaimForm refSlug={partner?.slug} />
      </section>
    </div>
  )
}
