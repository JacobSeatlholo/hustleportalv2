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
  KeyRound, Loader2, Mail, Sparkles, CalendarCheck2, Trash2,
  MessageCircle, Copy, Check, Plug, ShieldCheck, ExternalLink, Stethoscope, SendHorizontal, Activity, Brain,
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
    helper: 'Google rejects normal passwords for sending — you MUST use a 16-character App Password: Google Account → Security → 2-Step Verification ON → App passwords (myaccount.google.com/apppasswords). Paste it without spaces. Stored only on your account.',
    secret: true,
  },
  {
    key: 'GEMINI_API_KEY',
    title: 'Gemini API key (optional)',
    icon: <Sparkles className="h-4 w-4 text-brand" />,
    placeholder: 'AIza… or AQ… (Google issues both)',
    helper: 'The AI already runs on HustlePortal AI — no key needed. Add your own free key (aistudio.google.com/apikey) to run on your own quota. If Google ever blocks your key, HustlePortal AI automatically takes over, so scans never die.',
    secret: true,
  },
  {
    key: 'DEEPSEEK_API_KEY',
    title: 'DeepSeek key (optional ranking engine)',
    icon: <Brain className="h-4 w-4 text-brand" />,
    placeholder: 'sk-…',
    helper: 'Pay as you go ranker from platform.deepseek.com. With your key saved, map directory leads are matched and ranked to what you sell on YOUR credits — no daily quota wall, pennies per scan.',
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

interface DiagReport {
  checkedAt: string
  keys: { userKey: { present: boolean; masked?: string }; platformKey: { present: boolean; masked?: string } }
  checks: { source: string; test: string; ok: boolean; status: number | null; detail: string; models?: string[] }[]
  advice: string[]
  verdict: string
}

/** AI diagnostics — reproduces the exact call chain the scan/AI features use and explains failures in plain language. */
function AIDiagnosticsCard() {
  const { toast } = useToast()
  const [report, setReport] = useState<DiagReport | null>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    try {
      const res = await api<DiagReport>('/api/ai/diagnose')
      setReport(res)
    } catch (e) {
      toast({ title: 'Diagnostics failed to run', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Stethoscope className="h-4 w-4 text-brand" />
          <h3 className="font-medium text-sm">AI diagnostics</h3>
          <span className="text-[11px] text-muted-foreground">Scans or AI drafts failing? Run this first.</span>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Run AI diagnostics'}
        </Button>
      </div>
      {report && (
        <div className="space-y-2 text-xs">
          <div className={`rounded-lg border p-2.5 ${report.checks.some((c) => c.ok && c.test.startsWith('live-generate')) ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500' : 'border-amber-500/40 bg-amber-500/5 text-amber-500'}`}>
            <b>Verdict:</b> {report.verdict}
          </div>
          <div className="rounded-lg border p-2.5 space-y-1.5 font-mono">
            {report.checks.map((c, i) => (
              <div key={i} className="flex flex-wrap items-start gap-1.5">
                <span className={c.ok ? 'text-emerald-500' : 'text-rose-500'}>{c.ok ? 'PASS' : 'FAIL'}</span>
                <span className="text-muted-foreground">[{c.source}] {c.test}{c.status ? ` · HTTP ${c.status}` : ''}</span>
                <span className="basis-full text-[11px] text-muted-foreground font-sans">{c.detail}</span>
              </div>
            ))}
          </div>
          {report.advice.length > 0 && (
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
              {report.advice.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

interface MailStatusInfo {
  platformConfigured: boolean
  fromAddress: string
  sendingDomain: string
  domainStatus: 'verified' | 'pending' | 'not_started' | 'failed' | 'unknown'
  domains: { name: string; status: string }[]
  gmailConfigured: boolean
}

interface SvcStatus {
  key: string
  name: string
  ok: boolean
  detail: string
}

/**
 * System status — the trust panel. One honest answer to "is everything working
 * right now?": live checks against the database, the AI engine, the email engine
 * and push, plus what THIS device supports (voice dictation). Refreshes itself;
 * a status panel never cries wolf, so failures stay quiet until the check lands.
 */
function SystemStatusCard() {
  const [services, setServices] = useState<SvcStatus[] | null>(null)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await api<{ services: SvcStatus[]; checkedAt: string }>('/api/status')
      setServices(res.services)
      setCheckedAt(new Date(res.checkedAt).getTime())
    } catch {
      // silent — the panel keeps the last known truth
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])
  // re-render every 10s so "checked Xs ago" stays honest
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000)
    return () => clearInterval(t)
  }, [])

  const voiceSupported =
    typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)

  const rows: SvcStatus[] = [
    ...(services || []),
    {
      key: 'voice',
      name: 'Voice dictation',
      ok: voiceSupported,
      detail: voiceSupported
        ? 'Ready on this device. Tap the mic in Tasks and speak.'
        : 'This browser does not offer dictation. Chrome, Edge or Safari do.',
    },
  ]

  const ago = checkedAt ? Math.max(0, Math.round((Date.now() - checkedAt) / 1000)) : null
  void tick // re-render timer

  return (
    <div className="rounded-xl border border-brand/30 bg-brand/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-brand" />
          <h3 className="font-medium text-sm">System status</h3>
          {rows.every((r) => r.ok) && rows.length > 1 ? (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">ALL SYSTEMS LIVE</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">CHECKING</Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={load} disabled={refreshing}>
          <Loader2 className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <div className="space-y-2">
        {rows.map((s) => (
          <div key={s.key} className="flex items-start gap-2.5">
            <span
              className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                s.ok ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
              }`}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.detail}</p>
            </div>
          </div>
        ))}
        {!services && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking every system now…
          </p>
        )}
      </div>
      {ago !== null && (
        <p className="text-[11px] text-muted-foreground">
          Live check · {ago < 5 ? 'just now' : `${ago}s ago`} · refreshes on its own every minute
        </p>
      )}
    </div>
  )
}

/**
 * Email engine status — the ONE card that answers "can I send email right now?".
 * Shows live Resend domain verification (fetched server-side with the platform key)
 * so setup never feels like guesswork.
 */
interface LastSystemSend { to: string; subject: string; ok: boolean; via?: string; error?: string; at: string }

function MailEngineCard() {
  const [status, setStatus] = useState<MailStatusInfo | null>(null)
  const [lastSend, setLastSend] = useState<LastSystemSend | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ status: MailStatusInfo; lastSend?: LastSystemSend | null }>('/api/emails/status')
      setStatus(res.status)
      setLastSend(res.lastSend || null)
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // One tap → the exact system-mail path password resets use. Arrives = engine
  // proven end-to-end; fails = the precise fix shows right here.
  const sendTest = useCallback(async () => {
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await api<{ ok: boolean; notice?: string }>('/api/emails/test', { method: 'POST' })
      setTestMsg({ ok: true, text: res.notice || 'Test email sent — check your inbox (and spam).' })
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : 'Test send failed.' })
    } finally {
      setTesting(false)
      load()
    }
  }, [load])

  const verified = status?.domainStatus === 'verified'
  const badge = !status || !status.platformConfigured
    ? <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-500">WARMING UP</Badge>
    : verified
      ? <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">LIVE</Badge>
      : <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">VERIFYING · {status.sendingDomain}</Badge>

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Mail className="h-4 w-4 text-brand" />
          <h3 className="font-medium text-sm">Email engine</h3>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : badge}
        </div>
        <div className="flex items-center gap-3">
          <a href="https://resend.com/domains" target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Resend domains <ExternalLink className="h-3 w-3" />
          </a>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Check again'}
          </Button>
          <Button size="sm" onClick={sendTest} disabled={testing}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
            Send test
          </Button>
        </div>
      </div>
      {testMsg && (
        <p className={`text-xs leading-relaxed ${testMsg.ok ? 'text-emerald-500' : 'text-rose-500'}`}>
          {testMsg.text}
        </p>
      )}
      {lastSend && (
        <p className={`text-xs leading-relaxed rounded-lg border px-2.5 py-2 ${lastSend.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
          {lastSend.via === 'no-account' ? (
            <>
              <b>Last reset request — no account match.</b> Someone asked to reset the password for <b>{lastSend.to}</b>{' '}
              at {new Date(lastSend.at).toLocaleString('en-ZA')}, but no HustlePortal account uses that address, so nothing was sent.
              If that was you: check the address for a typo, or sign up fresh — the reset link only goes to the exact email on the account.
            </>
          ) : (
            <>
              <b>Last system email</b> ({lastSend.ok ? 'accepted by the engine' : 'failed'}){lastSend.via ? ` · via ${lastSend.via}` : ''}:{' '}
              <b>{lastSend.to}</b> — “{lastSend.subject}” at {new Date(lastSend.at).toLocaleString('en-ZA')}.
              {lastSend.ok
                ? ' Accepted means Resend took it — if it never lands, check spam and confirm this is the exact address you check.'
                : ` Engine error: ${lastSend.error || 'unknown'}`}
            </>
          )}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {!status ? 'Checking the sending engine…'
          : !status.platformConfigured
            ? 'The built-in engine is warming up. You can already send by connecting Gmail below — or wait a moment and check again.'
            : verified
              ? `Ready — every send goes out from ${status.fromAddress} with replies routed back to your account email. Zero setup, nothing to maintain.`
              : status.domainStatus === 'failed'
                ? `${status.sendingDomain} failed verification at Resend — open resend.com/domains to see which DNS record is missing or wrong, fix it at your domain\u2019s DNS host, then hit Verify again.`
                : `${status.sendingDomain} is finishing verification — DNS records can take from a few minutes up to a few hours to be seen. Sends already work to your own inbox; they open up to every client the moment it flips to verified. No other setup exists.`}
      </p>
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
  const [mailTesting, setMailTesting] = useState(false)
  const [mailVerdict, setMailVerdict] = useState<{ ok: boolean; msg: string } | null>(null)
  const [geminiVerdict, setGeminiVerdict] = useState<{ ok: boolean; msg: string } | null>(null)
  // Verdict for the pay as you go engine key (DeepSeek): keyed by setting key
  // so the card renders its own save time probe result.
  const [engineVerdicts, setEngineVerdicts] = useState<Record<string, { ok: boolean; msg: string }>>({})

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
    if (key === 'GEMINI_API_KEY') setGeminiVerdict(null)
    if (key === 'DEEPSEEK_API_KEY') {
      setEngineVerdicts((v) => ({ ...v, [key]: undefined as never }))
    }
    try {
      const res = await api<{ setting: IntegrationSetting; validation?: { ok: boolean; message: string } | null }>(
        '/api/settings',
        {
          method: 'PUT',
          body: JSON.stringify({ key, value }),
        },
      )
      setSettings((rows) => [...rows.filter((r) => r.key !== key), res.setting])
      setDrafts((d) => ({ ...d, [key]: '' }))
      if (key === 'GEMINI_API_KEY' && res.validation) {
        // The verdict IS the toast — a blocked key is named in the same minute it's pasted.
        setGeminiVerdict({ ok: res.validation.ok, msg: res.validation.message })
        toast({
          title: res.validation.ok ? 'Gemini key verified ✓' : 'Key saved — but Google rejected it',
          description: res.validation.ok
            ? 'AI will now run on your own quota.'
            : 'HustlePortal AI automatically covers the gap, so nothing breaks. See the note under the key for the fix.',
          variant: res.validation.ok ? 'default' : 'destructive',
        })
      } else if (key === 'DEEPSEEK_API_KEY' && res.validation) {
        const engine = 'DeepSeek'
        setEngineVerdicts((v) => ({ ...v, [key]: { ok: res.validation!.ok, msg: res.validation!.message } }))
        toast({
          title: res.validation.ok ? `${engine} key verified ✓` : `Key saved — but ${engine} flagged something`,
          description: res.validation.ok
            ? 'Scans now run on your own credits.'
            : 'See the note under the key for the fix. Nothing breaks meanwhile.',
          variant: res.validation.ok ? 'default' : 'destructive',
        })
      } else {
        toast({ title: 'Saved ✓', description: `${key} stored securely on your account.` })
      }
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
      if (key === 'GMAIL_APP_PASSWORD') setMailVerdict(null)
    } catch {
      // non-fatal
    }
  }

  // SMTP handshake against the saved Gmail creds — instant verdict, no email sent.
  async function testGmail() {
    setMailTesting(true)
    setMailVerdict(null)
    try {
      const res = await api<{ ok: boolean; message: string }>('/api/settings/mail-test', { method: 'POST' })
      setMailVerdict({ ok: true, msg: res.message })
      toast({ title: 'Gmail connection verified ✓', description: res.message })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Test failed'
      setMailVerdict({ ok: false, msg })
    } finally {
      setMailTesting(false)
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
          <SystemStatusCard />
          <MailEngineCard />
          <AIDiagnosticsCard />
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
                {intg.key === 'GEMINI_API_KEY' && geminiVerdict && (
                  <p
                    className={`text-xs rounded-md border px-2.5 py-2 leading-relaxed ${
                      geminiVerdict.ok
                        ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/5'
                        : 'border-amber-500/40 text-amber-400 bg-amber-500/5'
                    }`}
                  >
                    {geminiVerdict.ok ? '✓ ' : '⚠ '}
                    {geminiVerdict.msg}
                  </p>
                )}
                {engineVerdicts[intg.key] && (
                  <p
                    className={`text-xs rounded-md border px-2.5 py-2 leading-relaxed ${
                      engineVerdicts[intg.key].ok
                        ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/5'
                        : 'border-amber-500/40 text-amber-400 bg-amber-500/5'
                    }`}
                  >
                    {engineVerdicts[intg.key].ok ? '✓ ' : '⚠ '}
                    {engineVerdicts[intg.key].msg}
                  </p>
                )}
                {intg.key === 'GMAIL_APP_PASSWORD' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={testGmail}
                        disabled={mailTesting}
                        variant="outline"
                        className="h-8 text-xs"
                      >
                        {mailTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                        Test Gmail connection
                      </Button>
                      <span className="text-[11px] text-muted-foreground">Runs a real Google login check — no email is sent.</span>
                    </div>
                    {mailVerdict && (
                      <p className={`text-xs rounded-md border px-2.5 py-2 ${mailVerdict.ok ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/5' : 'border-rose-500/40 text-rose-400 bg-rose-500/5'}`}>
                        {mailVerdict.ok ? '✓ ' : '✕ '}{mailVerdict.msg}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">About verified leads</p>
        <p>
          Verified leads are sourced, checked and delivered to your pipeline <b>by the HustlePortal team behind the
          scenes</b> — you see the results, not the plumbing. We feed your pipeline. You run your business.
        </p>
      </div>
    </div>
  )
}
