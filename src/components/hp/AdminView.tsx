'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api, rands } from './shared'
import { Loader2, KeyRound, Users, Target, Coins, Eye, EyeOff, Save, TrendingUp, Crown, Gift, Repeat2, Trophy } from 'lucide-react'

interface GrowthData {
  mrr: { cents: number; targetCents: number; percent: number }
  members: { total: number; newThisMonth: number; subscribers: number; byPlan: { HUSTLER: number; BOSS: number } }
  subscriptions: { active: number; pastDue: number; canceled: number }
  referrals: { total: number; subscribed: number; viaReferralActive: number }
  topups: { last30DaysCents: number }
  leaderboard: { name: string; businessName: string | null; invites: number; subscribed: number }[]
}

function GrowthSection() {
  const [data, setData] = useState<GrowthData | null>(null)
  useEffect(() => {
    api<GrowthData>('/api/admin/growth').then(setData).catch(() => setData(null))
  }, [])
  if (!data) return null
  const remain = Math.max(0, data.mrr.targetCents - data.mrr.cents)
  return (
    <Card className="border-brand/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-brand" /> Revenue &amp; Growth — R45,000/mo mission
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* MRR progress */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="font-display text-3xl">{rands(data.mrr.cents)}<span className="text-sm text-muted-foreground font-sans"> MRR</span></div>
            <div className="text-xs text-muted-foreground">{rands(remain)} to go · {data.mrr.percent}%</div>
          </div>
          <div className="h-3 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${data.mrr.percent}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Operator ×{data.members.byPlan.HUSTLER}</span>
            <span>Boss ×{data.members.byPlan.BOSS}</span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniStat icon={<Users className="h-3.5 w-3.5" />} label="Members" value={String(data.members.total)} sub={`+${data.members.newThisMonth} this month`} />
          <MiniStat icon={<Crown className="h-3.5 w-3.5" />} label="Subscribers" value={String(data.subscriptions.active)} sub={`${data.subscriptions.pastDue} past due · ${data.subscriptions.canceled} canceled`} />
          <MiniStat icon={<Gift className="h-3.5 w-3.5" />} label="Referrals" value={String(data.referrals.total)} sub={`${data.referrals.subscribed} subscribed`} />
          <MiniStat icon={<Repeat2 className="h-3.5 w-3.5" />} label="Top-ups 30d" value={rands(data.topups.last30DaysCents)} sub="one-off credit sales" />
        </div>

        {/* Referral leaderboard — teams invite teams */}
        {data.leaderboard.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5 text-brand" /> Top recruiters — the growth engine</div>
            <div className="rounded-lg border divide-y">
              {data.leaderboard.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-5 text-center font-display text-brand">{i + 1}</span>
                  <span className="flex-1 truncate">{r.name}{r.businessName ? ` · ${r.businessName}` : ''}</span>
                  <Badge variant="outline" className="text-[10px]">{r.invites} invited</Badge>
                  <Badge variant="outline" className="text-[10px] border-brand/40 text-brand">{r.subscribed} subscribed</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reverse-churn signal */}
        <p className="text-xs text-muted-foreground">
          {data.referrals.viaReferralActive} of {data.subscriptions.active} active subscribers arrived via referral —
          referred members are your stickiest. Keep the invite loop warm.
        </p>
      </CardContent>
    </Card>
  )
}

function MiniStat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{icon}{label}</div>
      <div className="font-display text-lg mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

interface AdminData {
  config: {
    expleeKeySet: boolean
    expleeKeyMasked: string
    leadPrice: number
    mode: string
    packs: { id: string; name: string; amountCents: number; creditCents: number; bonus: number }[]
  }
  stats: { userCount: number; leadCount: number; topupTotal: number }
  users: { id: string; name: string; email: string; businessName: string | null; role: string; xp: number; createdAt: string; wallet: { balance: number } | null }[]
}

export default function AdminView() {
  const { toast } = useToast()
  const [data, setData] = useState<AdminData | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [leadPrice, setLeadPrice] = useState('')
  const [mode, setMode] = useState('DEMO')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      const d = await api<AdminData>('/api/admin/config')
      setData(d)
      setLeadPrice(String(d.config.leadPrice / 100))
      setMode(d.config.mode)
    } catch (e) {
      toast({ title: 'Admin load failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  useEffect(() => {
    load()
     
  }, [])

  async function save() {
    setSaving(true)
    try {
      await api('/api/admin/config', {
        method: 'POST',
        body: JSON.stringify({
          ...(apiKey.trim() ? { expleeApiKey: apiKey.trim() } : {}),
          leadPrice: Math.round(parseFloat(leadPrice) * 100) || 1500,
          mode,
        }),
      })
      toast({ title: 'Settings saved' })
      setApiKey('')
      await load()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (!data) {
    return <div className="space-y-4"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl">Admin</h1>
        <p className="text-sm text-muted-foreground">Platform settings, lead economics and users.</p>
      </div>

      <GrowthSection />

      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard icon={<Users className="h-4 w-4" />} label="Users" value={String(data.stats.userCount)} />
        <StatCard icon={<Target className="h-4 w-4" />} label="Leads in platform" value={String(data.stats.leadCount)} />
        <StatCard icon={<Coins className="h-4 w-4" />} label="Top-ups processed" value={rands(data.stats.topupTotal)} />
      </div>

      {/* Config */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Lead economy &amp; integrations</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Explee API key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={data.config.expleeKeySet ? data.config.expleeKeyMasked : 'Paste key from explee.com → API Keys'}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {data.config.expleeKeySet
                ? 'Key configured — lead discovery uses live Explee data.'
                : 'No key yet — lead discovery runs in demo mode. Get yours at explee.com (API Keys in account settings).'}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Lead reveal price (R)</Label>
              <Input type="number" value={leadPrice} onChange={(e) => setLeadPrice(e.target.value)} />
              <p className="text-xs text-muted-foreground">What clients pay in credits to unlock contact details. Your margin over Explee cost lives here.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Data mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEMO">Demo (fallback data)</SelectItem>
                  <SelectItem value="LIVE">Live (Explee)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save settings
          </Button>
        </CardContent>
      </Card>

      {/* Users */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Users</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y max-h-[50vh] overflow-y-auto hp-scroll">
            {data.users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="h-9 w-9 rounded-full bg-brand/15 text-brand flex items-center justify-center text-sm font-bold shrink-0">
                  {u.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {u.name} {u.businessName && <span className="text-muted-foreground font-normal">· {u.businessName}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                </div>
                {u.role === 'ADMIN' && <Badge className="bg-sidebar text-white hover:bg-sidebar">admin</Badge>}
                <span className="text-xs text-muted-foreground hidden sm:block">{u.xp} XP</span>
                <span className="text-xs font-medium w-16 text-right">{rands(u.wallet?.balance ?? 0)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded-lg bg-brand/15 p-2 text-brand">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="font-display text-2xl">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}
