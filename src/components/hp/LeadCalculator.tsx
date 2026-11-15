'use client'

/**
 * LeadCalculator — the math behind the hustle, live on the home dashboard.
 * Monthly leads needed = revenue goal / (average deal value × close rate).
 * Rounded up (nobody calls half a lead), split into a weekly and daily pace,
 * plus the honest money bridge: revealing that many verified contacts at the
 * member's own track price (self-serve ladder or the B2B done-for-you rate).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Calculator } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { api, rands } from './shared'
import { useHp } from './store'
import { levelFor, revealPriceFor, isPremiumTier, tillAnchorLine } from '@/lib/levels'

export default function LeadCalculator() {
  const { session, setView } = useHp()
  const [goal, setGoal] = useState('10000')
  const [deal, setDeal] = useState('1500')
  const [rate, setRate] = useState(3)

  // Task 206: the deal value persists per member (AVG_DEAL_CENTS user setting)
  // so every till surface can speak in the member's own outcome units — the
  // value the calculator collects is the value the reveal moment repeats.
  const [dealLoaded, setDealLoaded] = useState(false)
  const dealSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    api<{ settings: { key: string; value: string }[] }>('/api/settings')
      .then((res) => {
        const saved = res.settings.find((s) => s.key === 'AVG_DEAL_CENTS')
        if (saved && /^\d+$/.test(saved.value) && Number(saved.value) > 0) {
          setDeal(String(Math.round(Number(saved.value) / 100)))
        }
      })
      .catch(() => {})
      .finally(() => setDealLoaded(true))
  }, [])
  useEffect(() => {
    if (!dealLoaded) return
    const cents = Math.round(parseFloat(deal) * 100)
    if (!isFinite(cents) || cents <= 0) return
    if (dealSaveTimer.current) clearTimeout(dealSaveTimer.current)
    dealSaveTimer.current = setTimeout(() => {
      api('/api/settings', { method: 'PUT', body: JSON.stringify({ key: 'AVG_DEAL_CENTS', value: String(cents) }) }).catch(() => {})
    }, 900)
    return () => {
      if (dealSaveTimer.current) clearTimeout(dealSaveTimer.current)
    }
  }, [deal, dealLoaded])

  const level = levelFor(session?.user?.xp ?? 0)
  const premium = isPremiumTier(session?.user?.pricingTier)
  const priceCents = revealPriceFor(session?.user?.pricingTier, level.level)
  const anchor = tillAnchorLine(session?.user?.pricingTier, level.level)

  const calc = useMemo(() => {
    const g = parseFloat(goal)
    const d = parseFloat(deal)
    if (!isFinite(g) || !isFinite(d) || g <= 0 || d <= 0 || rate <= 0) return null
    const leads = Math.ceil(g / (d * (rate / 100)))
    return {
      leads,
      perWeek: Math.max(1, Math.ceil(leads / 4.33)),
      perDay: Math.max(1, Math.ceil(leads / 21)), // 21 working days
      costCents: leads * priceCents,
      dealCents: d * 100,
      revealsPerJob: Math.max(1, Math.floor((d * 100) / priceCents)),
      pctOfJob: Math.max(0.1, Math.round((priceCents / (d * 100)) * 1000) / 10),
    }
  }, [goal, deal, rate, priceCents])

  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="font-medium mb-1 flex items-center gap-2">
        <Calculator className="h-4 w-4 text-brand" /> Lead calculator
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Monthly leads needed = revenue goal ÷ (average deal × close rate). Most hustles close 2–5% of a fresh list — start there, adjust with your real numbers.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Revenue goal / month (R)</span>
          <Input value={goal} onChange={(e) => setGoal(e.target.value)} inputMode="numeric" className="mt-1" placeholder="10000" />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Average deal value (R)</span>
          <Input value={deal} onChange={(e) => setDeal(e.target.value)} inputMode="numeric" className="mt-1" placeholder="1500" />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lead-to-customer rate: {rate}%</span>
          <Slider value={[rate]} min={0.5} max={15} step={0.5} onValueChange={(v) => setRate(v[0] ?? 3)} className="mt-3" />
        </label>
      </div>
      {calc ? (
        <div className="mt-4 rounded-lg border bg-background/60 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <div className="font-display text-4xl leading-none">{calc.leads.toLocaleString('en-ZA')}</div>
            <div className="text-xs text-muted-foreground mt-1">
              leads needed per month ≈ {calc.perWeek}/week ≈ {calc.perDay}/working day
            </div>
          </div>
          <div className="sm:ml-auto sm:text-right">
            <div className="font-display text-2xl leading-none text-brand">{rands(calc.costCents)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              to reveal them at your price ({rands(priceCents)} each{premium ? ', done-for-you rate' : level.level >= 3 ? ', Operator perk' : ''})
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              One {rands(calc.dealCents)} job pays for {calc.revealsPerJob} reveals — this whole list is {calc.pctOfJob}% of one job.
            </div>
            <Button size="sm" className="mt-2" onClick={() => setView('leads')}>
              Open Leads <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Fill in the goal and the deal value — rough numbers are fine, the math does the rest.
        </p>
      )}
      {anchor && <p className="text-xs text-muted-foreground mt-2 border-t pt-2">{anchor}</p>}
    </div>
  )
}
