import type { Metadata } from 'next'
import { ShieldCheck, ArrowRight, Users } from 'lucide-react'
import Link from 'next/link'

// Task 206 — Move 6, the DFY triangle page. The managed rate is never shown
// beside the self-serve prices (a 7.2x multiple invites the wrong question);
// here its comparison set is the one that makes it the disciplined middle of
// the market: the agency reference above it, the client's own margin below it.
// Lean landing surface — checkout and team-tier inheritance ship with the first
// real DFY contract (Task 203 roadmap, build-when-needed).

export const metadata: Metadata = {
  title: 'HustlePortal for Teams — managed lead generation',
  description: 'Done-for-you verified leads for selling teams. One flat managed rate, verified before a cent moves.',
}

const TRIANGLE = [
  {
    label: 'The market',
    value: 'R250+',
    unit: 'per lead, advertised',
    body: 'South African pay-per-lead agencies advertise from R250 per lead, quoted per industry and volume. That is the price of doing it through someone else.',
    tone: 'text-muted-foreground',
  },
  {
    label: 'The managed rate',
    value: 'R110',
    unit: 'per qualified lead reveal, flat',
    body: 'Our team runs the finding, the verification and the delivery into your team\u2019s pipeline. One flat contractual rate, no ladder, no promos — the rate is the rate. R550 in starting credit is exactly five managed leads, on us.',
    tone: 'text-brand',
    highlight: true,
  },
  {
    label: 'Your side of the maths',
    value: 'Your margin',
    unit: 'per closed deal',
    body: 'Bring your average deal value to the table and the arithmetic finishes itself: one closed deal covers more than a hundred managed leads at most margins.',
    tone: 'text-muted-foreground',
  },
]

export default function ForTeamsPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-14 space-y-10">
        <header className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand flex items-center gap-2">
            <Users className="h-3.5 w-3.5" /> HustlePortal for teams
          </p>
          <h1 className="font-display text-4xl leading-tight">
            Managed lead generation, done for your team.
          </h1>
          <p className="text-muted-foreground">
            Your sellers sell; our engine finds and verifies the businesses they sell to. Real
            contact details of real businesses, delivered into your pipeline at one flat managed rate.
          </p>
        </header>

        {/* The triangle, in reading order: market first, managed rate second, the client's own margin last. */}
        <section className="space-y-3">
          {TRIANGLE.map((t) => (
            <div
              key={t.label}
              className={`rounded-xl border p-5 ${t.highlight ? 'border-brand bg-brand/5' : 'bg-card'}`}
            >
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.label}</span>
                <span className={`font-display text-3xl ${t.tone}`}>{t.value}</span>
                <span className="text-xs text-muted-foreground">{t.unit}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">{t.body}</p>
            </div>
          ))}
        </section>

        {/* The honesty contract — the same law the self-serve till runs on. */}
        <section className="rounded-xl border bg-card p-5 flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium">Verified before a cent moves.</p>
            <p className="text-muted-foreground">
              A lead that cannot be verified is not delivered and not charged. The same honesty law
              the self-serve wallet runs on governs the managed track — the rate prices the work, not the promise.
            </p>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-sidebar text-sidebar-foreground px-5 py-3 text-sm font-medium hover:bg-sidebar/90"
          >
            Start on HustlePortal <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="text-xs text-muted-foreground max-w-sm">
            Already have accounts for your team? Reply to any HustlePortal email and a human reads
            it — we set the managed track up with you directly.
          </p>
        </section>

        <footer className="text-xs text-muted-foreground border-t pt-6">
          Business Hustle · businesshustle.co.za — the market reference shown is an advertised
          rate sourced November 2026, labeled as a reference, not a quote.
        </footer>
      </div>
    </main>
  )
}
