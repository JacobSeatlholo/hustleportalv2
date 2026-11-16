'use client'

// Task 208: the referral earnings calculator on strategist doors. The boss's
// referral law in arithmetic: R50 per managed lead delivered to a referred
// corporate account; when a lead is sourced by an enrolled member, the R50
// splits R25 strategist / R25 member. Honest framing: this is a projection at
// the current rate, not a contract or a promise of volume.

import { useMemo, useState } from 'react'
import { Calculator } from 'lucide-react'
import { REFERRAL_PER_LEAD_CENTS, MEMBER_SPLIT_CENTS, rand } from '@/lib/corporate'

const inputCls =
  'w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition ' +
  'focus:border-brand focus:ring-2 focus:ring-brand/20'

export default function EarningsCalculator({ partnerName }: { partnerName: string }) {
  const [sellers, setSellers] = useState(100)
  const [leadsPerSeller, setLeadsPerSeller] = useState(10)

  const view = useMemo(() => {
    const monthlyLeads = Math.max(0, sellers) * Math.max(0, leadsPerSeller)
    const earnings = monthlyLeads * REFERRAL_PER_LEAD_CENTS
    const clientSpend = monthlyLeads * 10800
    return { monthlyLeads, earnings, clientSpend }
  }, [sellers, leadsPerSeller])

  return (
    <div className="rounded-2xl border border-brand/40 bg-brand/5 p-6 space-y-4">
      <p className="font-display text-xl flex items-center gap-2">
        <Calculator className="h-5 w-5 text-brand" /> Your earnings calculator
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sellers in the office you refer
          </span>
          <input
            type="number"
            min={0}
            className={inputCls}
            value={sellers}
            onChange={(e) => setSellers(Number(e.target.value) || 0)}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Managed leads per seller per month
          </span>
          <input
            type="number"
            min={0}
            className={inputCls}
            value={leadsPerSeller}
            onChange={(e) => setLeadsPerSeller(Number(e.target.value) || 0)}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="font-display text-2xl">{view.monthlyLeads.toLocaleString('en-ZA')}</p>
          <p className="text-xs text-muted-foreground">managed leads a month for that office</p>
        </div>
        <div className="rounded-xl border border-brand/40 bg-card p-4 text-center">
          <p className="font-display text-2xl text-brand">{rand(view.earnings)}</p>
          <p className="text-xs text-muted-foreground">your referral earnings a month at R50 per managed lead</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="font-display text-2xl">{rand(view.clientSpend)}</p>
          <p className="text-xs text-muted-foreground">that office's monthly spend at R108 per verified lead</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Team split: when a lead comes from a member you enrolled, the R50 splits R25 to you and R25 to
        them, so your team earns while you sleep. {partnerName}'s members carry their own outreach links,
        and every claim is tracked to its source. Projection at the current rate, not a promise of volume.
      </p>
    </div>
  )
}
