'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api, type IntegrationSetting } from './shared'
import { useHp } from './store'
import { useToast } from '@/hooks/use-toast'
import { KeyRound, Loader2, Mail, Sparkles, Database, CalendarCheck2, Trash2 } from 'lucide-react'

const INTEGRATIONS: {
  key: string
  title: string
  icon: React.ReactNode
  placeholder: string
  helper: string
  secret?: boolean
}[] = [
  {
    key: 'GMAIL_USER',
    title: 'Gmail address (optional)',
    icon: <Mail className="h-4 w-4 text-brand" />,
    placeholder: 'you@gmail.com',
    helper: 'Optional upgrade — Mail already sends via the HustlePortal engine. Add your Gmail to send from your own address instead.',
  },
  {
    key: 'GMAIL_APP_PASSWORD',
    title: 'Gmail app password (optional)',
    icon: <KeyRound className="h-4 w-4 text-brand" />,
    placeholder: '16-character app password',
    helper: 'Only if you connect your Gmail above: Google Account → Security → 2-Step Verification → App passwords. Stored only on your account.',
    secret: true,
  },
  {
    key: 'GEMINI_API_KEY',
    title: 'Gemini API key (optional)',
    icon: <Sparkles className="h-4 w-4 text-brand" />,
    placeholder: 'AIza…',
    helper: 'The AI Co-Founder, plans and drafts already run on HustlePortal AI — no key needed. Add your own free key (aistudio.google.com) to run AI on your own quota.',
    secret: true,
  },
  {
    key: 'EXPLEE_API_KEY',
    title: 'Explee API key (optional)',
    icon: <Database className="h-4 w-4 text-brand" />,
    placeholder: 'explee_…',
    helper: 'Explee is a background verified-leads source ONLY — it quietly tops up your lead list. We are not trying to be another Explee; HustlePortal is your full Business OS.',
    secret: true,
  },
  {
    key: 'GCAL_OAUTH_TOKEN',
    title: 'Google Calendar token (optional)',
    icon: <CalendarCheck2 className="h-4 w-4 text-brand" />,
    placeholder: 'ya29.…',
    helper: 'OAuth access token for automatic Calendar sync. Without it, appointments still offer one-click "Add to Google Calendar" links and .ics exports.',
    secret: true,
  },
]

export default function IntegrationsView() {
  const { bumpRefresh } = useHp()
  const { toast } = useToast()
  const [settings, setSettings] = useState<IntegrationSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ settings: IntegrationSetting[] }>('/api/settings')
      setSettings(res.settings)
    } catch (e) {
      toast({ title: 'Could not load settings', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  async function save(key: string) {
    const value = (drafts[key] ?? '').trim()
    setSaving(key)
    try {
      const res = await api<{ setting: IntegrationSetting }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ key, value }),
      })
      setSettings((rows) => [...rows.filter((r) => r.key !== key), res.setting])
      setDrafts((d) => ({ ...d, [key]: '' }))
      toast({ title: 'Saved ✓', description: `${key} stored securely on your account.` })
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSaving(null)
    }
  }

  async function clear(key: string) {
    try {
      await api(`/api/settings?key=${key}`, { method: 'DELETE' })
      setSettings((rows) => rows.filter((r) => r.key !== key))
      toast({ title: 'Cleared', description: `${key} removed.` })
    } catch {
      // non-fatal
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Plug &amp; play — AI, email, calendar links and payments already work with zero setup. Everything below is an
          optional upgrade. Your keys stay on your account only — nothing shared, nothing pooled.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />)}</div>
      ) : (
        <div className="space-y-3">
          {INTEGRATIONS.map((intg) => {
            const row = settings.find((s) => s.key === intg.key)
            const configured = row?.configured || false
            return (
              <div key={intg.key} className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    {intg.icon}
                    <h3 className="font-medium text-sm">{intg.title}</h3>
                    {configured ? (
                      <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">CONNECTED</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] border-stone-500/40 text-stone-400">NOT SET</Badge>
                    )}
                  </div>
                  {configured && (
                    <button onClick={() => clear(intg.key)} className="text-muted-foreground hover:text-rose-400 transition" title="Clear stored value">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{intg.helper}</p>
                <div className="flex gap-2">
                  <Input
                    type={intg.secret ? 'password' : 'text'}
                    placeholder={configured && row?.value ? row.value : intg.placeholder}
                    value={drafts[intg.key] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [intg.key]: e.target.value }))}
                    className="flex-1"
                  />
                  <Button onClick={() => save(intg.key)} disabled={saving === intg.key || !(drafts[intg.key] ?? '').trim()}>
                    {saving === intg.key ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">About Explee &amp; verified leads</p>
        <p>
          Explee integration is a <b>background verified-leads source only</b> — when set, it quietly enriches your lead list
          with verified contact data. We are not trying to be another Explee: HustlePortal is your Business OS, and Explee is
          simply one pipe that can feed it.
        </p>
      </div>
    </div>
  )
}
