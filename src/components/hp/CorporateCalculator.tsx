'use client'

// Task 215: the corporate lead calculator, on every corporate door. The
// numbers are the established ones (pricing strategy 4.4 and the doors'
// tiles): R110 per qualified lead reveal flat, and the R250+ that agencies
// advertise as the market anchor. Client-side only; every figure traces to a
// constant, so the maths and the copy can never drift apart.
// Task 221 round 3 (owner, 2026-11-19): the R550 freebie leaves the
// strategist door entirely, maths included. Both doors run direct maths
// with no credit assumed, so the door sells the flat rate, not a coupon. The
// credit itself still lands server-side at claim, it just never renders
// here.
// Task 221 round 4 (owner, the A/B call): the generic door goes straight
// business too — no strategist mentions anywhere on it, so both doors run
// identical direct maths and identical notes.

import { useMemo, useState } from 'react'
import { Calculator } from 'lucide-react'

const REVEAL_CENTS = 11000 // mirrors DFY_REVEAL_PRICE_CENTS in src/lib/levels.ts
const AGENCY_CENTS = 25000 // mirrors AGENCY_PER_LEAD_CENTS in src/lib/levels.ts

const rand = (cents: number) =>
  `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`

export default function CorporateCalculator({ partner = false }: { partner?: boolean }) {
  const [leads, setLeads] = useState(50)

  const maths = useMemo(() => {
    const ours = leads * REVEAL_CENTS
    const agency = leads * AGENCY_CENTS
    const saving = agency - ours
    const savingPct = agency > 0 ? Math.round((saving / agency) * 100) : 0
    return { ours, agency, saving, savingPct }
  }, [leads])

  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl flex items-center gap-2">
        <Calculator className="h-5 w-5 text-brand" /> Do the maths before you call anyone
      </h2>
      <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
        <div>
          <label className="text-sm font-semibold flex items-baseline justify-between">
            Verified leads your team needs per month
            <span className="font-display text-2xl text-brand">{leads}</span>
          </label>
          <input
            type="range"
            min={10}
            max={500}
            step={5}
            value={leads}
            onChange={(e) => setLeads(Number(e.target.value))}
            className="w-full mt-3 accent-[var(--brand, #d4a24e)]"
            aria-label="Leads per month"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
            <span>10</span>
            <span>500</span>
          </div>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3 text-center">
          <div className="rounded-xl border border-border bg-background p-4">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">With us</dt>
            <dd className="font-display text-2xl mt-1">{rand(maths.ours)}<span className="text-xs font-sans font-normal text-muted-foreground"> / month</span></dd>
            <p className="text-[11px] text-muted-foreground mt-1">Direct maths. Every lead in this number is verified before delivery.</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The agency rate</dt>
            <dd className="font-display text-2xl mt-1">{rand(maths.agency)}<span className="text-xs font-sans font-normal text-muted-foreground"> / month</span></dd>
            <p className="text-[11px] text-muted-foreground mt-1">At R250+ per lead, advertised</p>
          </div>
          <div className="rounded-xl border border-brand/40 bg-brand/5 p-4">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">You keep</dt>
            <dd className="font-display text-2xl mt-1 text-brand">{rand(maths.saving)}<span className="text-xs font-sans font-normal text-muted-foreground"> / month</span></dd>
            <p className="text-[11px] text-muted-foreground mt-1">{maths.savingPct}% below the agency rate</p>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          Flat R110 per qualified lead reveal. Unverified leads are never charged.
        </p>
      </div>
    </section>
  )
}
