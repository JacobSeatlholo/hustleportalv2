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
import { useToast } from '@/hooks/use-toast'
import { api, rands } from './shared'
import { useHp } from './store'
import { getPlan } from '@/lib/plans'
import {
  Users, Copy, Check, Loader2, Sparkles, Crown, MessageCircle, Gift, TrendingUp, CheckCircle2,
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
  subscription: { plan: string; status: string; amountCents: number; renewsAt: string | null } | null
}

const PLANS = [
  {
    id: 'HUSTLER',
    name: 'Operator',
    price: 'R199',
    tagline: 'For owner-operators building steady momentum.',
    icon: <Sparkles className="h-5 w-5 text-brand" />,
    perks: [
      'Unlimited AI Co-Founder & email drafts',
      '30 verified lead reveals every month',
      'Invoices, calendar, reports, exports',
      'R50 credit for every business owner you refer',
      'Your business listed in the public directory',
    ],
  },
  {
    id: 'BOSS',
    name: 'Boss',
    price: 'R499',
    tagline: 'For teams ready to outscale the competition.',
    icon: <Crown className="h-5 w-5 text-brand" />,
    highlight: true,
    perks: [
      'Everything in Operator',
      '100 verified lead reveals every month',
      'Up to 5 team seats, shared pipeline',
      'Priority AI — faster, longer answers',
      'Founding Member badge',
    ],
  },
]

export default function GrowView() {
  const { toast } = useToast()
  const bumpRefresh = useHp((s) => s.bumpRefresh)
  const [refs, setRefs] = useState<RefsData | null>(null)
  const [plans, setPlans] = useState<PlansData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [subscribing, setSubscribing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, p] = await Promise.all([
        api<RefsData>('/api/refs'),
        api<PlansData>('/api/subscribe'),
      ])
      setRefs(r)
      setPlans(p)
    } catch (e) {
      toast({ title: 'Could not load', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

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
      const res = await api<{ ok: boolean; sandbox?: boolean; redirectUrl?: string }>('/api/subscribe', {
        method: 'POST',
        body: JSON.stringify({ plan: planId }),
      })
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl
        return
      }
      toast({ title: 'Plan activated ✓', description: 'Sandbox mode — set YOCO_SECRET_KEY for live payments.' })
      bumpRefresh()
      await load()
    } catch (e) {
      toast({ title: 'Could not subscribe', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSubscribing(null)
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
      <div className="rounded-xl border border-brand/30 bg-brand/5 p-5 space-y-4">
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
          <Button onClick={shareWhatsApp} className="bg-brand text-black hover:brightness-110 font-semibold">
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
          ) : (
            <Badge variant="outline">Free plan</Badge>
          )}
        </div>
        {active && active.renewsAt && (
          <p className="text-xs text-muted-foreground">
            Renews {new Date(active.renewsAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })} · cancel anytime, your data stays yours.
          </p>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          {PLANS.map((p) => {
            const isCurrent = active?.plan === p.id
            return (
              <div
                key={p.id}
                className={`rounded-xl border p-5 space-y-4 bg-card ${p.highlight ? 'border-brand/50 shadow-[0_0_40px_-12px] shadow-brand/20' : ''}`}
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
                    <div className="font-display text-2xl">{p.price}</div>
                    <div className="text-[10px] text-muted-foreground">per month</div>
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
                  className="w-full bg-brand text-black hover:brightness-110 font-semibold"
                  disabled={subscribing === p.id || isCurrent}
                  onClick={() => subscribe(p.id)}
                >
                  {subscribing === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : isCurrent ? 'Current plan' : `Go ${p.name} — ${p.price}/mo`}
                </Button>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Secure card payments by Yoco · cancel anytime · your CRM data is always exportable — the platform earns your loyalty, it doesn't lock it.
        </p>
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
