import type { Metadata } from 'next'
import { BadgeCheck, Building2, Handshake, ShieldCheck, Users, Wallet } from 'lucide-react'
import Link from 'next/link'
import CorporateClaimForm from '@/components/hp/CorporateClaimForm'

// Task 207: the corporate landing page. Served at /corporate on the main
// domain, and at the root of corporate.hustleportal.online via the host
// rewrite in next.config.ts (add the subdomain in Vercel Domains, one click).
//
// Laws this page obeys:
//  - Truthful numbers only (Landing.tsx law): every figure below is either a
//    real product fact (R108 managed rate, R250+ agency comparison, both from
//    the Task 206 triangle), a price the owner set for corporate onboarding
//    (R550 starting credit, applied by hand at setup), or R0 which is simply
//    true.
//  - The Task 206 managed-rate law: R108 is shown against the agency market,
//    never beside the R15/R18 self-serve reveal prices.
//  - The partnership is named exactly as the owner stated it: strategic
//    partnership with TrinityDirect Consortium, led by Kelo Martin. Nothing
//    about TrinityDirect is invented beyond that.
//  - Boss voice: no dashes in the copy.

export const metadata: Metadata = {
  title: 'HustlePortal Corporate — verified leads for corporate sales floors',
  description:
    'Done for you, verified before a cent moves. R550 in starting credit for corporate accounts. Delivered in strategic partnership with TrinityDirect Consortium.',
}

const TILES = [
  { icon: Wallet, big: 'R550', small: 'in starting credit for your corporate account, applied at setup' },
  { icon: BadgeCheck, big: 'R108', small: 'per verified lead, flat, done for you' },
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

export default function CorporatePage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-14 space-y-12">
        <header className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5" /> HustlePortal Corporate
          </p>
          <h1 className="font-display text-4xl leading-tight">
            Verified leads for corporate sales floors. Done for you.
          </h1>
          <p className="text-muted-foreground">
            Your sellers close; our engine finds and verifies the businesses they sell to. Real contact
            details of real businesses, delivered into your pipeline at one flat managed rate, with
            R550 in starting credit to open the account.
          </p>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Handshake className="h-4 w-4 text-brand" />
            Delivered in strategic partnership with TrinityDirect Consortium, led by Kelo Martin.
          </p>
        </header>

        {/* Truthful numbers only. Every tile is a fact or a price the owner set. */}
        <section className="grid grid-cols-2 gap-3">
          {TILES.map((t) => (
            <div key={t.big} className="rounded-2xl border border-border bg-card p-5 space-y-1.5">
              <t.icon className="h-5 w-5 text-brand" />
              <p className="font-display text-2xl">{t.big}</p>
              <p className="text-xs text-muted-foreground">{t.small}</p>
            </div>
          ))}
        </section>

        {/* The Task 206 triangle, corporate edition. Market first, managed rate second,
            the client's own margin last. Never beside self-serve prices. */}
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
              <p className="text-sm font-semibold text-brand">The corporate rate: R108 per verified lead, flat</p>
              <p className="text-sm text-muted-foreground mt-1">
                Our team runs the finding, the verification and the delivery into your pipeline. One
                flat contractual rate, no ladder, no promos. The rate is the rate.
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
          <h2 className="font-display text-2xl">About the partnership</h2>
          <p className="text-sm text-muted-foreground">
            HustlePortal Corporate is delivered in strategic partnership with TrinityDirect Consortium,
            led by Kelo Martin. The corporate edition of the platform reaches sales teams, agencies and
            franchisors through the consortium, while sourcing, verification and delivery stay on the
            HustlePortal engine the solo version runs on. One engine, two doors: self-serve for owner
            operators, managed for corporate floors.
          </p>
        </section>

        <section className="space-y-4" id="claim">
          <h2 className="font-display text-2xl">Claim your R550 starting credit</h2>
          <CorporateClaimForm />
        </section>

        <footer className="pt-4 border-t border-border space-y-2 text-xs text-muted-foreground">
          <p>
            HustlePortal Corporate · Business Hustle, 99 Kloof St, Gardens, Cape Town · In strategic
            partnership with TrinityDirect Consortium (Kelo Martin).
          </p>
          <p>
            Owner operator or small team? The main{' '}
            <Link href="/" className="text-brand underline underline-offset-2">HustlePortal</Link>{' '}
            experience starts you with R99 in free lead credits and every tool included.
          </p>
        </footer>
      </div>
    </main>
  )
}
