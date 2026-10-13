'use client'

/**
 * The ONE upgrade moment for the whole app.
 *
 * How it sells without selling:
 *  - Every server gate returns 402 { upgrade: true, feature } (src/lib/limits.ts).
 *  - The shared api() helper turns that into an `hp:upgrade` event AND throws a
 *    friendly Error, so the caller's normal catch block still shows the reason.
 *  - This module listens once, renders one dialog (mounted in AppShell), and its
 *    CTA lands on the Grow view where the plans live.
 *
 * Copy comes from src/lib/upgrade-copy.ts (brand voice: simple english, power
 * words, outcome phrasing, no dashes, legally sound, zero nonsense claims).
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { api } from './shared'
import { useHp } from './store'
import { upgradeCopyFor } from '@/lib/upgrade-copy'

// ---------- plan state (shared, cached module level) ----------

export interface PlanInfo {
  plan: string
  paid: boolean
}

let planCache: (PlanInfo & { at: number }) | null = null
let inflight: Promise<PlanInfo> | null = null
const PLAN_TTL_MS = 5 * 60_000

/** Fetch (or recall) the caller's plan. Free on any error — never block a screen on this. */
export function fetchPlan(force = false): Promise<PlanInfo> {
  if (!force && planCache && Date.now() - planCache.at < PLAN_TTL_MS) {
    return Promise.resolve(planCache)
  }
  if (!inflight) {
    inflight = api<{ plan?: string }>('/api/subscribe')
      .then((r) => {
        const plan = r.plan || 'FREE'
        planCache = { plan, paid: plan !== 'FREE', at: Date.now() }
        return planCache
      })
      .catch(() => ({ plan: 'FREE', paid: false }))
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** React hook: the caller's plan, free while loading (screens render honest meters after it lands). */
export function usePlan(): PlanInfo & { loading: boolean } {
  const [state, setState] = useState<PlanInfo & { loading: boolean }>(() => ({
    plan: planCache?.plan || 'FREE',
    paid: planCache?.paid || false,
    loading: !planCache,
  }))
  useEffect(() => {
    let alive = true
    fetchPlan().then((p) => {
      if (alive) setState({ plan: p.plan, paid: p.paid, loading: false })
    })
    return () => {
      alive = false
    }
  }, [])
  return state
}

// ---------- manual upgrade requests (client-side limits, e.g. locked dropdowns) ----------

export function requestUpgrade(feature: string, message?: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hp:upgrade', { detail: { feature, message } }))
  }
}

// ---------- the dialog ----------

interface UpgradeDetail {
  feature?: string
  limit?: number
  message?: string
}

export default function UpgradeListener() {
  const setView = useHp((s) => s.setView)
  const [info, setInfo] = useState<UpgradeDetail | null>(null)
  const open = Boolean(info)
  const copy = upgradeCopyFor(info?.feature)

  useEffect(() => {
    const handler = (e: Event) => setInfo((e as CustomEvent).detail || {})
    window.addEventListener('hp:upgrade', handler)
    return () => window.removeEventListener('hp:upgrade', handler)
  }, [])

  const goPlans = useCallback(() => {
    setInfo(null)
    try {
      window.history.replaceState({}, '', '/?view=grow')
    } catch {
      /* private mode */
    }
    setView('grow')
  }, [setView])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setInfo(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <Sparkles className="h-4 w-4 text-brand shrink-0" />
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-left">{info?.message || copy.body}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {copy.perks.length > 0 && (
            <ul className="space-y-1.5">
              {copy.perks.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-brand shrink-0 mt-0.5" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Operator starts at R199 a month. Pause or cancel any time. Annual works out to 2 months free.
          </p>
          <div className="flex gap-2">
            <Button onClick={goPlans} className="flex-1">
              <Sparkles className="h-4 w-4 mr-1" /> See the plans
            </Button>
            <Button variant="ghost" onClick={() => setInfo(null)}>
              Maybe later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
