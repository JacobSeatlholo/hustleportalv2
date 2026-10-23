'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api, type EmailLogRow, type Lead, type CampaignRow, type CampaignInfo } from './shared'
import { useHp } from './store'
import { usePlan, requestUpgrade } from './useUpgrade'
import { useToast } from '@/hooks/use-toast'
import { requestOpenLead } from './leadBus'
import dynamic from 'next/dynamic'
import type { VideoAttach } from './video/VideoStudioDialog'

// The Video Studio (Remotion Player + web renderer) is browser only machinery,
// so it loads on demand in the client and never touches server rendering.
const VideoStudioDialog = dynamic(() => import('./video/VideoStudioDialog'), { ssr: false })
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Mail, Send, Sparkles, Trash2, Inbox, ShieldCheck, X, Megaphone, MailCheck, CalendarPlus, ChevronDown, ChevronUp, User, Play, Pause, Ban, Plus, Search, Clapperboard, Film } from 'lucide-react'

const GOALS = [
  'Introduce my business and book a call',
  'Follow up on a quote I sent',
  'Re-engage a cold prospect',
  'Pitch a specific offering',
  '__custom__', // “Write my own…”, free-text goal, e.g. “Welcome email for my team”
]
const CUSTOM_GOAL = '__custom__'

interface MailStatus {
  platformConfigured: boolean
  fromAddress: string
  sendingAs?: string
  sendingDomain: string
  domainStatus: 'verified' | 'pending' | 'not_started' | 'failed' | 'unknown'
  domains: { name: string; status: string }[]
  gmailConfigured: boolean
}

export default function MailView() {
  const { activeProjectId, bumpRefresh, setView, session } = useHp()
  const { toast } = useToast()
  const { paid } = usePlan()
  const [emails, setEmails] = useState<EmailLogRow[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [videoAttach, setVideoAttach] = useState<VideoAttach | null>(null)
  const [mailStatus, setMailStatus] = useState<MailStatus | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  // compose state
  const [leadId, setLeadId] = useState('')
  const [to, setTo] = useState('')
  const [goal, setGoal] = useState(GOALS[0])
  const [customGoal, setCustomGoal] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)

  // Campaigns (exec): batch queues with read receipts, build the audience,
  // review the draft, press Start, and the engine paces the sends like a human.
  const isAdmin = session?.user?.role === 'ADMIN'
  const [campaignRows, setCampaignRows] = useState<CampaignRow[] | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [taskRow, setTaskRow] = useState<CampaignRow | null>(null)
  const [task, setTask] = useState({ title: '', dueDate: '', dueTime: '', priority: 'MEDIUM', notes: '' })
  const [taskSaving, setTaskSaving] = useState(false)

  // queue composer state
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerStep, setComposerStep] = useState<'audience' | 'message'>('audience')
  const [audienceSearch, setAudienceSearch] = useState('')
  const [pickIds, setPickIds] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const [cName, setCName] = useState('')
  const [cFrom, setCFrom] = useState('BlackBiz <blackbiz@hustleportal.online>')
  const [cSubject, setCSubject] = useState('')
  const [cBody, setCBody] = useState('')
  const [cPerHour, setCPerHour] = useState('45')
  const [cProvider, setCProvider] = useState<'RESEND' | 'SES'>('RESEND')
  const [sesOk, setSesOk] = useState(false)
  const [creating, setCreating] = useState(false)
  const [actingTag, setActingTag] = useState<string | null>(null)

  const loadCampaigns = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await api<{ campaigns: CampaignInfo[]; rows: CampaignRow[]; sesConfigured?: boolean }>('/api/admin/exec/campaigns')
      setCampaignRows(res.rows || [])
      setCampaigns(res.campaigns || [])
      if (typeof res.sesConfigured === 'boolean') setSesOk(res.sesConfigured)
    } catch {
      setCampaignRows([])
      setCampaigns([])
    }
  }, [isAdmin])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])

  // While a queue is ACTIVE the open screen taps the engine every minute.
  // Closing the tab costs nothing: the cron heartbeat and the database clock
  // keep the pace, this just makes progress visible while you watch.
  const anyActive = campaigns.some((c) => c.state?.status === 'ACTIVE')
  useEffect(() => {
    if (!anyActive) return
    const t = setInterval(async () => {
      try {
        const r = await api<{ sent: number; failed: number; skipped: number }>('/api/cron/campaign-tick')
        if (r.sent || r.failed || r.skipped) loadCampaigns()
      } catch {
        // session lapse or cooldown, cron still drives the queue
      }
    }, 60_000)
    return () => clearInterval(t)
  }, [anyActive, loadCampaigns])

  function campaignLabel(c: string) {
    return c.split(/[-_]+/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ').replace(/^Blackbiz\b/, 'BlackBiz')
  }

  function openTaskPopup(r: CampaignRow) {
    setTaskRow(r)
    setTask({
      title: `Follow up with ${r.lead?.company || r.toEmail}`,
      dueDate: '', dueTime: '', priority: 'MEDIUM',
      notes: `From campaign ${campaignLabel(r.campaign || '')} · ${r.toEmail}`,
    })
  }

  async function saveTask() {
    if (!taskRow) return
    setTaskSaving(true)
    try {
      const dueIso = task.dueDate
        ? new Date(task.dueTime ? `${task.dueDate}T${task.dueTime}` : `${task.dueDate}T00:00`).toISOString()
        : null
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: task.title.trim(),
          notes: task.notes.trim() || null,
          priority: task.priority,
          dueDate: dueIso,
          isPrivate: false,
          assigneeId: session?.user.id,
          leadId: taskRow.lead?.id || undefined,
        }),
      })
      toast({ title: 'Task added', description: `Linked to ${taskRow.lead?.company || taskRow.toEmail}. It lives under Tasks.` })
      setTaskRow(null)
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Could not add task', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setTaskSaving(false)
    }
  }

  function openContact(r: CampaignRow) {
    if (!r.lead?.id) return
    requestOpenLead(r.lead.id)
    setView('leads')
  }

  // ---- queue composer ----
  const pastedEmails = paste.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  const pickCount = pickIds.size + pastedEmails.length
  const audienceLeads = leads
    .filter((l) => {
      const q = audienceSearch.trim().toLowerCase()
      if (!q) return true
      return l.company.toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q) || (l.contactName || '').toLowerCase().includes(q)
    })
    .slice(0, 300)

  function togglePick(id: string) {
    setPickIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetComposer() {
    setComposerStep('audience'); setPickIds(new Set()); setPaste(''); setAudienceSearch('')
    setCName(''); setCSubject(''); setCBody(''); setCPerHour('45')
    setCFrom('BlackBiz <blackbiz@hustleportal.online>'); setCProvider('RESEND')
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
      const res = await api<{ campaign: string; queued: number; skippedSuppressed: number; skippedDuplicate: number; invalid: string[] }>('/api/admin/exec/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          campaign: cName.trim() || cSubject.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40),
          subject: cSubject.trim(),
          body: cBody,
          from: cFrom.trim(),
          perHour: Number(cPerHour),
          provider: cProvider,
          leads: [...pickIds],
          emails: pastedEmails,
        }),
      })
      const bits = [`${res.queued} contacts queued`]
      if (res.skippedDuplicate) bits.push(`${res.skippedDuplicate} already in this campaign`)
      if (res.skippedSuppressed) bits.push(`${res.skippedSuppressed} unsubscribed or bounced, refused`)
      if (res.invalid.length) bits.push(`${res.invalid.length} invalid address${res.invalid.length === 1 ? '' : 'es'} dropped`)
      toast({ title: 'Queue built, nothing sent yet', description: `${bits.join(' · ')}. You press Start on the card when the draft is approved.` })
      resetComposer()
      setComposerOpen(false)
      setExpanded(res.campaign)
      loadCampaigns()
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
      await api('/api/admin/exec/campaigns', { method: 'PATCH', body: JSON.stringify({ campaign: tag, action }) })
      toast({
        title: action === 'start' ? 'Campaign started' : action === 'pause' ? 'Campaign paused' : 'Campaign cancelled',
        description: action === 'start'
          ? 'The engine now paces this queue around the clock. Press pause any time.'
          : action === 'pause'
            ? 'Sends stop on the spot. Start again whenever you are ready.'
            : 'The queue is closed. Sent emails and their read receipts stay.',
      })
      loadCampaigns()
      if (action === 'start') api('/api/cron/campaign-tick').catch(() => { /* first turn, best effort */ })
    } catch (e) {
      toast({ title: 'Could not update the campaign', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setActingTag(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [mail, leadData, status] = await Promise.all([
        api<{ emails: EmailLogRow[] }>('/api/emails'),
        api<{ leads: Lead[] }>('/api/leads'),
        api<{ status: MailStatus }>('/api/emails/status').catch(() => null),
      ])
      setEmails(mail.emails)
      setLeads(leadData.leads.filter((l) => l.unlocked && l.email))
      if (status?.status) setMailStatus(status.status)
    } catch (e) {
      toast({ title: 'Could not load mail', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  async function draftWithGemini() {
    // A typed goal wins, the presets are just the fast path.
    const effectiveGoal = goal === CUSTOM_GOAL ? customGoal.trim() : goal
    if (goal === CUSTOM_GOAL && !effectiveGoal) {
      toast({ title: 'Write your goal first', description: 'One line is enough, e.g. "Welcome email for my team".', variant: 'destructive' })
      return
    }
    setDrafting(true)
    try {
      const res = await api<{ draft: { id: string; subject: string; body: string; toEmail: string } }>(
        '/api/ai/generate-email',
        {
          method: 'POST',
          body: JSON.stringify({ leadId: leadId || undefined, to, goal: effectiveGoal, projectId: activeProjectId }),
        },
      )
      setSubject(res.draft.subject)
      setBody(res.draft.body)
      setDraftId(res.draft.id)
      if (res.draft.toEmail && res.draft.toEmail.includes('@') && !to) setTo(res.draft.toEmail)
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Gemini draft failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setDrafting(false)
    }
  }

  async function send() {
    if (!to.includes('@')) {
      toast({ title: 'Add a recipient', description: 'Enter a valid email address.', variant: 'destructive' })
      return
    }
    setSending(true)
    setSendError(null)
    try {
      const res = await api<{ email: EmailLogRow; notice?: string | null; freeRemaining?: number | null }>('/api/emails', {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          to,
          subject,
          body,
          projectId: activeProjectId,
          attachments: videoAttach ? [{ filename: videoAttach.filename, content: videoAttach.base64 }] : undefined,
        }),
      })
      toast({
        title: 'Sent ✓',
        description:
          res.notice ||
          (typeof res.freeRemaining === 'number' && !paid
            ? `${res.freeRemaining} free email${res.freeRemaining === 1 ? '' : 's'} left this plan. Operator sends unlimited.`
            : `${subject} → ${to}`),
      })
      setSubject(''); setBody(''); setTo(''); setDraftId(null); setVideoAttach(null)
      load()
    } catch (e) {
      // Calm inline card instead of a toast wall, details stay under the composer
      setSendError(e instanceof Error ? e.message : 'Send failed')
      load()
    } finally {
      setSending(false)
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/emails?id=${id}`, { method: 'DELETE' })
      setEmails((rows) => rows.filter((r) => r.id !== id))
    } catch {
      // non-fatal
    }
  }

  // One calm line: what will happen when I hit Send?
  const sentCount = emails.filter((e) => e.status === 'SENT').length
  const engineReady = mailStatus ? mailStatus.platformConfigured && mailStatus.domainStatus === 'verified' : null
  const statusDot = engineReady === true ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
  const statusText = (() => {
    if (!mailStatus) return 'Sends via the HustlePortal mail engine, replies route back to your inbox.'
    if (mailStatus.gmailConfigured && engineReady) {
      return `Goes out from your Gmail, the HustlePortal engine (${mailStatus.fromAddress}) backs it up automatically.`
    }
    if (mailStatus.gmailConfigured && !engineReady) {
      return 'Goes out from your Gmail when it passes the connection test, meanwhile the HustlePortal engine is finishing setup and may only reach your own inbox.'
    }
    if (!mailStatus.platformConfigured) {
      return 'HustlePortal mail engine is warming up, connect Gmail under Integrations to send in the meantime.'
    }
    if (engineReady) {
      return mailStatus.sendingAs
        ? `Email ready, goes out from ${mailStatus.sendingAs} (your business's own address). Replies route to your inbox.`
        : `Email ready, goes out from ${mailStatus.fromAddress}. Replies route to your inbox.`
    }
    return `${mailStatus.sendingDomain} is verifying in Resend, your sends work to your own inbox meanwhile and open up to everyone the moment verification completes. Nothing for you to configure.`
  })()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl">Mail</h2>
        <p className="text-sm text-muted-foreground">AI drafts grounded in your business profile, sending works out of the box. Connect your Gmail if you want it sent from your own address.</p>
      </div>

      {/* Campaigns (exec): build a queue, pace it, watch read receipts land */}
      {isAdmin && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-sm flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-brand" /> Campaigns
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Batch sends paced like a human. Build the audience, review the draft, press Start.</p>
            </div>
            <Button size="sm" className="gap-1 shrink-0" onClick={() => { resetComposer(); setComposerOpen(true) }}>
              <Plus className="h-3.5 w-3.5" /> New campaign
            </Button>
          </div>
          {campaignRows === null ? (
            <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-12 rounded-md bg-white/5 animate-pulse" />)}</div>
          ) : (() => {
            const groups = new Map<string, CampaignRow[]>()
            for (const r of campaignRows) {
              const key = r.campaign || 'other'
              if (!groups.has(key)) groups.set(key, [])
              groups.get(key)!.push(r)
            }
            const tags = [...new Set([...campaigns.map((c) => c.tag), ...groups.keys()])]
            if (tags.length === 0) {
              return <p className="text-xs text-muted-foreground py-4 text-center">No campaigns yet. Press New campaign and build your first queue.</p>
            }
            return tags.map((key) => {
              const rows = groups.get(key) || []
              const info = campaigns.find((c) => c.tag === key)
              const state = info?.state || null
              const sum = info?.summary || {
                queued: rows.filter((r) => r.status === 'QUEUED').length,
                sent: rows.filter((r) => r.status === 'SENT').length,
                failed: rows.filter((r) => r.status === 'FAILED').length,
                bounced: rows.filter((r) => r.status === 'BOUNCED').length,
                skipped: rows.filter((r) => r.status === 'SKIPPED').length,
                opened: rows.filter((r) => r.openedAt).length,
                total: rows.length,
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
                        {state?.provider === 'SES' && <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-500 shrink-0">SES lane</Badge>}
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
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {sum.queued > 0 && state
                        ? `${state.perHour} per hour · queue clears in ${finishEstimate(sum.queued, state.perHour)} · ${rate}% read so far`
                        : `${rate}% opened · green bar grows as they read`}
                    </p>
                  </button>
                  {isOpen && (
                    <>
                      {state && sum.queued > 0 && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-t">
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
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-rose-500 border-rose-500/40 hover:bg-rose-500/10" disabled={actingTag === key} onClick={() => control(key, 'cancel')}>
                            {actingTag === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                            Cancel
                          </Button>
                          <span className="text-[11px] text-muted-foreground ml-auto hidden sm:block">
                            {state.status === 'ACTIVE' ? 'Engine is moving. Check back or keep this page open.' : 'Draft gate: nothing sends until you press Start.'}
                          </span>
                        </div>
                      )}
                      <div className="divide-y border-t max-h-80 overflow-y-auto hp-scroll">
                        {rows.length === 0 ? (
                          <p className="text-xs text-muted-foreground p-4 text-center">No sends recorded under this label.</p>
                        ) : rows.map((r) => (
                          <div key={r.id} className="p-2.5 flex items-start gap-2 text-sm">
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
                            {r.lead?.id && r.status !== 'QUEUED' && r.status !== 'SKIPPED' && (
                              <div className="flex items-center gap-1 shrink-0">
                                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openContact(r)} title="Open this contact in Leads" aria-label="Open contact">
                                  <User className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs" onClick={() => openTaskPopup(r)}>
                                  <CalendarPlus className="h-3.5 w-3.5 text-brand" /> Task
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* Free plan email meter, honest count, calm tone, one tap to the plans.
          The server enforces the ceiling; this makes it visible before it bites. */}
      {!paid && (
        <div className="rounded-lg border border-brand/30 bg-brand/5 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">
              {Math.max(0, 6 - sentCount)} of 6 free emails left
            </p>
            <p className="text-xs text-muted-foreground">Operator sends unlimited, with your business name on every message.</p>
          </div>
          <Button size="sm" variant="outline" className="border-brand/50" onClick={() => requestUpgrade('email')}>
            <Sparkles className="h-3.5 w-3.5 mr-1 text-brand" /> See Operator
          </Button>
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-4">
        {/* Compose */}
        <div className="lg:col-span-3 rounded-lg border bg-card p-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-lead">Personalise from a lead (optional)</Label>
              <select
                id="m-lead"
                value={leadId}
                onChange={(e) => {
                  setLeadId(e.target.value)
                  const l = leads.find((x) => x.id === e.target.value)
                  if (l?.email) setTo(l.email)
                }}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">No lead selected</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>{l.company}{l.contactName ? ` · ${l.contactName}` : ''}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-goal">Goal</Label>
              <select
                id="m-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                {GOALS.map((g) => (
                  <option key={g} value={g}>{g === CUSTOM_GOAL ? '✍ Write my own goal…' : g}</option>
                ))}
              </select>
              {goal === CUSTOM_GOAL && (
                <Input
                  id="m-goal-custom"
                  value={customGoal}
                  onChange={(e) => setCustomGoal(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && draftWithGemini()}
                  placeholder="e.g. Welcome email for my team"
                  className="mt-2"
                />
              )}
              {goal === CUSTOM_GOAL && (
                <p className="text-[11px] text-muted-foreground">Any goal works, the AI drafts around it. Presets stay one click away.</p>
              )}
            </div>
          </div>
          <Button onClick={draftWithGemini} disabled={drafting} className="w-full sm:w-fit">
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Draft with Gemini
          </Button>

          <div className="border-t pt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-to">To</Label>
              <Input id="m-to" type="email" placeholder="prospect@business.co.za" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-subject">Subject</Label>
              <Input id="m-subject" placeholder="Quick one about your marketing" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-body">Message</Label>
              <Textarea id="m-body" rows={10} placeholder="Write it yourself, or let Gemini draft it from your business profile…" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setVideoOpen(true)} type="button">
                <Clapperboard className="h-4 w-4 mr-1" /> Create a pitch video
              </Button>
              {videoAttach && (
                <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                  <Film className="h-3.5 w-3.5 text-brand" />
                  {videoAttach.filename} · {(videoAttach.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                  <button onClick={() => setVideoAttach(null)} aria-label="Remove video" className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </div>
            {session?.user && (
              <VideoStudioDialog
                open={videoOpen}
                onOpenChange={setVideoOpen}
                onAttach={setVideoAttach}
                defaults={{
                  businessName: session.user.businessName || session.user.name || '',
                  city: session.user.city || '',
                  phone: session.user.phone || '',
                  industry: session.user.industry || '',
                  videoTheme: session.user.videoTheme,
                }}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
                <span>{statusText}</span>
              </p>
              <Button onClick={send} disabled={sending || !subject || !body}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </Button>
            </div>
            {sendError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-rose-400">Send failed, here&apos;s why and the fix</p>
                  <button onClick={() => setSendError(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-xs text-rose-300/90 whitespace-pre-line max-h-32 overflow-y-auto hp-scroll">{sendError}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setView('integrations')}>
                    <ShieldCheck className="h-3.5 w-3.5" /> Fix in Integrations
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={send} disabled={sending}>
                    Try again
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Log */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-4">
          <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
            <Inbox className="h-4 w-4 text-brand" /> Email log
          </h3>
          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-md bg-white/5 animate-pulse" />)}</div>
          ) : emails.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No emails yet, draft one and it lands here.</p>
          ) : (
            <div className="space-y-2 max-h-[32rem] overflow-y-auto hp-scroll">
              {emails.map((e) => (
                <div key={e.id} className="group rounded-lg border p-2.5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{e.subject}</p>
                      <p className="truncate text-xs text-muted-foreground">to {e.toEmail}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant="outline"
                        className={
                          e.status === 'SENT' ? 'border-emerald-500/40 text-emerald-500'
                          : e.status === 'FAILED' ? 'border-rose-500/40 text-rose-500'
                          : 'border-yellow-500/40 text-yellow-500'
                        }
                      >
                        {e.status}
                      </Badge>
                      <button onClick={() => remove(e.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-400 transition" aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {e.status === 'FAILED' && e.error ? (
                    <p className="mt-1 text-[11px] text-rose-400 line-clamp-2">{e.error}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-brand/20 bg-brand/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Mail className="h-4 w-4 text-brand shrink-0 mt-0.5" />
        <span>
          Sending is included, hit Send and HustlePortal delivers, with replies routed back to your account email.
          Prefer your own address on the label? Connect Gmail in Integrations (optional, takes about a minute).
        </span>
      </div>

      {/* quick follow up task from a campaign row */}
      <Dialog open={Boolean(taskRow)} onOpenChange={(o) => !o && setTaskRow(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Follow up task</DialogTitle>
            <DialogDescription>
              {taskRow ? `Linked to ${taskRow.lead?.company || taskRow.toEmail} from ${campaignLabel(taskRow.campaign || '')}.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Task</Label>
              <Input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder="Follow up with…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Time</Label>
                <Input type="time" value={task.dueTime} onChange={(e) => setTask({ ...task, dueTime: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={task.priority} onValueChange={(v) => setTask({ ...task, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={task.notes} onChange={(e) => setTask({ ...task, notes: e.target.value })} />
            </div>
            <Button onClick={saveTask} disabled={taskSaving || !task.title.trim()} className="w-full">
              {taskSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CalendarPlus className="h-4 w-4 mr-1" />}
              Add task
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New campaign composer, audience, message, review. Queues are born
          paused: nothing sends until Start is pressed on the campaign card. */}
      <Dialog open={composerOpen} onOpenChange={(o) => { if (!o) setComposerOpen(false) }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto hp-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand" /> New campaign</DialogTitle>
            <DialogDescription>
              {composerStep === 'audience'
                ? 'Pick the audience. Contacts come from your pipeline, or paste any list.'
                : 'Write the message and set the pace. Review the draft before it queues.'}
            </DialogDescription>
          </DialogHeader>

          {composerStep === 'audience' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={audienceSearch} onChange={(e) => setAudienceSearch(e.target.value)} placeholder="Search your contacts" className="pl-8 h-9" />
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
                <Label htmlFor="c-paste">Or paste addresses</Label>
                <Textarea
                  id="c-paste"
                  rows={3}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={'one@business.co.za\ntwo@other.co.za'}
                />
                <p className="text-[11px] text-muted-foreground">One per line or separated by commas. Bounced, complained and unsubscribed addresses are refused automatically.</p>
              </div>
              <Button className="w-full" disabled={pickCount === 0} onClick={() => setComposerStep('message')}>
                Continue with {pickCount} recipient{pickCount === 1 ? '' : 's'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="c-name">Campaign name</Label>
                  <Input id="c-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="blackbiz-intro" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-pace">Pace</Label>
                  <Select value={cPerHour} onValueChange={(v) => setCPerHour(v)}>
                    <SelectTrigger id="c-pace"><SelectValue /></SelectTrigger>
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
                <Label htmlFor="c-from">From</Label>
                <Input id="c-from" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Lane</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCProvider('RESEND')}
                    className={`rounded-lg border p-2.5 text-left transition ${cProvider === 'RESEND' ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'hover:bg-muted/40'}`}
                  >
                    <span className="block text-[12px] font-medium">Free lane</span>
                    <span className="block text-[10px] text-muted-foreground">Resend · about 100 a day · $0</span>
                  </button>
                  <button
                    type="button"
                    disabled={!sesOk}
                    onClick={() => setCProvider('SES')}
                    className={`rounded-lg border p-2.5 text-left transition disabled:opacity-50 ${cProvider === 'SES' ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'hover:bg-muted/40'}`}
                  >
                    <span className="block text-[12px] font-medium">SES lane</span>
                    <span className="block text-[10px] text-muted-foreground">{sesOk ? 'Amazon · built for volume · pays per send' : 'Paste the SES keys in Vercel to unlock'}</span>
                  </button>
                </div>
                {cProvider === 'SES' && (
                  <p className="text-[10px] text-amber-500">SES lane bills per send. Keep the pace gentle while the domain warms up.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-subject">Subject</Label>
                <Input id="c-subject" value={cSubject} onChange={(e) => setCSubject(e.target.value)} placeholder="Your next client is one search away" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-body">Message</Label>
                <Textarea id="c-body" rows={8} value={cBody} onChange={(e) => setCBody(e.target.value)} placeholder="Write it the way you speak. Short lines win." />
                <p className="text-[11px] text-muted-foreground">A line starting with &quot;See it in motion: &lt;video link&gt;&quot; renders as a big clickable video card.</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-xs">
                <p className="font-medium text-[13px]">Before it queues</p>
                <p className="text-muted-foreground">{pickCount} recipients · {cPerHour} per hour · {cProvider === 'SES' ? 'SES lane' : 'free lane'} · finishes in {finishEstimate(pickCount, Number(cPerHour))}</p>
                <p className="text-muted-foreground">Every email carries a one tap unsubscribe link and open tracking. Bounces and spam complaints remove the address automatically.</p>
                <p className="text-foreground/80 font-medium">Nothing sends yet. The queue waits paused, you press Start on the card once the draft is approved.</p>
              </div>
              {cSubject.trim() && cBody.trim() && (
                <div className="rounded-lg border p-3">
                  <p className="text-[11px] text-muted-foreground mb-1">Draft preview</p>
                  <p className="text-[13px] font-medium">{cSubject}</p>
                  <p className="text-xs whitespace-pre-wrap mt-1 max-h-36 overflow-y-auto hp-scroll">{cBody}</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setComposerStep('audience')} disabled={creating}>Back</Button>
                <Button className="flex-1" onClick={createQueue} disabled={creating || !cSubject.trim() || cBody.trim().length < 20}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Megaphone className="h-4 w-4 mr-1" />}
                  Build queue
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
