'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api, type IntegrationSetting } from './shared'
import { useHp } from './store'
import { useToast } from '@/hooks/use-toast'
import {
  KeyRound, Loader2, Mail, Sparkles, Database, CalendarCheck2, Trash2,
  MessageCircle, Copy, Check, Plug, ShieldCheck, ExternalLink,
} from 'lucide-react'

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

interface WaStatus {
  connected: boolean
  phoneNumberId: string | null
  displayNumber: string | null
  verifyToken: string | null
  webhookPath: string
}

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast({ title: 'Could not copy — select the text manually', variant: 'destructive' })
    }
  }
  return (
    <div className="flex items-center gap-2">
      <div className="w-28 shrink-0 text-xs text-muted-foreground">{label}</div>
      <code className={`flex-1 truncate rounded bg-black/40 px-2 py-1.5 text-xs ${mono ? 'font-mono' : ''}`}>{value}</code>
      <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
        {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/** WhatsApp Business Cloud API connect card — per-user credentials + webhook. */
function WhatsAppCard() {
  const { toast } = useToast()
  const { bumpRefresh } = useHp()
  const [status, setStatus] = useState<WaStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<WaStatus>('/api/whatsapp/connect')
      setStatus(res)
    } catch (e) {
      toast({ title: 'Could not load WhatsApp status', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  async function connect() {
    setSaving(true)
    try {
      const res = await api<WaStatus>('/api/whatsapp/connect', {
        method: 'POST',
        body: JSON.stringify({ phoneNumberId, accessToken }),
      })
      setStatus(res)
      setPhoneNumberId('')
      setAccessToken('')
      toast({
        title: 'WhatsApp connected ✓',
        description: res.displayNumber ? `Linked to ${res.displayNumber}. Paste the webhook below into Meta to auto-capture contacts.` : 'Verified with Meta.',
      })
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Verification failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    setDisconnecting(true)
    try {
      await api('/api/whatsapp/connect', { method: 'DELETE' })
      await load()
      toast({ title: 'WhatsApp disconnected', description: 'Your contacts stay — only the API link was removed.' })
    } catch {
      // non-fatal
    } finally {
      setDisconnecting(false)
    }
  }

  const webhookUrl = status ? `${typeof window !== 'undefined' ? window.location.origin : 'https://hustleportal.online'}${status.webhookPath}` : ''

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <MessageCircle className="h-4 w-4 text-brand" />
          <h3 className="font-medium text-sm">WhatsApp Business</h3>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : status?.connected ? (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">CONNECTED{status.displayNumber ? ` · ${status.displayNumber}` : ''}</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] border-stone-500/40 text-stone-400">NOT CONNECTED</Badge>
          )}
        </div>
        <a
          href="https://business.facebook.com/latest/whatsapp_business_phone_numbers/"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Meta dashboard <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <p className="text-xs text-muted-foreground">
        <b className="text-foreground">1-click import, zero setup:</b> your clients list can bulk-import any WhatsApp list you paste or upload (Clients → Import from WhatsApp) — Meta does not let ANY tool read your app&apos;s contact list, so that&apos;s the compliant way.{' '}
        <b className="text-foreground">Optional API link below</b> adds auto-capture: everyone who messages your business number is added to your CRM automatically.
      </p>

      {!loading && !status?.connected && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wa-pid">WhatsApp Business Phone Number ID</Label>
            <Input id="wa-pid" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="e.g. 123456789012345" />
            <p className="text-[11px] text-muted-foreground">Meta developers → WhatsApp → API Setup → &quot;Phone number ID&quot; (not the phone number itself).</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-token">Access token</Label>
            <Input id="wa-token" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="EAAG… (System User token)" />
            <p className="text-[11px] text-muted-foreground">Create a System User in Meta Business Settings, add the WhatsApp product, generate a token with whatsapp_business_messaging. Stored only on your account.</p>
          </div>
          <Button onClick={connect} disabled={saving || !phoneNumberId.trim() || !accessToken.trim()}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plug className="h-4 w-4 mr-1.5" />}
            Connect &amp; verify with Meta
          </Button>
        </div>
      )}

      {!loading && status?.connected && (
        <div className="space-y-3">
          <div className="rounded-lg border border-brand/20 bg-brand/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="h-3.5 w-3.5 text-brand" /> Finish in Meta (2 pastes) — activates auto-capture</div>
            <p className="text-[11px] text-muted-foreground">
              In Meta developers → WhatsApp → Configuration: set the Callback URL and Verify token below, then click Subscribe to the <b>messages</b> field. After that, every customer who messages your number lands in Clients automatically.
            </p>
            <CopyRow label="Callback URL" value={webhookUrl} />
            <CopyRow label="Verify token" value={status.verifyToken || ''} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              <Loader2 className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : 'hidden'}`} /> Recheck status
            </Button>
            <Button variant="outline" onClick={disconnect} disabled={disconnecting} className="text-red-400 hover:text-red-300">
              {disconnecting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

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
          <WhatsAppCard />
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
