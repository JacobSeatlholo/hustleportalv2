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
import { Loader2, KeyRound, Users, Target, Coins, Eye, EyeOff, Save } from 'lucide-react'

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
