import { BadgeCheck, Building2, Handshake, ShieldCheck, Users, Wallet, FileSignature, Zap, LogIn, ArrowRight, Forward } from 'lucide-react'
import type { Strategist } from '@/lib/corporate'
import CorporateSignupForm from '@/components/hp/CorporateSignupForm'
import CorporateAccessGate from '@/components/hp/CorporateAccessGate'
import CorporateCalculator from '@/components/hp/CorporateCalculator'

// Task 219 (owner, round 2): testimonials live ONLY on the main site landing.
// The corporate doors are pure sales again — no story wall, no submit form.
// (Submissions from the doors still carry their slug attribution in the
// Testimonial table for the desk; the doors themselves just never render it.)

// Task 221 round 3 (owner, 2026-11-19): the door is a landing page that must
// CONVERT the decision maker and arm the subordinate to pass the link up to
// the CFO. New spine: hook → the problem → the shift → the numbers → the
// maths → pass it up → trust → claim. The strategist door no longer runs the
// R550 coupon in its copy (owner: it cheapens the pitch; the mechanic still
// exists server-side at claim, it just never renders here).
// Task 221 round 4 (owner, same day, the A/B call): the GENERIC door is
// straight business too. No strategist door mentions, no credit ladder, no
// coupons: the rate, the maths, the trust. The Task 216/217 asymmetry ladder
// is retired on this surface; welcome credits and referral links are the
// strategist doors' game. Laws kept: truthful numbers only; the corporate
// rate never sits beside self-serve prices; no dashes in the copy; no
// commission mechanics client-facing; whitelabel on partner doors; the pass
// it up block is partner-only (the generic door is the invitation desk).
function tiles(partner?: Strategist) {
  return [
    { icon: BadgeCheck, big: 'R110', small: 'per qualified lead reveal, flat. The rate is the rate.' },
    { icon: Building2, big: 'R250+', small: 'the going agency rate per lead, advertised' },
    { icon: Zap, big: '200', small: 'lead searches a day for your own hunting, between managed batches' },
    { icon: ShieldCheck, big: '0', small: 'unverified leads charged. The check is the guarantee.' },
  ]
}

// Task 214 whitelabel: step 2 speaks as the strategist's own desk on partner
// doors; the generic door may name the engine.
function steps(partner?: Strategist) {
  return [
    {
      n: '1',
      title: 'Open the floor',
      body: 'Sign the agreement on our own e-sign system, with a timestamped audit certificate. Minutes, not weeks. The floor is yours the same day.',
    },
    {
      n: '2',
      title: 'The pipeline fills',
      body: (partner ? 'Our desk' : 'The HustlePortal desk') + ' runs managed sourcing end to end: businesses found, contact details verified by hand and machine, delivered into your pipeline ready to work.',
    },
    {
      n: '3',
      title: 'Your sellers close',
      body: 'Sellers wake up to a pipeline of verified businesses and spend the day selling, not hunting. Verified before a cent moves: an unverified lead is never charged.',
    },
  ]
}

const PROBLEM = [
  'Leads live in inboxes, WhatsApp threads and spreadsheets. Nobody owns the follow up.',
  'When selling gets busy, prospecting stops. When prospecting stops, next month is empty.',
  'Contact lists age fast. Sellers burn hours dialing numbers that went dead months ago.',
  'Nobody can answer the question the money person asks: what is the pipeline actually worth today?',
]

const WHO = [
  'Sales teams that need a full pipeline, not a lead here and there',
  'Agencies that resell lead generation to their own clients',
  'Franchisors feeding new customer pipelines to their branches',
  'Property, insurance and finance teams working by appointment',
]

// Task 213: every claim is a real product behaviour — verification-before-
// payment is enforced by the billing code, the flat rate is the contractual
// rate, the e-sign engine is our own (Task 212) and the POPIA opt-out is the
// public /remove-listing flow. No invented testimonials, no invented numbers.
function trust(partner?: Strategist) {
  const cards = [
    {
      icon: ShieldCheck,
      title: 'Verified before a cent moves',
      body: 'Contact details are checked by hand and machine before delivery. An unverified lead is never charged. The check is the guarantee, and it is written into how billing works.',
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
      icon: Users,
      title: 'POPIA-aware sourcing',
      body: 'Business contact data is processed lawfully under POPIA. Any listed business can remove itself from the pipeline in one click, and the suppression holds.',
    },
  ]
  return cards
}

const CTA_CLS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90'

export default function CorporateContent({ partner }: { partner?: Strategist }) {
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
        <h1 className="font-display text-4xl leading-tight md:text-5xl">
          {partner ? 'A sales floor that never runs dry.' : 'Verified leads for corporate sales floors. Done for you.'}
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Verified businesses, delivered into your pipeline ready to work. Your sellers sell;
          the hunting, the verifying and the chasing are done for you, at one flat rate.
        </p>
        {partner && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Handshake className="h-4 w-4 text-brand" />
            Presented by {partner.name} of {partner.company}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <a href="#claim" className={CTA_CLS}>
            Open your floor <ArrowRight className="h-4 w-4" />
          </a>
          {partner && (
            <a
              href="#forward"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold text-muted-foreground transition hover:border-brand hover:text-foreground"
            >
              Not the signatory? Send this up <Forward className="h-4 w-4" />
            </a>
          )}
        </div>
        {!partner && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Handshake className="h-4 w-4 text-brand" />
            Delivered by the Business Hustle corporate desk, on the same verified engine behind HustlePortal.
          </p>
        )}
        {/* Task 215 round 2: the reading spine. One quiet row of anchors so a
            prospect always knows where they are and what is left: problem →
            how → maths → forward → claim. */}
        <nav className="flex flex-wrap gap-2 pt-2" aria-label="Page sections">
          {[
            ['#problem', 'The problem'],
            ['#how', 'How it runs'],
            ['#maths', 'The maths'],
            ...(partner ? [['#forward', 'For your CFO']] : []),
            ['#claim', 'Open your floor'],
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

      {/* Task 221 round 3: the problem, stated the way the decision maker feels
          it. No feature talk, no numbers yet. The room must nod before it reads on. */}
      <section id="problem" className="space-y-4 scroll-mt-6">
        <h2 className="font-display text-2xl md:text-3xl">Deals do not die at the close.</h2>
        <p className="text-muted-foreground leading-relaxed">
          They die in the quiet gaps between follow ups: the lead nobody owned, the number that went
          dead, the week selling got busy so prospecting stopped. Growth rarely stalls on the market
          or the product. It stalls on the pipeline.
        </p>
        <ul className="space-y-2.5">
          {PROBLEM.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" /> {p}
            </li>
          ))}
        </ul>
        <p className="text-sm font-medium">
          Every unworked lead is salary spent on nothing. That is the cost of a floor that hunts
          from scratch, every month, forever.
        </p>
      </section>

      <section id="how" className="space-y-3 scroll-mt-6">
        <h2 className="font-display text-2xl md:text-3xl">The shift</h2>
        <p className="text-muted-foreground leading-relaxed">
          The floor stops hunting from scratch. A desk that does nothing else fills the pipeline:
          businesses found, verified by hand and machine, delivered ready to work. Your sellers
          open their day selling.
        </p>
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
      </section>

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
              The finding, the verification and the delivery into your pipeline are all in the rate.
              One flat contractual number. No ladder, no promos, no renegotiation when volume grows.
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

      {/* Task 221 round 3 (owner): the pass it up block. The person who feels
          the pipeline problem daily is rarely the person who signs. This section
          hands them the whole case in CFO language and tells them to forward the
          page. Partner doors only: the generic door is the invitation desk. */}
      {partner && (
        <section id="forward" className="space-y-4 scroll-mt-6">
          <h2 className="font-display text-2xl md:text-3xl">Reading this but not the one who signs?</h2>
          <p className="text-muted-foreground leading-relaxed">
            You know this problem better than anyone above you. You live in the follow ups, the dead
            numbers and the Monday pipeline guess. The person who can end it signs the agreements.
            Put this page in front of them: everything a money person needs is on it, the rate, the
            guarantee, the compliance and the maths.
          </p>
          <figure className="rounded-2xl border border-brand/40 bg-brand/5 p-5 space-y-2">
            <figcaption className="text-xs font-semibold uppercase tracking-wider text-brand flex items-center gap-2">
              <Forward className="h-4 w-4" /> The whole case, four sentences
            </figcaption>
            <blockquote className="text-sm leading-relaxed">
              We can have verified business leads delivered into our sales pipeline at R110 each,
              flat, from a team that verifies every contact before it is ever charged. Agencies
              advertise the same work from R250. Every lead and every rand sits in one ledger we can
              check any time, the agreement is signed electronically with a timestamped audit
              certificate, and the pipeline is POPIA clean. One closed deal covers more than a
              hundred managed leads at our margins, so the maths is not close.
            </blockquote>
          </figure>
          <p className="text-sm text-muted-foreground">
            Send them the link to this page with that note. Then let them read it in their own time.
          </p>
        </section>
      )}

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
            <h2 className="font-display text-2xl md:text-3xl">Open your floor today</h2>
            <p className="text-sm text-muted-foreground">
              Fill in the form and the account opens on the spot: the corporate tier is set, the
              wallet goes live, and the desk starts filling your pipeline. No card, no callback,
              no waiting.
            </p>
            <CorporateSignupForm slug={partner.slug} />
          </>
        ) : (
          <>
            {/* Task 221 round 4 (owner): the generic door is straight business.
                The code gate stays (the desk opens accounts by hand), the credit
                ladder talk is gone. */}
            <h2 className="font-display text-2xl">Corporate access is by invitation</h2>
            <p className="text-sm text-muted-foreground">
              This door is locked on purpose. Corporate accounts are opened by our team on a written
              agreement, so entry needs an access code from one of our team members, or an approved
              invitation application.
            </p>
            <CorporateAccessGate />
          </>
        )}
      </section>
    </div>
  )
}
