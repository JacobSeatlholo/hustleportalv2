import { BadgeCheck, Building2, Handshake, ShieldCheck, Users, Wallet, FileSignature, Zap, MessageSquareQuote, LogIn, Star } from 'lucide-react'
import type { Strategist } from '@/lib/corporate'
import CorporateSignupForm from '@/components/hp/CorporateSignupForm'
import CorporateAccessGate from '@/components/hp/CorporateAccessGate'
import CorporateCalculator from '@/components/hp/CorporateCalculator'
import TestimonialForm from '@/components/hp/TestimonialForm'

// Approved testimonial rows the page's server component fetched (Task 219).
// Only human-approved rows ever reach this prop — the wall cannot show a
// pending story.
export type WallRow = {
  id: string
  name: string
  business: string | null
  location: string | null
  body: string
  rating: number
}

// Task 208: the corporate content, shared by the generic door (/corporate) and
// every strategist door (/corporate/<slug>). Laws carried over from Task 207:
// truthful numbers only; the corporate rate never sits beside self-serve prices; no dashes
// in the copy; the partnership is named exactly as the owner stated it.
// Task 210 law (boss): every door is PURE SALES. The referral law, splits and
// member mechanics are internal only (claim API + exec rollup track them); no
// commission content or ?via talk ever renders client-facing. Task 215 adds
// the ONE client-facing calculator the owner asked for: pricing maths only
// (R110 vs the R250+ agency anchor), never commission economics.
// Task 216 law (boss, offer asymmetry): the two doors carry DIFFERENT credits
// by design, so nobody circumvents a strategist link. Task 217 (boss, at the
// Trinity Direct verdict) makes the ladder three rungs and states it plainly:
// R550 exact-five is the strategist door credit, R120 is the access-code
// credit on this door, R99 is the bare-application welcome. Every circumvention
// ends on a cheaper rung, never a better one. The strategist door also carries
// the real searches sweetener: DFY accounts get a 200/day engine allowance,
// enforced in the scan gate (leadpool), so the tile states a fact, not a hope.
function tiles(partner?: Strategist) {
  return partner
    ? [
        { icon: Wallet, big: 'R550', small: 'in starting credit for your corporate account, applied at setup' },
        { icon: BadgeCheck, big: 'R110', small: 'per qualified lead reveal, flat, done for you' },
        { icon: Zap, big: '200', small: 'lead searches a day, on us — your own hunting between managed batches' },
        { icon: Building2, big: 'R250+', small: 'the going agency rate per lead, advertised' },
      ]
    : [
        { icon: Wallet, big: 'R550', small: 'in starting credit when your account opens through an authorized brand strategist' },
        { icon: BadgeCheck, big: 'R110', small: 'per qualified lead reveal, flat, done for you' },
        { icon: Building2, big: 'R250+', small: 'the going agency rate per lead, advertised' },
        { icon: ShieldCheck, big: 'R120', small: 'in starting credit when you open with an access code' },
      ]
}

// Task 214 whitelabel: step 2 speaks as the strategist's own desk on partner
// doors; the generic door may name the engine.
function steps(partner?: Strategist) {
  return [
    {
      n: '1',
      title: 'Claim your credit',
      body: partner
        ? 'Fill in the form below. Your account opens on the spot and the R550 starting credit lands in your wallet before you spend a cent.'
        : 'Enter your access code or apply below. Our corporate team sets your account up by hand and applies the R120 starting credit when you open with a code. Opened through an authorized brand strategist, the R550 five lead credit applies instead.',
    },
    {
      n: '2',
      title: 'We find and verify',
      body: partner
        ? 'Managed sourcing runs end to end on our desk. Businesses are found, contact details are verified by hand and machine, and the leads land in your pipeline ready to work.'
      : 'Managed sourcing runs inside HustlePortal. Businesses are found, contact details are verified by hand and machine, and the leads land in your pipeline ready to work.',
    },
    {
      n: '3',
      title: 'Your sellers close',
      body: 'Verified before a cent moves: an unverified lead is never charged. Your sellers spend their time selling, not hunting for numbers that work.',
    },
  ]
}

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
// Task 216/217: the credit card is door-aware (R550 strategist door, R120
// access-code credit on the generic door).
function trust(partner?: Strategist) {
  const cards = [
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
    partner
      ? {
          icon: BadgeCheck,
          title: 'R550 starting credit on us',
          body: 'Applied at setup before you spend a cent — five qualified lead reveals to judge the quality first, with no card needed to claim.',
        }
      : {
          icon: BadgeCheck,
          title: 'The credit follows the door',
          body: 'Open with an access code and the R120 starting credit is applied at setup, before you spend a cent. Open your account through an authorized brand strategist and the R550 credit, five qualified lead reveals, applies instead. No card is needed either way.',
        },
    {
      icon: Users,
      title: 'POPIA-aware sourcing',
      body: 'Business contact data is processed lawfully under POPIA. Any listed business can remove itself from the pipeline in one click, and the suppression holds.',
    },
  ]
  return cards
}

export default function CorporateContent({ partner, testimonials = [] }: { partner?: Strategist; testimonials?: WallRow[] }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-14 space-y-12">
      <header className="space-y-4">
        <p className={`font-semibold uppercase tracking-wider text-brand flex items-center gap-2.5 ${partner ? 'text-base md:text-lg' : 'text-[11px]'}`}>
          {/* Task 215 (owner, round 2): the partner brand line must hold its own
              against the headline — logo h-10 and text a step up on partner
              doors, so the room knows whose door it is before it reads on. */}
          {partner && (
            <img
              src={partner.image}
              alt={`${partner.company} logo`}
              className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain ring-1 ring-border p-0.5"
            />
          )}
          {!partner && <Building2 className="h-4 w-4" />}
          {/* Whitelabel law (Task 214): partner doors carry only the strategist's brand. */}
          {partner ? partner.company : 'HustlePortal Corporate'}
        </p>
        <h1 className="font-display text-4xl leading-tight">
          Verified leads for corporate sales floors. Done for you.
        </h1>
        <p className="text-muted-foreground">
          Your sellers close; our engine finds and verifies the businesses they sell to. Real contact
          details of real businesses, delivered into your pipeline at one flat managed rate.
          {partner
            ? ' The R550 starting credit lands in your wallet the moment your account opens.'
            : ' Your starting credit follows the door: R550 through an authorized brand strategist, R120 when you open with an access code.'}
        </p>
        {partner ? (
          <>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Handshake className="h-4 w-4 text-brand" />
              Presented by {partner.name} of {partner.company}.
            </p>
            <div className="pt-1">
              <a
                href="#claim"
                className="inline-flex items-center justify-center rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                No credit card needed — claim your free credit
              </a>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Handshake className="h-4 w-4 text-brand" />
            Delivered by the Business Hustle corporate desk, on the same verified engine behind HustlePortal.
          </p>
        )}
        {/* Task 215 round 2: the reading spine. One quiet row of anchors so a
            prospect always knows where they are and what is left: numbers →
            how → maths → trust → claim. */}
        <nav className="flex flex-wrap gap-2 pt-2" aria-label="Page sections">
          {[
            ['#numbers', 'The numbers'],
            ['#how', 'How it works'],
            ['#maths', 'The maths'],
            ['#trust', 'Why us'],
            ['#stories', 'Stories'],
            ['#claim', 'Claim your credit'],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-brand hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        {/* Task 219 (owner): the door never dead-ends again — clients of the
            room log in at /app, which is the workspace on every host, this
            domain included. */}
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <LogIn className="h-4 w-4 text-brand" />
          Already have an account?{' '}
          <a href="/app?signin=1" className="text-brand underline underline-offset-2 font-medium">
            Sign in here
          </a>
        </p>
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

      {/* Task 215 round 2: the page reads as one spine, each section anchored —
          the numbers → how it works → the maths → trust → who it suits → claim. */}
      <section id="numbers" className="space-y-3 scroll-mt-6">
        <h2 className="font-display text-2xl">The numbers, upfront</h2>
        <div className="grid grid-cols-2 gap-3">
          {tiles(partner).map((t) => (
            <div key={t.big} className="rounded-2xl border border-border bg-card p-5 space-y-1.5">
              <t.icon className="h-5 w-5 text-brand" />
              <p className="font-display text-2xl">{t.big}</p>
              <p className="text-xs text-muted-foreground">{t.small}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="space-y-3 scroll-mt-6">
        <h2 className="font-display text-2xl">How it works</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {steps(partner).map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card p-5 space-y-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white text-sm font-semibold">
                {s.n}
              </span>
              <p className="font-semibold text-sm">{s.title}</p>
              <p className="text-xs text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="pt-2">
          <a
            href="#claim"
            className="inline-flex items-center justify-center rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            {partner ? 'Claim your R550 credit — no card needed' : 'Claim your starting credit — no card needed'}
          </a>
        </div>
      </section>

      <section id="maths" className="space-y-3 scroll-mt-6">
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
              flat contractual rate, no ladder, no promos.
              {partner
                ? ' The R550 starting credit is exactly five managed leads, on us. The rate is the rate.'
                : ' The R550 starting credit is exactly five managed leads, and it is the strategist door credit; the direct door carries the R120 access-code credit. The rate is the rate.'}
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

      <CorporateCalculator partner={!!partner} />

      <section id="trust" className="space-y-3 scroll-mt-6">
        <h2 className="font-display text-2xl">
          {partner ? 'Why corporate floors sign with us' : 'Why corporate floors sign with HustlePortal'}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {trust(partner).map((t) => (
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

      {/* Task 219 (owner): the story wall. Only human-approved submissions
          render here (the server component passes approved rows only), and the
          form underneath adds new ones — nothing goes live before the desk's
          yes in the exec dashboard. Task 213's "no invented testimonials" law
          is enforced by the approved flag itself. */}
      <section id="stories" className="space-y-4 scroll-mt-6">
        <h2 className="font-display text-2xl flex items-center gap-2">
          <MessageSquareQuote className="h-5 w-5 text-brand" /> Stories from the room
        </h2>
        {testimonials.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {testimonials.map((t) => (
              <figure key={t.id} className="rounded-2xl border border-border bg-card p-5 space-y-2 flex flex-col">
                <div className="flex gap-0.5" aria-label={`Rated ${t.rating} out of 5`}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className={`h-3.5 w-3.5 ${i <= t.rating ? 'fill-brand text-brand' : 'text-muted-foreground/40'}`} />
                  ))}
                </div>
                <blockquote className="text-sm leading-relaxed">“{t.body}”</blockquote>
                <figcaption className="mt-auto text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t.name}</span>
                  {[t.business, t.location].filter(Boolean).length > 0 && (
                    <> · {[t.business, t.location].filter(Boolean).join(', ')}</>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No stories on the wall yet. Worked with us before? Be the first below — the room reads
            every story before it goes live.
          </p>
        )}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <p className="text-sm font-semibold">Add your story</p>
          <TestimonialForm door={partner?.slug} />
        </div>
      </section>

      <section id="who" className="space-y-3 scroll-mt-6">
        <h2 className="font-display text-2xl">Built for rooms like yours</h2>
        <ul className="space-y-2">
          {WHO.map((w) => (
            <li key={w} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4 mt-0.5 text-brand shrink-0" /> {w}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 scroll-mt-6" id="claim">
        {partner ? (
          <>
            <h2 className="font-display text-2xl">No credit card needed. Claim your free credit. Get started now.</h2>
            <p className="text-sm text-muted-foreground">
              Open your corporate account on the spot. The R550 starting credit lands in your wallet
              the moment you sign up, exactly five managed leads at the flat R110 rate. No card, no
              callback, no waiting.
            </p>
            <CorporateSignupForm slug={partner.slug} />
          </>
        ) : (
          <>
            {/* Task 215: the generic door is the locked B2B access point — a
                code from the team, or an invitation application. Task 216: the
                credit asymmetry is stated here, where the door is chosen. */}
            <h2 className="font-display text-2xl">Corporate access is by invitation</h2>
            <p className="text-sm text-muted-foreground">
              This door is locked on purpose. Corporate accounts are opened by our team on a written
              agreement, so entry needs an access code from one of our team members, or an approved
              invitation application. Opening with an access code carries the R120 starting credit; the
              R550 five lead credit is the strategist door benefit, and it lands on accounts opened
              through an authorized brand strategist.
            </p>
            <CorporateAccessGate />
          </>
        )}
      </section>
    </div>
  )
}
