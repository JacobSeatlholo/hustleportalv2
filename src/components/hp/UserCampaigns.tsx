'use client'

/**
 * UserCampaigns — the Campaigns card for upgraded members (non-exec seats).
 *
 * The rule the boss set on a live call: campaigns show up once a user has
 * upgraded, the card carries a Begin campaign button, and the transport lane
 * is NEVER shown or picked — the engine prefers the SES lane when wired and
 * falls back silently. What the member DOES pick:
 *   - who it goes to (their own unlocked pipeline contacts + pasted lists)
 *   - which of their own profiles it leaves from (never a guessed name)
 *   - the letter, the look, the pace
 * Replies land in their account inbox, read receipts land on the rows, and
 * nothing sends until they press Start on a card. Airtime law applies the
 * same as every send: bundle free, beyond it airtime, debit after delivery.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api, type Lead, type CampaignRow, type CampaignInfo, type CampaignState } from './shared'
import { EmailPreviewDialog } from './EmailPreviewDialog'
import type { MailThemeId } from '@/lib/mailthemes'
import { useToast } from '@/hooks/use-toast'
import { useHp } from './store'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Megaphone, MailCheck, ChevronDown, ChevronUp, User, Play, Pause, Ban, Plus, Search, X, Pencil, Palette, Eye, Sparkles } from 'lucide-react'
import { requestUpgrade } from './useUpgrade'

/** One "Sending from" choice: the account identity (id '') or a workspace. */
export interface SenderProfile {
  id: string
  name: string
  from: string
}

// The same looks the composer offers, same honest default.
const LOOKS: { id: MailThemeId; label: string; dot: string; blurb: string }[] = [
  { id: 'plain', label: 'Plain', dot: '#9CA3AF', blurb: 'No frame — clean text, exactly as you write it.' },
  { id: 'boardroom', label: 'Boardroom', dot: '#16305C', blurb: 'Navy and quiet. Quotes, follow-ups and professional correspondence.' },
  { id: 'goldrush', label: 'Gold Rush', dot: '#F5C518', blurb: 'Warm gold, the honey badger up front. Pitches and announcements that get remembered.' },
  { id: 'nightshift', label: 'Nightshift', dot: '#0B0E14', blurb: 'Dark and bold. Big offers and after-hours energy.' },
]


/** `paid` comes from the mail section: paying members run campaigns as-is,
 *  free plans see the same card but the buttons hand them the ONE upgrade
 *  prompt before anything works (the server's 402 backs this up either way). */
export default function UserCampaigns({ profiles, paid = true }: { profiles: SenderProfile[]; paid?: boolean }) {
  const { bumpRefresh } = useHp()
  const { toast } = useToast()
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([])
  const [rows, setRows] = useState<CampaignRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reading, setReading] = useState<CampaignRow | null>(null)
  const [actingTag, setActingTag] = useState<string | null>(null)
  const [removingRowId, setRemovingRowId] = useState<string | null>(null)

  // composer state
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'audience' | 'message'>('audience')
  const [leads, setLeads] = useState<Lead[]>([])
  const [search, setSearch] = useState('')
  const [pickIds, setPickIds] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const [cName, setCName] = useState('')
  const [cFrom, setCFrom] = useState('')
  const [cSubject, setCSubject] = useState('')
  const [cBody, setCBody] = useState('')
  const [cTheme, setCTheme] = useState<MailThemeId>('plain')
  const [cPerHour, setCPerHour] = useState('45')
  const [personalize, setPersonalize] = useState(true)
  const [creating, setCreating] = useState(false)
  // The member's own brand on the chrome: business name (and optional logo)
  // replaces the BH mark on this campaign's emails. Empty = platform chrome.
  const [cBrandName, setCBrandName] = useState('')
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)

  // edit draft state
  const [editTag, setEditTag] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ subject: '', body: '', perHour: 45, theme: 'engine', brandName: '' })
  const [editSaving, setEditSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api<{ campaigns: CampaignInfo[]; rows: CampaignRow[] }>('/api/campaigns')
      setCampaigns(res.campaigns || [])
      setRows(res.rows || [])
    } catch {
      setCampaigns([])
      setRows([])
    } finally {
      setLoaded(true)
    }
  }, [])
  // Free plans never call the gated endpoints: the card shows its upgrade
  // prompt instead, and no request fires until they actually upgrade.
  useEffect(() => {
    if (!paid) { setLoaded(true); return }
    load()
  }, [load, paid])

  // The account's campaign logo, loaded once — both the composer and Edit
  // draft offer it, and a queue stores only the hosted url.
  useEffect(() => {
    if (!paid) return
    api<{ logoUrl: string | null }>('/api/campaign-logo')
      .then((res) => setBrandLogoUrl(res.logoUrl))
      .catch(() => setBrandLogoUrl(null))
  }, [paid])

  // Upload / remove the account's campaign logo (PNG/JPG, email-safe raster).
  async function uploadBrandLogo(file: File) {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      toast({ title: 'PNG or JPG only', description: 'Email clients refuse SVG and other formats — export the logo as PNG and try again.', variant: 'destructive' })
      return
    }
    if (file.size > 300_000) {
      toast({ title: 'Logo too heavy', description: `${Math.round(file.size / 1024)} KB — keep it under 300 KB.`, variant: 'destructive' })
      return
    }
    setLogoBusy(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(new Error('read failed'))
        fr.readAsDataURL(file)
      })
      const res = await api<{ logoUrl: string }>('/api/campaign-logo', { method: 'PUT', body: JSON.stringify({ dataUrl }) })
      setBrandLogoUrl(res.logoUrl)
      toast({ title: 'Logo saved', description: 'Your campaigns can now wear it instead of the BH mark.' })
    } catch (e) {
      toast({ title: 'Could not save the logo', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLogoBusy(false)
    }
  }

  async function removeBrandLogo() {
    setLogoBusy(true)
    try {
      await api('/api/campaign-logo', { method: 'DELETE' })
      setBrandLogoUrl(null)
      toast({ title: 'Logo removed', description: 'Branded campaigns fall back to the initials chip.' })
    } catch {
      toast({ title: 'Could not remove it', variant: 'destructive' })
    } finally {
      setLogoBusy(false)
    }
  }

  // The pipeline list for the audience picker, fetched when the composer opens.
  useEffect(() => {
    if (!open) return
    api<{ leads: Lead[] }>('/api/leads')
      .then((res) => setLeads(res.leads.filter((l) => l.unlocked && l.email)))
      .catch(() => setLeads([]))
  }, [open])

  // While a queue is ACTIVE the open screen taps the engine every minute so
  // progress is visible while you watch; the cron heartbeat keeps the pace
  // when the tab is closed.
  const anyActive = campaigns.some((c) => c.state?.status === 'ACTIVE')
  useEffect(() => {
    if (!anyActive) return
    const t = setInterval(async () => {
      try {
        await api('/api/cron/campaign-tick')
        load()
      } catch {
        // cooldown or session lapse, the engine still drives itself
      }
    }, 60_000)
    return () => clearInterval(t)
  }, [anyActive, load])

  const leadsRef = useRef(leads)
  leadsRef.current = leads

  function campaignLabel(tag: string) {
    return tag.replace(/^u-/, '').split(/[-_]+/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
  }

  const pastedEmails = paste.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  const pickCount = pickIds.size + pastedEmails.length
  const personalizable = /\{name\}|\{email\}/.test(cBody) || /\{name\}/.test(cSubject)
  const sampleFill = (t: string) => t.replace(/\{name\}/g, leads[0]?.contactName || 'Thabo').replace(/\{email\}/g, leads[0]?.email || 'you@example.co.za')
  const audienceLeads = leads
    .filter((l) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return l.company.toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q) || (l.contactName || '').toLowerCase().includes(q)
    })
    .slice(0, 300)
  const pickedProfile = profiles.find((p) => p.id === cFrom)
  const readingRow = reading ? readRow(reading) : null

  function togglePick(id: string) {
    setPickIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetComposer() {
    setStep('audience'); setPickIds(new Set()); setPaste(''); setSearch('')
    setCName(''); setCSubject(''); setCBody(''); setCPerHour('45'); setCTheme('plain'); setPersonalize(true)
    setCBrandName('')
    // keep cFrom: the member's last sender pick is usually the right one
  }

  function finishEstimate(n: number, perHour: number) {
    if (!n || !perHour) return ''
    const hours = n / perHour
    if (hours < 1) return 'under an hour'
    if (hours < 24) return `about ${Math.ceil(hours)} hour${Math.ceil(hours) === 1 ? '' : 's'}`
    const days = Math.ceil(hours / 24)
    return `about ${days} day${days === 1 ? '' : 's'}`
  }

  async function createQueue() {
    if (!cSubject.trim()) {
      toast({ title: 'Add a subject', description: 'One strong line. It is the first thing they see.', variant: 'destructive' })
      return
    }
    if (cBody.trim().length < 20) {
      toast({ title: 'Write the message', description: 'The draft needs a body before it can queue.', variant: 'destructive' })
      return
    }
    if (pickCount === 0) {
      toast({ title: 'Pick an audience', description: 'Select contacts or paste addresses first.', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const res = await api<{ campaign: string; queued: number; personalized?: boolean; skippedSuppressed: number; skippedDuplicate: number; invalid: string[] }>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          campaign: cName.trim() || cSubject.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40),
          subject: cSubject.trim(),
          body: cBody,
          theme: cTheme === 'plain' ? 'plain' : cTheme,
          brand: cBrandName.trim()
            ? { name: cBrandName.trim(), ...(brandLogoUrl ? { logoUrl: brandLogoUrl } : {}) }
            : null,
          perHour: Number(cPerHour),
          fromProfile: cFrom || undefined,
          leads: [...pickIds],
          emails: pastedEmails,
          personalize: personalize || undefined,
        }),
      })
      const bits = [`${res.queued} contacts queued`]
      if (res.personalized) bits.push('each one greeted by name')
      if (res.skippedDuplicate) bits.push(`${res.skippedDuplicate} already in this campaign`)
      if (res.skippedSuppressed) bits.push(`${res.skippedSuppressed} unsubscribed or bounced, refused`)
      if (res.invalid.length) bits.push(`${res.invalid.length} invalid address${res.invalid.length === 1 ? '' : 'es'} dropped`)
      toast({
        title: 'Queue built, nothing sent yet',
        description: `${bits.join(' · ')}. Press Start on the card when the draft reads right.`,
      })
      resetComposer()
      setOpen(false)
      setExpanded(res.campaign)
      load()
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Could not build the queue', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function control(tag: string, action: 'start' | 'pause' | 'cancel') {
    if (action === 'cancel' && !window.confirm(`Cancel the ${campaignLabel(tag)} queue? Every unsent email is skipped and the campaign is closed.`)) return
    setActingTag(tag)
    try {
      await api('/api/campaigns', { method: 'PATCH', body: JSON.stringify({ campaign: tag.replace(/^u-/, ''), action }) })
      toast({
        title: action === 'start' ? 'Campaign started' : action === 'pause' ? 'Campaign paused' : 'Campaign cancelled',
        description: action === 'start'
          ? 'The engine now paces this queue around the clock. Press pause any time.'
          : action === 'pause'
            ? 'Sends stop on the spot. Start again whenever you are ready.'
            : 'The queue is closed. Sent emails and their read receipts stay.',
      })
      load()
      if (action === 'start') api('/api/cron/campaign-tick').catch(() => { /* first turn, best effort */ })
    } catch (e) {
      toast({ title: 'Could not update the campaign', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setActingTag(null)
    }
  }

  async function removeRow(tag: string, rowId: string) {
    setRemovingRowId(rowId)
    try {
      await api('/api/campaigns', { method: 'PATCH', body: JSON.stringify({ campaign: tag.replace(/^u-/, ''), action: 'removeRow', rowId }) })
      toast({ title: 'Removed from the campaign', description: 'That email is out of the queue and will not send. The log keeps the record.' })
      load()
    } catch (e) {
      toast({ title: 'Could not remove it', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setRemovingRowId(null)
    }
  }

  function openEdit(tag: string) {
    const queued = rows.find((r) => r.campaign === tag && r.status === 'QUEUED')
    const info = campaigns.find((c) => c.tag === tag)
    setEditDraft({
      subject: queued?.subject || '',
      body: queued?.body || '',
      perHour: info?.state?.perHour || 45,
      theme: info?.state?.theme || 'engine',
      brandName: info?.state?.brand?.name || '',
    })
    setEditTag(tag)
  }

  async function saveEdit() {
    if (!editTag) return
    setEditSaving(true)
    try {
      const res = await api<{ updatedRows: number; queuedLeft: number }>('/api/campaigns', {
        method: 'PATCH',
        body: JSON.stringify({
          campaign: editTag.replace(/^u-/, ''),
          action: 'editDraft',
          subject: editDraft.subject,
          body: editDraft.body,
          perHour: Number(editDraft.perHour) || undefined,
          theme: editDraft.theme === 'engine' ? '' : editDraft.theme,
          brand: editDraft.brandName.trim()
            ? { name: editDraft.brandName.trim(), ...(brandLogoUrl ? { logoUrl: brandLogoUrl } : {}) }
            : null,
        }),
      })
      toast({
        title: `Draft updated · ${res.updatedRows} email${res.updatedRows === 1 ? '' : 's'} rewritten`,
        description: `${res.queuedLeft} still queued. Sent mail stays history — the log is never rewritten.`,
      })
      setEditTag(null)
      load()
    } catch (e) {
      toast({ title: 'Could not save the draft', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setEditSaving(false)
    }
  }

  // A row into the read view's shape (same mapping the exec read-out uses).
  function readRow(r: CampaignRow, state?: CampaignState | null) {
    const theme = r.theme || state?.theme || null
    return {
      id: r.id, toEmail: r.toEmail, subject: r.subject, body: r.body,
      status: r.status, error: r.error, theme,
      provider: 'PLATFORM', campaign: r.campaign,
      openCount: r.openCount, openedAt: r.openedAt, sentAt: r.sentAt,
      createdAt: r.createdAt,
    }
  }

  const groups = new Map<string, CampaignRow[]>()
  for (const r of rows) {
    const key = r.campaign || 'other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }
  const tags = [...new Set([...campaigns.map((c) => c.tag), ...groups.keys()])]

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-brand" /> Campaigns
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Batch outreach to your contacts, paced like a human. Build the list, review the draft, press Start. Replies come straight back to your inbox.
          </p>
        </div>
        <Button
          size="sm" className="gap-1 shrink-0"
          onClick={() => { if (!paid) { requestUpgrade('campaigns'); return } resetComposer(); setOpen(true) }}
        >
          <Plus className="h-3.5 w-3.5" /> Begin campaign
        </Button>
      </div>

      {!paid ? (
        <div className="rounded-lg border border-brand/30 bg-brand/5 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm min-w-0">
            <p className="font-medium">Campaigns run on the paid plans</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Batch email your own contacts, paced like a human, with your business name on every message and read receipts on every send. Upgrade and Begin campaign opens straight away.
            </p>
          </div>
          <Button size="sm" variant="outline" className="border-brand/50 shrink-0" onClick={() => requestUpgrade('campaigns')}>
            <Sparkles className="h-3.5 w-3.5 mr-1 text-brand" /> See the plans
          </Button>
        </div>
      ) : !loaded ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-12 rounded-md bg-white/5 animate-pulse" />)}</div>
      ) : tags.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No campaigns yet. Press <span className="font-medium">Begin campaign</span>, pick your contacts and write the letter — nothing sends until you press Start.
        </p>
      ) : (
        tags.map((key) => {
          const cRows = groups.get(key) || []
          const info = campaigns.find((c) => c.tag === key)
          const state = info?.state || null
          const sum = info?.summary || {
            queued: cRows.filter((r) => r.status === 'QUEUED').length,
            sent: cRows.filter((r) => r.status === 'SENT').length,
            failed: cRows.filter((r) => r.status === 'FAILED').length,
            bounced: cRows.filter((r) => r.status === 'BOUNCED').length,
            skipped: cRows.filter((r) => r.status === 'SKIPPED').length,
            opened: cRows.filter((r) => r.openedAt).length,
            total: cRows.length,
          }
          const done = sum.sent + sum.failed + sum.bounced + sum.skipped
          const progress = sum.total ? Math.round((done / sum.total) * 100) : 0
          const rate = sum.total ? Math.round((sum.opened / sum.total) * 100) : 0
          const isOpen = expanded === key
          const statusChip = !state ? null
            : state.status === 'ACTIVE' ? <Badge className="bg-emerald-500/15 text-emerald-600 border-0 text-[10px] gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />sending</Badge>
            : state.status === 'PAUSED' ? <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-500">paused</Badge>
            : state.status === 'DONE' ? <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">done</Badge>
            : <Badge variant="outline" className="text-[10px] text-muted-foreground">cancelled</Badge>
          return (
            <div key={key} className="rounded-lg border overflow-hidden">
              <button onClick={() => setExpanded(isOpen ? null : key)} className="w-full text-left p-3 hover:bg-muted/40">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium flex items-center gap-2 min-w-0">
                    <span className="truncate">{campaignLabel(key)}</span>
                    {statusChip}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                    {sum.queued > 0 && `${sum.queued} queued · `}
                    {sum.sent} sent · {sum.opened} opened{sum.failed ? ` · ${sum.failed} failed` : ''}{sum.bounced ? ` · ${sum.bounced} bounced` : ''}
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full ${state?.status === 'DONE' || !state ? 'bg-emerald-500' : 'bg-brand'}`}
                    style={{ width: `${Math.max(progress, sum.opened ? rate : progress)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground truncate">
                  {sum.queued > 0 && state
                    ? `${state.perHour} per hour · from ${state.from || 'your profile'} · clears in ${finishEstimate(sum.queued, state.perHour)} · ${rate}% read so far`
                    : `${rate}% opened · green bar grows as they read`}
                </p>
              </button>
              {isOpen && (
                <>
                  {state && sum.queued > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-t flex-wrap">
                      {state.status !== 'ACTIVE' && (
                        <Button size="sm" className="h-7 text-xs gap-1" disabled={actingTag === key} onClick={() => control(key, 'start')}>
                          {actingTag === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          Start sending
                        </Button>
                      )}
                      {state.status === 'ACTIVE' && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={actingTag === key} onClick={() => control(key, 'pause')}>
                          {actingTag === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                          Pause
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openEdit(key)}>
                        <Pencil className="h-3 w-3" /> Edit draft
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-rose-500 border-rose-500/40 hover:bg-rose-500/10" disabled={actingTag === key} onClick={() => control(key, 'cancel')}>
                        {actingTag === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                        Cancel
                      </Button>
                      <span className="text-[11px] text-muted-foreground ml-auto hidden sm:block">
                        {state.status === 'ACTIVE' ? 'Sending now. Check back any time.' : 'Nothing sends until you press Start.'}
                      </span>
                    </div>
                  )}
                  <div className="divide-y border-t max-h-80 overflow-y-auto hp-scroll">
                    {cRows.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-4 text-center">No sends recorded under this label.</p>
                    ) : cRows.map((r) => (
                      <div
                        key={r.id}
                        onClick={() => setReading(r)}
                        className="p-2.5 flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/40 transition"
                        role="button"
                        aria-label={`Read the email sent to ${r.toEmail}`}
                      >
                        <MailCheck className={`h-4 w-4 mt-0.5 shrink-0 ${r.openedAt ? 'text-emerald-500' : 'text-muted-foreground/50'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{r.lead?.company || r.toEmail}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {r.lead?.company && r.toEmail !== r.lead.company ? `${r.toEmail} · ` : ''}
                            {r.status === 'QUEUED'
                              ? 'Waiting in queue'
                              : r.status === 'SKIPPED'
                                ? `Skipped · ${r.error || 'not sent'}`
                                : r.status === 'FAILED'
                                  ? 'Send failed'
                                  : r.openedAt
                                    ? `Opened ${new Date(r.openedAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${r.openCount > 1 ? ` · ${r.openCount} times` : ''}`
                                    : `Not opened yet · sent ${new Date(r.sentAt || r.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`}
                          </p>
                        </div>
                        {r.openedAt && r.status === 'SENT' ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 border-0 text-[10px] shrink-0">read</Badge>
                        ) : r.status === 'QUEUED' ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">queued</Badge>
                        ) : r.status === 'BOUNCED' ? (
                          <Badge variant="outline" className="text-[10px] text-rose-500 border-rose-500/40 shrink-0">bounced</Badge>
                        ) : r.status === 'SKIPPED' ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">skipped</Badge>
                        ) : r.status === 'FAILED' ? (
                          <Badge variant="outline" className="text-[10px] text-rose-500 border-rose-500/40 shrink-0">failed</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] shrink-0">sent</Badge>
                        )}
                        {r.status === 'QUEUED' && r.campaign && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 px-2 shrink-0 text-rose-500 border-rose-500/40 hover:bg-rose-500/10"
                            disabled={removingRowId === r.id}
                            onClick={(ev) => { ev.stopPropagation(); removeRow(r.campaign as string, r.id) }}
                            title="Remove this email from the campaign queue"
                            aria-label={`Remove ${r.toEmail} from the campaign queue`}
                          >
                            {removingRowId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })
      )}

      {/* Begin campaign composer: audience, then message. Queues are born
          paused — nothing sends until Start is pressed on the card. The
          transport lane is the engine's business and never shows here. */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false) }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto hp-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand" /> Begin campaign</DialogTitle>
            <DialogDescription>
              {step === 'audience'
                ? 'Pick who this goes to: your pipeline contacts, or paste any list you keep.'
                : 'Write the message and set the pace. Review the draft before it queues.'}
            </DialogDescription>
          </DialogHeader>

          {step === 'audience' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your contacts" className="pl-8 h-9" />
                </div>
                <Button size="sm" variant="outline" className="h-9 text-xs shrink-0" onClick={() => setPickIds(new Set(audienceLeads.map((l) => l.id)))}>Select all</Button>
                <Button size="sm" variant="outline" className="h-9 text-xs shrink-0" onClick={() => setPickIds(new Set())}>Clear</Button>
              </div>
              <div className="rounded-lg border divide-y max-h-56 overflow-y-auto hp-scroll">
                {audienceLeads.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-4 text-center">No unlocked contacts with an email yet. Reveal contacts in Leads, or paste addresses below.</p>
                ) : audienceLeads.map((l) => (
                  <label key={l.id} className="flex items-center gap-2.5 p-2.5 cursor-pointer hover:bg-muted/40">
                    <input
                      type="checkbox"
                      className="accent-[var(--brand)] h-4 w-4"
                      checked={pickIds.has(l.id)}
                      onChange={() => togglePick(l.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium truncate">{l.company}</span>
                      <span className="block text-[11px] text-muted-foreground truncate">{l.email}{l.contactName ? ` · ${l.contactName}` : ''}</span>
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">{l.stage}</Badge>
                  </label>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uc-paste">Or paste addresses</Label>
                <Textarea
                  id="uc-paste"
                  rows={3}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={'one@business.co.za\ntwo@other.co.za'}
                />
                <p className="text-[11px] text-muted-foreground">One per line or separated by commas. Bounced, complained and unsubscribed addresses are refused automatically.</p>
              </div>
              <Button className="w-full" disabled={pickCount === 0} onClick={() => setStep('message')}>
                Continue with {pickCount} recipient{pickCount === 1 ? '' : 's'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="uc-name">Campaign name</Label>
                  <Input id="uc-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="avenzara-launch" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="uc-pace">Pace</Label>
                  <Select value={cPerHour} onValueChange={(v) => setCPerHour(v)}>
                    <SelectTrigger id="uc-pace"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 per hour · gentle</SelectItem>
                      <SelectItem value="45">45 per hour · steady</SelectItem>
                      <SelectItem value="60">60 per hour · brisk</SelectItem>
                      <SelectItem value="90">90 per hour · fast</SelectItem>
                      <SelectItem value="120">120 per hour · ceiling</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uc-from">Sending from</Label>
                <select
                  id="uc-from"
                  value={cFrom}
                  onChange={(e) => setCFrom(e.target.value)}
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                >
                  {(profiles.length ? profiles : [{ id: '', name: 'My business', from: '' }]).map((p) => (
                    <option key={p.id || 'account'} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {pickedProfile?.from && (
                  <p className="text-[11px] text-muted-foreground">Their inbox shows: <span className="font-medium">{pickedProfile.from}</span>. Replies come back to your account email.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uc-subject">Subject</Label>
                <Input id="uc-subject" value={cSubject} onChange={(e) => setCSubject(e.target.value)} placeholder="Your next client is one search away" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uc-body">Message</Label>
                <Textarea id="uc-body" rows={8} value={cBody} onChange={(e) => setCBody(e.target.value)} placeholder="Write it the way you speak. Short lines win." />
                <p className="text-[11px] text-muted-foreground">Type {'{name}'} in the greeting and {'{email}'} where their address goes. Every email is filled per person before it sends.</p>
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-[var(--brand)] h-3.5 w-3.5"
                    checked={personalize}
                    onChange={(e) => setPersonalize(e.target.checked)}
                  />
                  Fill {'{name}'} and {'{email}'} per person
                </label>
                <p className="text-[11px] text-muted-foreground">A line starting with &quot;See it in motion: &lt;video link&gt;&quot; renders as a big clickable video card.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><Palette className="h-3.5 w-3.5 text-brand" /> The look</Label>
                <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Campaign look">
                  {LOOKS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setCTheme(l.id)}
                      title={l.blurb}
                      aria-pressed={cTheme === l.id}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${cTheme === l.id ? 'border-brand bg-brand/10 text-foreground' : 'border-border text-muted-foreground hover:border-brand/40 hover:text-foreground'}`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10" style={{ background: l.dot }} />
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* The member's own brand: their name (and logo) replaces the BH
                  mark on this campaign's emails. Empty = the platform chrome. */}
              <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                <Label htmlFor="uc-brand" className="flex items-center gap-1.5"><Palette className="h-3.5 w-3.5 text-brand" /> Your brand on the email <span className="text-[10px] font-normal text-muted-foreground">(optional)</span></Label>
                <Input
                  id="uc-brand" value={cBrandName} maxLength={48}
                  onChange={(e) => setCBrandName(e.target.value)}
                  placeholder="e.g. Mo Lawncare — shows instead of BH HustlePortal"
                />
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {brandLogoUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={brandLogoUrl} alt="Your logo" className="h-8 max-w-[140px] rounded border bg-white object-contain px-1" />
                      <Button size="sm" variant="ghost" type="button" className="h-7 text-xs text-muted-foreground" disabled={logoBusy} onClick={removeBrandLogo}>Remove logo</Button>
                    </>
                  ) : (
                    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      <input
                        type="file" accept="image/png,image/jpeg" className="hidden" disabled={logoBusy}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBrandLogo(f); e.currentTarget.value = '' }}
                      />
                      {logoBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      Upload a logo (PNG/JPG, under 300 KB)
                    </label>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {brandLogoUrl ? 'Logo rides the banner.' : cBrandName.trim() ? `No logo — the banner shows “${cBrandName.trim().slice(0, 2).toUpperCase()}” initials.` : 'No brand set — emails ride the HustlePortal look.'}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-xs">
                <p className="font-medium text-[13px]">Before it queues</p>
                <p className="text-muted-foreground">
                  {pickCount} recipients · {cPerHour} per hour · clears in {finishEstimate(pickCount, Number(cPerHour))}
                  {pickedProfile?.from ? ` · from ${pickedProfile.name}` : ''}
                </p>
                <p className="text-muted-foreground">Sends inside your plan&apos;s bundle ride free; beyond it, airtime covers the rest. Every email carries a one tap unsubscribe link and open tracking.</p>
                <p className="text-foreground/80 font-medium">Nothing sends yet. The queue waits paused — you press Start on the card once the draft reads right.</p>
              </div>
              {cSubject.trim() && cBody.trim() && (
                <div className="rounded-lg border p-3">
                  <p className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1.5"><Eye className="h-3 w-3" /> Draft preview{personalize && personalizable ? ' · names filled with a sample contact' : ''}</p>
                  <p className="text-[13px] font-medium">{personalize ? sampleFill(cSubject) : cSubject}</p>
                  <p className="text-xs whitespace-pre-wrap mt-1 max-h-36 overflow-y-auto hp-scroll">{personalize ? sampleFill(cBody) : cBody}</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep('audience')} disabled={creating}>Back</Button>
                <Button className="flex-1" onClick={createQueue} disabled={creating || !cSubject.trim() || cBody.trim().length < 20}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Megaphone className="h-4 w-4 mr-1" />}
                  Build queue
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit draft: rewrite the letter on every still-queued email; sent mail
          is history and stays untouched. */}
      <Dialog open={!!editTag} onOpenChange={(o) => { if (!o) setEditTag(null) }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto hp-scroll">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Pencil className="h-4 w-4 text-brand" /> Edit draft — {editTag ? campaignLabel(editTag) : ''}
            </DialogTitle>
            <DialogDescription>
              Rewrites every email still in the queue. Sent mail stays history — the log is never rewritten.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="uc-ed-subject">Subject</Label>
              <Input id="uc-ed-subject" value={editDraft.subject} onChange={(e) => setEditDraft({ ...editDraft, subject: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uc-ed-body">Message</Label>
              <Textarea id="uc-ed-body" rows={10} value={editDraft.body} onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">
                Type {'{name}'} in the greeting and it fills per person where the contact has a name. A line starting with &quot;See it in motion: &lt;video link&gt;&quot; renders as a big clickable video card.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="uc-ed-perhour">Sends per hour</Label>
                <Input
                  id="uc-ed-perhour" type="number" min={1} max={120} value={editDraft.perHour}
                  onChange={(e) => setEditDraft({ ...editDraft, perHour: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Look</Label>
                <Select value={editDraft.theme} onValueChange={(v) => setEditDraft({ ...editDraft, theme: v })}>
                  <SelectTrigger><SelectValue placeholder="Engine default" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="engine">Engine default (Gold Rush)</SelectItem>
                    {LOOKS.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Re-skin the chrome too: the queue can wear the member's brand
                instead of the BH mark. Clear the field to go back to BH. */}
            <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
              <Label htmlFor="uc-ed-brand" className="flex items-center gap-1.5"><Palette className="h-3.5 w-3.5 text-brand" /> Your brand on the email <span className="text-[10px] font-normal text-muted-foreground">(optional)</span></Label>
              <Input
                id="uc-ed-brand" value={editDraft.brandName} maxLength={48}
                onChange={(e) => setEditDraft({ ...editDraft, brandName: e.target.value })}
                placeholder="e.g. Mo Lawncare — shows instead of BH HustlePortal"
              />
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {brandLogoUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={brandLogoUrl} alt="Your logo" className="h-8 max-w-[140px] rounded border bg-white object-contain px-1" />
                    <Button size="sm" variant="ghost" type="button" className="h-7 text-xs text-muted-foreground" disabled={logoBusy} onClick={removeBrandLogo}>Remove logo</Button>
                  </>
                ) : (
                  <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                    <input
                      type="file" accept="image/png,image/jpeg" className="hidden" disabled={logoBusy}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBrandLogo(f); e.currentTarget.value = '' }}
                    />
                    {logoBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Upload a logo (PNG/JPG, under 300 KB)
                  </label>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {editDraft.brandName.trim() ? (brandLogoUrl ? 'Applies to every email still queued.' : `No logo — the banner shows “${editDraft.brandName.trim().slice(0, 2).toUpperCase()}” initials.`) : 'Empty = the HustlePortal chrome, as always.'}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditTag(null)} disabled={editSaving}>Close</Button>
              <Button className="flex-1" onClick={saveEdit} disabled={editSaving || !editDraft.subject.trim() || editDraft.body.trim().length < 20}>
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Pencil className="h-4 w-4 mr-1" />}
                Save &amp; rewrite queue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Read view: the whole email exactly as it went out. */}
      <EmailPreviewDialog row={readingRow} onOpenChange={(o) => { if (!o) setReading(null) }} />
    </div>
  )
}
