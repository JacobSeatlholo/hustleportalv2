'use client'

/**
 * GrowView — "Grow & Earn": the distribution + revenue hub.
 *  - Share your personal invite link (WhatsApp-first — that's where SA business lives)
 *  - Subscribe to a monthly plan (Operator R199 / Boss R499) via Yoco Checkout
 * Negative churn: invite rewards + plan perks make leaving cost more than staying.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { api, rands } from './shared'
import { useHp } from './store'
import { onboardingStillPending } from './Onboarding'
import { getPlan, priceWithNpoDiscount } from '@/lib/plans'
import { useCurrency } from './useCurrency'
import {
  Users, Copy, Check, Loader2, Sparkles, Crown, MessageCircle, Gift, TrendingUp, CheckCircle2, HeartHandshake,
} from 'lucide-react'

interface RefsData {
  code: string
  link: string
  stats: { signedUp: number; subscribed: number; earnedCents: number }
  recent: { id: string; invitedEmail: string | null; status: string; rewardCents: number; createdAt: string; invitedUser: { name: string } | null }[]
  invitedBy: string | null
}

interface PlansData {
  plan: string
  subscription: { plan: string; status: string; billingCycle?: string; amountCents: number; renewsAt: string | null; pausedUntil?: string | null; npoNumber?: string | null } | null
}

const PLANS = [
  {
    id: 'HUSTLER',
    name: 'Operator',
    price: 'R199',
    annual: 'R1,990',
    priceCents: 19900,
    annualCents: 199000,
    normalCents: 29900,
    normalAnnualCents: 299000,
    tagline: 'For owner-operators building steady momentum.',
    icon: <Sparkles className="h-5 w-5 text-brand" />,
    perks: [
      'Unlimited AI Co-Founder & email drafts',
      '5 verified lead reveals every month, unused ones roll over',
      'Invoices, calendar, reports, exports',
      'R50 credit for every business owner you refer',
      'Your business listed in the public directory',
    ],
  },
  {
    id: 'BOSS',
    name: 'Boss',
    price: 'R499',
    annual: 'R4,990',
    priceCents: 49900,
    annualCents: 499000,
    tagline: 'For teams ready to outscale the competition.',
    icon: <Crown className="h-5 w-5 text-brand" />,
    highlight: true,
    perks: [
      'Everything in Operator',
      '12 verified lead reveals every month, the best per-lead price, unused ones roll over',
      'Up to 5 team seats, shared pipeline',
      'Priority AI, faster and longer answers',
      'Founding Member badge',
    ],
  },
]

export default function GrowView() {
  const { toast } = useToast()
  const bumpRefresh = useHp((s) => s.bumpRefresh)
  const currency = useCurrency()
  const [refs, setRefs] = useState<RefsData | null>(null)
  const [plans, setPlans] = useState<PlansData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [cycle, setCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY')
  const [planBusy, setPlanBusy] = useState<string | null>(null)
  // Nonprofit rate: 30% off while a valid NPO number stands
  const [npoInput, setNpoInput] = useState('')
  const [npoApplied, setNpoApplied] = useState<string | null>(null)
  const [npoBusy, setNpoBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, p] = await Promise.all([
        api<RefsData>('/api/refs'),
        api<PlansData>('/api/subscribe'),
      ])
      setRefs(r)
      setPlans(p)
      // The rate stays across visits: subscription first, then the saved number
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem('hp_npo_number') : null
      setNpoApplied(p.subscription?.npoNumber || stored)
      if (p.subscription?.npoNumber && typeof window !== 'undefined') {
        window.localStorage.setItem('hp_npo_number', p.subscription.npoNumber)
      }
    } catch (e) {
      toast({ title: 'Could not load', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  // Charge now intent: a plan picked on the landing page rides through signup.
  // The moment this view opens, that plan's checkout fires exactly once — the
  // stored intent is consumed before anything else can see it. ONE GATE: a
  // brand new account answers the two question survey first (the onboarding
  // survey owns the first moment), then this fires on the settle event, so
  // the card form is one tap after the last answer instead of a mid survey
  // ambush.
  const fireIntent = useCallback(() => {
    if (typeof window === 'undefined') return
    if (onboardingStillPending()) return
    const intent = window.localStorage.getItem('hp_plan_intent')
    if (!intent) return
    window.localStorage.removeItem('hp_plan_intent')
    if (intent === 'HUSTLER' || intent === 'BOSS') void subscribe(intent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fireIntent()
    const onSettle = () => fireIntent()
    window.addEventListener('hp:onboard-settle', onSettle)
    return () => window.removeEventListener('hp:onboard-settle', onSettle)
  }, [fireIntent])

  async function copyLink() {
    if (!refs) return
    try {
      await navigator.clipboard.writeText(refs.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({ title: 'Link copied ✓', description: 'Share it on WhatsApp, Facebook, anywhere.' })
    } catch {
      toast({ title: 'Copy failed', description: refs.link, variant: 'destructive' })
    }
  }

  function shareWhatsApp() {
    if (!refs) return
    const msg = encodeURIComponent(
      `I run my whole business on HustlePortal — leads, follow-ups, invoices, an AI co-founder. It keeps me ahead of the competition. Join free with my link and we both win: ${refs.link}`
    )
    window.open(`https://wa.me/?text=${msg}`, '_blank')
  }

  async function subscribe(planId: string) {
    setSubscribing(planId)
    try {
      const res = await api<{ ok: boolean; sandbox?: boolean; redirectUrl?: string; note?: string }>('/api/subscribe', {
        method: 'POST',
        body: JSON.stringify({ plan: planId, cycle, npoNumber: npoApplied || undefined }),
      })
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl
        return
      }
      toast({ title: 'Plan activated ✓', description: res.note || 'Sandbox mode — set YOCO_SECRET_KEY for live payments.' })
      bumpRefresh()
      await load()
    } catch (e) {
      toast({ title: 'Could not subscribe', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSubscribing(null)
    }
  }

  function applyNpo() {
    const v = npoInput.trim()
    if (!v) {
      setNpoApplied(null)
      if (typeof window !== 'undefined') window.localStorage.removeItem('hp_npo_number')
      return
    }
    setNpoBusy(true)
    // Light client check mirrors the server rule: 6 digits, optionally dashed
    const s = v.toUpperCase().replace(/^NPO[\s-]*/, '')
    if (!/^\d{2,3}[\s-]?\d{3,4}$/.test(s)) {
      toast({ title: 'That NPO number does not look right', description: 'Registered South African nonprofits have 6 digits, like 044-291 or 123456.', variant: 'destructive' })
      setNpoBusy(false)
      return
    }
    setNpoApplied(v.toUpperCase())
    if (typeof window !== 'undefined') window.localStorage.setItem('hp_npo_number', v.toUpperCase())
    toast({ title: 'Nonprofit rate applied ✓', description: '30% off every plan, monthly or annual. We may ask for the certificate before renewal.' })
    setNpoBusy(false)
  }

  async function planAction(action: 'pause' | 'resume') {
    setPlanBusy(action)
    try {
      const res = await api<{ ok: boolean; note?: string }>('/api/subscribe/pause', {
        method: 'POST',
        body: JSON.stringify({ action }),
      })
      toast({ title: action === 'pause' ? 'Plan paused' : 'Plan resumed', description: res.note || 'Your days are frozen, not lost.' })
      bumpRefresh()
      await load()
    } catch (e) {
      toast({ title: 'Could not update plan', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setPlanBusy(null)
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
  }

  const active = plans?.subscription?.status === 'ACTIVE' ? plans.subscription : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl">Grow &amp; Earn</h2>
        <p className="text-sm text-muted-foreground">
          The businesses that grow fastest bring others with them. Share your link, earn credit, unlock perks.
        </p>
      </div>

      {/* Invite engine */}
      <div className="rounded-lg border border-brand/30 bg-brand/5 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-brand" />
          <h3 className="font-display text-lg">Invite business owners — earn as they grow</h3>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Metric label="Invited" value={String(refs?.stats.signedUp ?? 0)} />
          <Metric label="Subscribed" value={String(refs?.stats.subscribed ?? 0)} />
          <Metric label="Earned" value={rands(refs?.stats.earnedCents ?? 0)} />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 rounded-lg border bg-card px-3 py-2.5 text-sm truncate font-mono text-muted-foreground">
            {refs?.link}
          </div>
          <Button onClick={shareWhatsApp} className="bg-brand text-black hover:bg-brand/90 font-semibold">
            <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp it
          </Button>
          <Button variant="outline" onClick={copyLink}>
            {copied ? <Check className="h-4 w-4 mr-1 text-emerald-500" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          R10 lands in your wallet when they join · R50 more when they subscribe. Every email you send already carries your link.
          {refs?.invitedBy && <> Invited by <b className="text-foreground">{refs.invitedBy}</b>.</>}
        </p>

        {refs && refs.recent.length > 0 && (
          <div className="rounded-lg border divide-y max-h-44 overflow-y-auto hp-scroll">
            {refs.recent.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{r.invitedUser?.name || r.invitedEmail || 'New member'}</span>
                {r.status === 'SUBSCRIBED' ? (
                  <Badge className="bg-brand text-black hover:bg-brand text-[10px]"><TrendingUp className="h-3 w-3 mr-0.5" /> SUBSCRIBED</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">JOINED</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Plans */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg">Go further, faster</h3>
          {active ? (
            <Badge className="bg-brand text-black hover:bg-brand">ACTIVE · {getPlan(active.plan)?.name || active.plan}</Badge>
          ) : plans?.subscription?.status === 'PAUSED' ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-500">PAUSED{plans.subscription.pausedUntil ? ` · resumes ${new Date(plans.subscription.pausedUntil).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : ''}</Badge>
          ) : (
            <Badge variant="outline">Free plan</Badge>
          )}
        </div>
        {(active || plans?.subscription?.status === 'PAUSED') && plans?.subscription?.renewsAt && (
          <p className="text-xs text-muted-foreground">
            Renews {new Date(plans.subscription.renewsAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })} · never auto-charged — you choose to renew · your data stays yours.
          </p>
        )}
        {active && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={planBusy === 'pause'} onClick={() => planAction('pause')}>
              {planBusy === 'pause' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Pause 30 days
            </Button>
            <span className="text-[11px] text-muted-foreground self-center">Dead season? Freeze your plan — every paid day is kept.</span>
          </div>
        )}
        {plans?.subscription?.status === 'PAUSED' && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={planBusy === 'resume'} onClick={() => planAction('resume')}>
              {planBusy === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Resume now
            </Button>
            <span className="text-[11px] text-muted-foreground self-center">Resuming restores your plan instantly — no paid days lost.</span>
          </div>
        )}
        <div className="flex items-center gap-2 justify-center">
          <div className="inline-flex rounded-lg border p-1">
            <button
              onClick={() => setCycle('MONTHLY')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${cycle === 'MONTHLY' ? 'bg-brand text-black' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setCycle('ANNUAL')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${cycle === 'ANNUAL' ? 'bg-brand text-black' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Annual · 2 months free
            </button>
          </div>
        </div>
        {/* Nonprofit rate — organisations of any size keep more of their budget */}
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <HeartHandshake className="h-4 w-4 text-emerald-500" />
            <h4 className="text-sm font-semibold">Registered nonprofit? Pay 30% less.</h4>
          </div>
          {npoApplied ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">NPO {npoApplied.replace(/^NPO\s*/, '')} · 30% off</Badge>
              <button
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => { setNpoInput(''); setNpoApplied(null); if (typeof window !== 'undefined') window.localStorage.removeItem('hp_npo_number') }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={npoInput}
                onChange={(e) => setNpoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyNpo()}
                placeholder="Your NPO number, e.g. 044-291"
                className="flex-1"
              />
              <Button variant="outline" onClick={applyNpo} disabled={npoBusy} className="shrink-0">
                {npoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply 30% off'}
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            For NPOs, NGOs, community organisations and faith groups of any size. We may ask for the registration certificate before renewal to keep the rate active.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {PLANS.map((p) => {
            const isCurrent = plans?.subscription && ['ACTIVE', 'PAUSED'].includes(plans.subscription.status)
              ? plans.subscription.plan === p.id : false
            const isAnnual = cycle === 'ANNUAL'
            return (
              <div
                key={p.id}
                className={`rounded-lg border p-5 space-y-4 bg-card ${p.highlight ? 'border-brand/50 shadow-[0_0_40px_-12px] shadow-brand/20' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      {p.icon}
                      <h4 className="font-display text-xl">{p.name}</h4>
                      {p.highlight && <Badge className="bg-brand text-black hover:bg-brand text-[10px]">MOST POPULAR</Badge>}
                      {isCurrent && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">YOUR PLAN</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{p.tagline}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {npoApplied ? (
                      <>
                        <div className="font-display text-2xl">
                          {currency.price(priceWithNpoDiscount(isAnnual ? p.annualCents : p.priceCents))}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          <span className="line-through">{currency.price(isAnnual ? p.annualCents : p.priceCents)}</span> · nonprofit 30% off
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-display text-2xl">{currency.price(isAnnual ? p.annualCents : p.priceCents)}</div>
                        <div className="text-[10px] text-muted-foreground">{isAnnual ? 'per year, 2 months free' : 'per month'}</div>
                        {'normalCents' in p && p.normalCents ? (
                          <div className="text-[10px] text-muted-foreground mt-0.5">Normally <span className="line-through">{currency.price(isAnnual ? p.normalAnnualCents : p.normalCents)}</span> · launch special</div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {p.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-brand shrink-0 mt-0.5" />
                      {perk}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full bg-brand text-black hover:bg-brand/90 font-semibold"
                  disabled={subscribing === p.id || (isCurrent && plans?.subscription?.billingCycle === cycle)}
                  onClick={() => subscribe(p.id)}
                >
                  {subscribing === p.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isCurrent && plans?.subscription?.billingCycle === cycle ? (
                    'Current plan'
                  ) : (
                    `Go ${p.name} — ${currency.price(priceWithNpoDiscount(isAnnual ? p.annualCents : p.priceCents))}${isAnnual ? '/yr' : '/mo'}`
                  )}
                </Button>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Secure card payments by Yoco · never auto-charged · pause anytime · unused lead reveals roll over · your data is always exportable. The platform earns your loyalty, it does not lock it.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Every plan includes every module. Tailor the workspace in Profile &amp; Team → Workspace modules: show the tools your hustle uses, hide the rest, and each section carries its own tutorial.
        </p>
        {currency.note && <p className="text-[11px] text-muted-foreground/80">{currency.note}</p>}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-display text-xl">{value}</div>
    </div>
  )
}
