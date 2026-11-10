'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api, rands, type EmailLogRow, type Lead, type CampaignRow, type CampaignInfo, type CampaignState } from './shared'
import { EmailPreviewDialog } from './EmailPreviewDialog'
import UserCampaigns, { type SenderProfile } from './UserCampaigns'
import type { MailThemeId } from '@/lib/mailthemes'
import { useHp } from './store'
import { WinBackCard } from './AdminView'
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
import { Loader2, Mail, Send, Sparkles, Trash2, Inbox, ShieldCheck, X, Megaphone, MailCheck, CalendarPlus, ChevronDown, ChevronUp, User, Play, Pause, Ban, Plus, Search, Clapperboard, Film, Coins, Paperclip, Eye, Palette, Pencil, ShoppingCart } from 'lucide-react'

// Abandoned checkouts readout (exec): Yoco checkouts that opened and never
// finished — the follow-up list. amountRands/creditRands come from the TopUp row.
type AbandonedCheckouts = {
  campaignTag: string
  inflight: number
  paidLast30d: number
  alreadyQueuedCount: number
  abandoned: {
    id: string; email: string; name: string; amountRands: number; creditRands: number
    packageId: string; reference: string; ageHours: number; alreadyQueued: boolean
  }[]
}

// The looks a sender can give their email, in the composer's "Look" row.
// Plain is the honest default (text only, exactly as always); the three
// branded looks frame the sender's own words with the HustlePortal chrome.
const LOOKS: { id: MailThemeId; label: string; dot: string; blurb: string }[] = [
  { id: 'plain', label: 'Plain', dot: '#9CA3AF', blurb: 'No frame — your email goes out as clean text, exactly as you write it.' },
  { id: 'boardroom', label: 'Boardroom', dot: '#16305C', blurb: 'Navy and quiet. Quotes, follow-ups and professional correspondence.' },
  { id: 'goldrush', label: 'Gold Rush', dot: '#F5C518', blurb: 'Warm gold, the honey badger up front. Pitches and announcements that get remembered.' },
  { id: 'nightshift', label: 'Nightshift', dot: '#0B0E14', blurb: 'Dark and bold. Big offers and after-hours energy.' },
]

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
  profiles?: SenderProfile[]
}

/** The "everyone on the system" roster readout, computed by src/lib/audience.ts. */
interface SystemAudienceReadout {
  total: number
  eligible: number
  neverLoggedIn: number
  excluded: { kloofstreet: number; internal: number; suspended: number; suppressed: number; paying: number }
  sample: { name: string; email: string } | null
}

/** Live airtime quote from /api/emails/status — what the next send costs RIGHT NOW. */
interface SpendQuote {
  action: string
  priceCents: number
  mode: 'ALLOWANCE' | 'AIRTIME' | 'EMPTY'
  allowance: number
  allowanceRemaining: number
  balanceCents: number
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
  // Uploaded attachments (PDFs, scans): base64 at pick time, ride the same
  // send law as the video — sanitized and size-capped inside sendMail.
  const [fileAttaches, setFileAttaches] = useState<{ filename: string; content: string; sizeBytes: number }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mailStatus, setMailStatus] = useState<MailStatus | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  // Airtime: the price chip state, refreshed with every load + after every send.
  const [spendQuote, setSpendQuote] = useState<SpendQuote | null>(null)
  // Read view: click a row in the log, read the whole email as it went out.
  const [reading, setReading] = useState<EmailLogRow | null>(null)

  // compose state
  const [leadId, setLeadId] = useState('')
  const [to, setTo] = useState('')
  const [goal, setGoal] = useState(GOALS[0])
  const [customGoal, setCustomGoal] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)
  // The look this email arrives in (the composer's Look row). Plain sends text
  // only; a branded look rides the same words as html on whichever lane wins.
  const [theme, setTheme] = useState<MailThemeId>('plain')
  // "Sending from": the account identity ('') or a workspace this account
  // owns. The pick decides the name AND address their inbox shows, and it
  // forces the engine lane — their Gmail can never wear another business's
  // name. The roster comes back with the status call.
  const [profiles, setProfiles] = useState<SenderProfile[]>([])
  const [fromProfile, setFromProfile] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  // Campaigns (exec): batch queues with read receipts, build the audience,
  // review the draft, press Start, and the engine paces the sends like a human.
  const isAdmin = session?.user?.role === 'ADMIN'
  const [campaignRows, setCampaignRows] = useState<CampaignRow[] | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [taskRow, setTaskRow] = useState<CampaignRow | null>(null)
  const [task, setTask] = useState({ title: '', dueDate: '', dueTime: '', priority: 'MEDIUM', notes: '' })
  const [taskSaving, setTaskSaving] = useState(false)
  // One-click removal: the id of the queued row currently being pulled out of
  // its campaign, so the × button spins instead of firing twice.
  const [removingRowId, setRemovingRowId] = useState<string | null>(null)
  // Edit draft: rewrite the letter (subject, body, sender, pace, look) on every
  // still-queued row of a live queue. The sender is shown on the card itself so
  // what goes out is never a surprise again.
  const [editTag, setEditTag] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ subject: '', body: '', from: '', perHour: 45, theme: 'engine' })
  const [editSaving, setEditSaving] = useState(false)
  // Abandoned checkouts (exec): Yoco checkouts that opened and never finished.
  const [abandoned, setAbandoned] = useState<AbandonedCheckouts | null>(null)
  const [abandonOpen, setAbandonOpen] = useState(false)
  const [abandonDraft, setAbandonDraft] = useState({ subject: '', body: '' })
  const [abandonBusy, setAbandonBusy] = useState(false)

  // queue composer state
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerStep, setComposerStep] = useState<'audience' | 'message'>('audience')
  const [audienceSearch, setAudienceSearch] = useState('')
  const [pickIds, setPickIds] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  // "Everyone on the system": the honest roster readout, fetched fresh every
  // time the composer opens. The number shown is the number that queues, one
  // law on both sides (src/lib/audience.ts).
  const [systemAud, setSystemAud] = useState<SystemAudienceReadout | null>(null)
  const [systemPick, setSystemPick] = useState(false)
  const [systemIncludePaying, setSystemIncludePaying] = useState(false)
  const [cName, setCName] = useState('')
  const [cFrom, setCFrom] = useState('BlackBiz <blackbiz@hustleportal.online>')
  const [cSubject, setCSubject] = useState('')
  const [cBody, setCBody] = useState('')
  const [cPerHour, setCPerHour] = useState('45')
  const [cProvider, setCProvider] = useState<'RESEND' | 'SES'>('RESEND')
  const [sesOk, setSesOk] = useState(false)
  // The look a new batch is born in (engine default = goldrush). Same catalogue
  // Edit draft offers, so the pick at creation and the pick later agree.
  const [cTheme, setCTheme] = useState('engine')
  // Add email (exec): queue another letter into a campaign that already ran.
  // The audience is pulled from that campaign's OWN history — who it reached,
  // sliced by who opened — so the kloofstreet crew never needs pasting again
  // and the blast-exclusion law never blocks the people who already know the
  // sender. Counts come from the server, the queue recomputes them anyway.
  const [composerMode, setComposerMode] = useState<'new' | 'add'>('new')
  const [addSource, setAddSource] = useState('')
  const [sourcePick, setSourcePick] = useState<'opened' | 'unopened' | 'all'>('opened')
  const [sourceAud, setSourceAud] = useState<{ found: boolean; total: number; opened: number; unopened: number; sample: { name: string; email: string } | null } | null>(null)
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

  // Abandoned checkouts readout, refreshed with the campaigns.
  const loadAbandoned = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await api<AbandonedCheckouts>('/api/admin/exec/abandoned-checkouts')
      setAbandoned(res)
    } catch {
      setAbandoned(null)
    }
  }, [isAdmin])
  useEffect(() => { loadAbandoned() }, [loadAbandoned, loadCampaigns])

  // The roster readout rides along whenever the composer opens, so the boss
  // always stages against today's numbers, never a stale count. In add mode
  // the source campaign's own history joins it, same honesty law.
  useEffect(() => {
    if (!composerOpen) return
    let dead = false
    api<{ segments: SystemAudienceReadout }>('/api/admin/exec/campaigns/audience')
      .then((res) => { if (!dead) setSystemAud(res.segments) })
      .catch(() => { if (!dead) setSystemAud(null) })
    if (composerMode === 'add' && addSource) {
      api<{ source: { found: boolean; total: number; opened: number; unopened: number; sample: { name: string; email: string } | null } }>(`/api/admin/exec/campaigns/audience?source=${encodeURIComponent(addSource)}`)
        .then((res) => { if (!dead) setSourceAud(res.source) })
        .catch(() => { if (!dead) setSourceAud(null) })
    }
    return () => { dead = true }
  }, [composerOpen, composerMode, addSource])

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
  const systemCount = systemPick && systemAud
    ? systemAud.eligible + (systemIncludePaying ? systemAud.excluded.paying : 0)
    : 0
  const sourceCount = composerMode === 'add' && sourceAud?.found
    ? (sourcePick === 'opened' ? sourceAud.opened : sourcePick === 'unopened' ? sourceAud.unopened : sourceAud.total)
    : 0
  const pickCount = (composerMode === 'add' ? sourceCount : pickIds.size + systemCount) + pastedEmails.length
  const personalizable = /\{name\}|\{email\}/.test(cBody) || /\{name\}/.test(cSubject)
  // The sample the draft preview greets with: a real account from the very
  // list being staged, so what the boss reads is what a recipient reads.
  const samplePerson = composerMode === 'add'
    ? sourceAud?.sample || null
    : systemAud?.sample || null
  const sampleFill = (t: string) => t
    .replace(/\{name\}/g, samplePerson?.name || 'Thabo')
    .replace(/\{email\}/g, samplePerson?.email || 'you@example.co.za')
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
    setSystemPick(false); setSystemIncludePaying(false)
    setCName(''); setCSubject(''); setCBody(''); setCPerHour('45')
    setCFrom('BlackBiz <blackbiz@hustleportal.online>'); setCProvider('RESEND')
    setComposerMode('new'); setAddSource(''); setSourcePick('opened'); setSourceAud(null); setCTheme('engine')
  }

  // Add email: the composer aimed at a campaign that already ran. Sender,
  // pace, lane and look ride over from its state; the audience step becomes
  // that campaign's own history, sliced by opens. Nothing here can send —
  // the queue it builds is born paused like every other.
  function openAdd(key: string) {
    const info = campaigns.find((c) => c.tag === key)
    setComposerMode('add')
    setAddSource(key)
    setSourcePick('opened')
    setSourceAud(null)
    setCName(`${key}-followup`)
    setCFrom(info?.state?.from || 'BlackBiz <blackbiz@hustleportal.online>')
    setCPerHour(String(info?.state?.perHour || 45))
    setCProvider(info?.state?.provider === 'SES' && sesOk ? 'SES' : 'RESEND')
    setCTheme(info?.state?.theme || 'engine')
    setCSubject(''); setCBody('')
    setPickIds(new Set()); setPaste(''); setSystemPick(false); setAudienceSearch('')
    setComposerStep('audience')
    setComposerOpen(true)
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
    if (composerMode === 'add' && !cName.trim()) {
      toast({ title: 'Name the queue', description: 'It pre-fills from the campaign — keep it or make it yours.', variant: 'destructive' })
      return
    }
    if (pickCount === 0) {
      toast({ title: 'Pick an audience', description: composerMode === 'add' ? 'Choose who gets it from the campaign history, or paste addresses.' : 'Select contacts or paste addresses first.', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const res = await api<{ campaign: string; queued: number; personalized?: boolean; followUp?: boolean; reopened?: boolean; skippedSuppressed: number; skippedDuplicate: number; invalid: string[] }>('/api/admin/exec/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          campaign: cName.trim() || cSubject.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40),
          subject: cSubject.trim(),
          body: cBody,
          from: cFrom.trim(),
          perHour: Number(cPerHour),
          provider: cProvider,
          theme: cTheme === 'engine' ? undefined : cTheme,
          leads: [...pickIds],
          emails: pastedEmails,
          ...(composerMode === 'new' && systemPick ? { audience: 'system', skipPaying: !systemIncludePaying } : {}),
          ...(composerMode === 'add' ? { followUp: true, sourceCampaign: addSource, sourceFilter: sourcePick } : {}),
          personalize: personalizable || undefined,
        }),
      })
      const bits = [`${res.queued} contacts queued`]
      if (res.personalized) bits.push('each one greeted by name')
      if (res.reopened) bits.push('queue re-paused — check the draft, then press Start')
      if (res.skippedDuplicate) bits.push(`${res.skippedDuplicate} already queued there`)
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

  // Pull ONE queued email out of a campaign with a single click. The row is
  // marked SKIPPED with an honest note (never deleted), the engine never sends
  // it, and the counters resync straight after.
  async function removeRow(tag: string, rowId: string) {
    setRemovingRowId(rowId)
    try {
      await api('/api/admin/exec/campaigns', { method: 'PATCH', body: JSON.stringify({ campaign: tag, action: 'removeRow', rowId }) })
      toast({ title: 'Removed from the campaign', description: 'That email is out of the queue and will not send. The log keeps the record.' })
      loadCampaigns()
    } catch (e) {
      toast({ title: 'Could not remove it', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setRemovingRowId(null)
    }
  }

  // ---- Edit draft: the boss's handle on a queue that already exists ----
  function openEdit(tag: string) {
    const info = campaigns.find((c) => c.tag === tag)
    const queued = (campaignRows || []).find((r) => r.campaign === tag && r.status === 'QUEUED')
    setEditDraft({
      subject: queued?.subject || '',
      body: queued?.body || '',
      from: info?.state?.from || 'BlackBiz <blackbiz@hustleportal.online>',
      perHour: info?.state?.perHour || 45,
      theme: info?.state?.theme || 'engine',
    })
    setEditTag(tag)
  }

  async function saveEdit() {
    if (!editTag) return
    setEditSaving(true)
    try {
      const res = await api<{ updatedRows: number; queuedLeft: number; note?: string }>('/api/admin/exec/campaigns', {
        method: 'PATCH',
        body: JSON.stringify({
          campaign: editTag,
          action: 'editDraft',
          subject: editDraft.subject,
          body: editDraft.body,
          from: editDraft.from,
          perHour: Number(editDraft.perHour) || undefined,
          theme: editDraft.theme === 'engine' ? '' : editDraft.theme,
        }),
      })
      toast({
        title: `Draft updated · ${res.updatedRows} email${res.updatedRows === 1 ? '' : 's'} rewritten`,
        description: res.note || `${res.queuedLeft} still queued. Sent mail stays history — the log is never rewritten.`,
      })
      setEditTag(null)
      loadCampaigns()
    } catch (e) {
      toast({ title: 'Could not save the draft', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setEditSaving(false)
    }
  }

  // ---- Abandoned checkout follow-up blast ----
  const ABANDON_DEFAULT_SUBJECT = 'Your top-up is still open — nothing was charged'
  const ABANDON_DEFAULT_BODY = `Hi {name},\n\nQuick one — you started loading your HustlePortal wallet and the checkout never finished. No money left your card.\n\nTwo doors, your pick:\n\n• Finish the top-up — your credits land the moment you pay: HustlePortal Wallet (https://www.hustleportal.online)\n• Or just log in and keep working — the free tools stay open either way: HustlePortal (https://www.hustleportal.online)\n\nIf the card gave you trouble, reply to this email and a human will sort it out by hand.\n\nThe Business Hustle team`

  function openAbandon() {
    setAbandonDraft({ subject: ABANDON_DEFAULT_SUBJECT, body: ABANDON_DEFAULT_BODY })
    setAbandonOpen(true)
  }

  async function queueFollowup() {
    setAbandonBusy(true)
    try {
      const res = await api<{ campaign: string; queued: number; skippedSuppressed: number; skippedDuplicate: number }>('/api/admin/exec/abandoned-checkouts', {
        method: 'POST',
        body: JSON.stringify({ subject: abandonDraft.subject, body: abandonDraft.body }),
      })
      toast({
        title: res.queued > 0 ? `Follow-up queued · ${res.queued} abandoned checkout${res.queued === 1 ? '' : 's'}` : 'Nothing new to queue',
        description: res.queued > 0
          ? `Campaign ${res.campaign} waits PAUSED — edit the draft or press Start on the card.`
          : `${res.skippedDuplicate || 0} already queued or sent, ${res.skippedSuppressed || 0} suppressed.`,
      })
      setAbandonOpen(false)
      loadCampaigns()
      loadAbandoned()
    } catch (e) {
      toast({ title: 'Could not queue the follow-up', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setAbandonBusy(false)
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
        api<{ status: MailStatus; spend?: SpendQuote | null; profiles?: SenderProfile[] }>('/api/emails/status').catch(() => null),
      ])
      setEmails(mail.emails)
      setLeads(leadData.leads.filter((l) => l.unlocked && l.email))
      if (status?.status) setMailStatus(status.status)
      setSpendQuote(status?.spend ?? null)
      if (status?.profiles?.length) setProfiles(status.profiles)
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

  // The look preview: the exact html the engine would build, rendered in a
  // sandboxed frame — the sender checks the frame BEFORE the email exists.
  async function openPreview() {
    if (!body.trim()) return
    setPreviewing(true)
    setPreviewOpen(true)
    try {
      const r = await api<{ html: string | null }>('/api/emails/preview', {
        method: 'POST',
        // The composer previews the ENGINE lane: the quiet delivery line is
        // part of what a platform send appends, so the render carries it.
        body: JSON.stringify({ body, theme, provider: 'PLATFORM' }),
      })
      setPreviewHtml(r.html)
    } catch (e) {
      toast({ title: 'Preview failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
      setPreviewOpen(false)
    } finally {
      setPreviewing(false)
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
      const atts = [
        ...(videoAttach ? [{ filename: videoAttach.filename, content: videoAttach.base64 }] : []),
        ...fileAttaches.map((f) => ({ filename: f.filename, content: f.content })),
      ]
      const res = await api<{ email: EmailLogRow; notice?: string | null; freeRemaining?: number | null; bundleRemaining?: number | null; spend?: { chargedCents: number; balanceAfter: number } | null }>('/api/emails', {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          to,
          subject,
          body,
          theme,
          projectId: activeProjectId,
          fromProfile: fromProfile || undefined,
          attachments: atts.length ? atts : undefined,
        }),
      })
      toast({
        title: 'Sent ✓',
        description:
          (res.spend?.chargedCents
            ? `${rands(res.spend.chargedCents)} airtime spent · ${rands(res.spend.balanceAfter)} left in the wallet.`
            : res.notice) ||
          (typeof res.bundleRemaining === 'number' && paid
            ? `${res.bundleRemaining} included send${res.bundleRemaining === 1 ? '' : 's'} left this cycle.`
            : typeof res.freeRemaining === 'number' && !paid
              ? `${res.freeRemaining} free email${res.freeRemaining === 1 ? '' : 's'} left this plan. After that, airtime keeps you sending.`
              : `${subject} → ${to}`),
      })
      setSubject(''); setBody(''); setTo(''); setDraftId(null); setVideoAttach(null); setFileAttaches([]); setTheme('plain')
      load()
    } catch (e) {
      // Calm inline card instead of a toast wall, details stay under the composer
      setSendError(e instanceof Error ? e.message : 'Send failed')
      load()
    } finally {
      setSending(false)
    }
  }

  // Drafts staged for this member (a client campaign run by the team) wait
  // here as DRAFT rows. Opening one loads the composer exactly as if the
  // member wrote it: they check it, edit anything, and press Send themself.
  // Nothing auto-sends — the press of Send is the approval, the airtime law
  // and the failed-send-no-charge promise apply like every other send.
  function openDraft(e: EmailLogRow) {
    setReading(null)
    setTo(e.toEmail)
    setSubject(e.subject)
    setBody(e.body)
    setDraftId(e.id)
    setTheme((LOOKS.some((l) => l.id === e.theme) ? e.theme : 'plain') as MailThemeId)
    toast({ title: 'Draft loaded', description: 'Check it, edit anything, then press Send. It only goes out when you press.' })
  }

  // A campaign row into the read view's shape. A row with no look on record
  // rode the campaign state's pick — 'plain' stays plain, anything else falls
  // to the engine default the queue actually sent with (goldrush).
  function readRow(r: CampaignRow, state?: CampaignState | null): EmailLogRow {
    const theme = r.theme || state?.theme || null
    return {
      id: r.id, toEmail: r.toEmail, subject: r.subject, body: r.body,
      status: r.status, error: r.error, theme,
      provider: 'RESEND', campaign: r.campaign,
      openCount: r.openCount, openedAt: r.openedAt, sentAt: r.sentAt,
      createdAt: r.createdAt,
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

  // Same rails as the video: base64 at pick time, the sendMail sanitizer
  // caps the total (8 MB decoded, max 3 files) and the send stays honest.
  const MAX_ATTACH_BYTES = 8 * 1024 * 1024
  const MAX_ATTACH_FILES = 3
  async function onPickFiles(list: FileList | null) {
    if (!list || !list.length) return
    const used = fileAttaches.reduce((a, x) => a + x.sizeBytes, 0) + (videoAttach?.sizeBytes || 0)
    const slots = MAX_ATTACH_FILES - fileAttaches.length - (videoAttach ? 1 : 0)
    const picked: { filename: string; content: string; sizeBytes: number }[] = []
    let bytes = used
    for (const f of Array.from(list)) {
      if (picked.length >= slots) {
        toast({ title: 'Up to 3 attachments per email', description: 'Take one off to make room.', variant: 'destructive' })
        break
      }
      if (bytes + f.size > MAX_ATTACH_BYTES) {
        toast({ title: `${f.name} would push it over 8 MB`, description: 'Attachments ride up to 8 MB in total.', variant: 'destructive' })
        continue
      }
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result || ''))
        r.onerror = () => rej(r.error)
        r.readAsDataURL(f)
      }).catch(() => '')
      const content = dataUrl.split(',')[1] || ''
      if (!content) continue
      picked.push({ filename: f.name, content, sizeBytes: f.size })
      bytes += f.size
    }
    if (picked.length) {
      setFileAttaches((prev) => [...prev, ...picked])
      toast({ title: picked.length === 1 ? `${picked[0].filename} attached ✓` : `${picked.length} files attached ✓`, description: 'They ride along when you press Send.' })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
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
      {/* The armed win back draft lives here too: this is where the owner
          looks for campaigns, so the quiet list and its send gate sit above
          the list. The same gate, the same confirm, no second law. */}
      {isAdmin && <WinBackCard />}

      {isAdmin && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-sm flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-brand" /> Abandoned checkouts
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Card checkouts that opened and never finished — no money moved. A nudge usually lands it.
              </p>
            </div>
            <Button size="sm" className="gap-1 shrink-0" disabled={!abandoned || abandoned.abandoned.filter((a) => !a.alreadyQueued).length === 0} onClick={openAbandon}>
              <Plus className="h-3.5 w-3.5" /> Queue follow-up
            </Button>
          </div>
          {abandoned === null ? (
            <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-10 rounded-md bg-white/5 animate-pulse" />)}</div>
          ) : abandoned.abandoned.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              None right now — {abandoned.inflight} checkout{abandoned.inflight === 1 ? '' : 's'} still open, {abandoned.paidLast30d} paid in the last 30 days.
            </p>
          ) : (
            <div className="divide-y rounded-lg border max-h-64 overflow-y-auto hp-scroll">
              {abandoned.abandoned.map((a) => (
                <div key={a.id} className="p-2.5 flex items-center gap-2 text-sm">
                  <Coins className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{a.name || a.email}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{a.email} · {a.reference} · left open {a.ageHours}h ago</p>
                  </div>
                  <span className="text-xs font-medium shrink-0">{rands(a.amountRands)}</span>
                  {a.alreadyQueued
                    ? <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">follow-up queued</Badge>
                    : <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-500 shrink-0">waiting</Badge>}
                </div>
              ))}
            </div>
          )}
          {abandoned && abandoned.abandoned.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {abandoned.paidLast30d} paid in the last 30 days · {abandoned.inflight} in flight right now (under 30 min, not counted) · follow-ups queue under {abandoned.campaignTag}, born paused.
            </p>
          )}
        </div>
      )}

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
                    <p className="mt-1 text-[10px] text-muted-foreground truncate">
                      {sum.queued > 0 && state
                        ? `${state.perHour} per hour · from ${state.from || 'default sender'} · clears in ${finishEstimate(sum.queued, state.perHour)} · ${rate}% read so far`
                        : `${rate}% opened · green bar grows as they read`}
                    </p>
                  </button>
                  {isOpen && (
                    <>
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-t flex-wrap">
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openAdd(key)}>
                          <Plus className="h-3 w-3" /> Add email
                        </Button>
                        {state && sum.queued > 0 && (
                          <>
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
                          </>
                        )}
                        <span className="text-[11px] text-muted-foreground ml-auto hidden sm:block">
                          {state && sum.queued > 0
                            ? state.status === 'ACTIVE'
                              ? 'Engine is moving. Check back or keep this page open.'
                              : 'Draft gate: nothing sends until you press Start.'
                            : 'Add another letter to this campaign — it waits paused until you Start it.'}
                        </span>
                      </div>
                      <div className="divide-y border-t max-h-80 overflow-y-auto hp-scroll">
                        {rows.length === 0 ? (
                          <p className="text-xs text-muted-foreground p-4 text-center">No sends recorded under this label.</p>
                        ) : rows.map((r) => (
                          <div
                            key={r.id}
                            onClick={() => setReading(readRow(r, state))}
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
                            {r.lead?.id && r.status !== 'QUEUED' && r.status !== 'SKIPPED' && (
                              <div className="flex items-center gap-1 shrink-0" onClick={(ev) => ev.stopPropagation()}>
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

      {/* Campaigns for upgraded members (non-exec seats): their own queues,
          their own profiles, read receipts included. The transport lane never
          shows here — the engine picks the right pipe on its own. */}
      {!isAdmin && paid && <UserCampaigns profiles={profiles} />}

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
              <Label htmlFor="m-from">Sending from</Label>
              <select
                id="m-from"
                value={fromProfile}
                onChange={(e) => setFromProfile(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                {(profiles.length ? profiles : [{ id: '', name: session?.user?.businessName || session?.user?.name || 'My business', from: '' }]).map((p) => (
                  <option key={p.id || 'account'} value={p.id}>{p.name}</option>
                ))}
              </select>
              {profiles.find((p) => p.id === fromProfile)?.from && (
                <p className="text-[11px] text-muted-foreground">Their inbox shows: <span className="font-medium">{profiles.find((p) => p.id === fromProfile)?.from}</span></p>
              )}
            </div>
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
            <div className="space-y-1.5">
              <Label htmlFor="m-look" className="flex items-center gap-1.5"><Palette className="h-3.5 w-3.5 text-brand" /> The look your email arrives in</Label>
              <div className="flex flex-wrap items-center gap-1.5" id="m-look" role="radiogroup" aria-label="Email look">
                {LOOKS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setTheme(l.id)}
                    title={l.blurb}
                    aria-pressed={theme === l.id}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${theme === l.id ? 'border-brand bg-brand/10 text-foreground' : 'border-border text-muted-foreground hover:border-brand/40 hover:text-foreground'}`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10" style={{ background: l.dot }} />
                    {l.label}
                  </button>
                ))}
                <Button size="sm" variant="outline" type="button" className="h-7 rounded-full gap-1 text-xs" disabled={!body.trim() || previewing} onClick={openPreview}>
                  {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  Preview
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{LOOKS.find((l) => l.id === theme)?.blurb}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
                aria-label="Upload a file to attach"
              />
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} type="button">
                <Paperclip className="h-4 w-4 mr-1" /> Attach PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => setVideoOpen(true)} type="button">
                <Clapperboard className="h-4 w-4 mr-1" /> Create a pitch video
              </Button>
              {fileAttaches.map((f, i) => (
                <span key={`${f.filename}-${i}`} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                  <Paperclip className="h-3.5 w-3.5 text-brand" />
                  {f.filename} · {(f.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                  <button onClick={() => setFileAttaches((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove ${f.filename}`} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
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
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
                  <span>{statusText}</span>
                </p>
                {spendQuote && (
                  <p className="text-[11px] mt-0.5 flex items-center gap-1.5 pl-3 min-w-0">
                    <Coins className="h-3 w-3 text-brand shrink-0" />
                    {spendQuote.mode === 'ALLOWANCE' ? (
                      <span className="text-muted-foreground truncate">
                        {!paid
                          ? `${spendQuote.allowanceRemaining} free send${spendQuote.allowanceRemaining === 1 ? '' : 's'} left, then ${rands(spendQuote.priceCents)} each`
                          : `${spendQuote.allowanceRemaining} of ${spendQuote.allowance} included sends left this cycle`}
                      </span>
                    ) : spendQuote.mode === 'AIRTIME' ? (
                      <span className="text-brand font-medium truncate">
                        {rands(spendQuote.priceCents)} per send · {rands(spendQuote.balanceCents)} airtime left
                      </span>
                    ) : (
                      <button onClick={() => setView('wallet')} className="text-amber-500 hover:underline font-medium text-left">
                        Airtime empty — load credits to keep sending
                      </button>
                    )}
                  </p>
                )}
              </div>
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
          {!loading && emails.some((e) => e.status === 'DRAFT') && (
            <p className="text-[11px] text-amber-500/90 -mt-1.5 mb-2.5">
              {emails.filter((e) => e.status === 'DRAFT').length} draft{emails.filter((e) => e.status === 'DRAFT').length === 1 ? '' : 's'} waiting for your approval — press <span className="font-medium">Edit &amp; send</span>, check it, hit Send. Only you press Send.
            </p>
          )}
          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-md bg-white/5 animate-pulse" />)}</div>
          ) : emails.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No emails yet, draft one and it lands here.</p>
          ) : (
            <div className="space-y-2 max-h-[32rem] overflow-y-auto hp-scroll">
              {emails.map((e) => (
                <div
                  key={e.id}
                  onClick={() => setReading(e)}
                  className="group rounded-lg border p-2.5 text-sm cursor-pointer hover:border-brand/40 hover:bg-brand/5 transition"
                  role="button" aria-label={`Read: ${e.subject}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{e.subject}</p>
                      <p className="truncate text-xs text-muted-foreground">to {e.toEmail}{e.ccEmail ? ` · cc ${e.ccEmail}` : ''} · {new Date(e.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{e.status === 'SENT' && e.openedAt ? ` · opened ${new Date(e.openedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {e.status === 'SENT' && e.openedAt && (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-500 gap-1 whitespace-nowrap">
                          <MailCheck className="h-3 w-3" />
                          read{e.openCount && e.openCount > 1 ? ` ×${e.openCount}` : ''}
                        </Badge>
                      )}
                      {e.status === 'DRAFT' && (
                        <button
                          onClick={(ev) => { ev.stopPropagation(); openDraft(e) }}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-brand transition text-[11px] font-medium whitespace-nowrap"
                          aria-label="Edit and send this draft"
                        >
                          Edit &amp; send
                        </button>
                      )}
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
                      <button
                        onClick={(ev) => { ev.stopPropagation(); remove(e.id) }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-400 transition"
                        aria-label="Delete"
                      >
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

      {/* Read view: the whole email, exactly as it went out — replayed from
          the log row, branded sends in a sandboxed frame, one tap to the
          plain words. Serves the mail log AND the campaign read-out. */}
      <EmailPreviewDialog row={reading} onOpenChange={(o) => { if (!o) setReading(null) }} />

      {/* Look preview: the recipient's exact view of the picked look, in a
          sandboxed frame. Plain has no chrome and says so in words. */}
      <Dialog open={previewOpen} onOpenChange={(o) => { if (!o) setPreviewOpen(false) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto hp-scroll">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-brand" /> Preview · {LOOKS.find((l) => l.id === theme)?.label} look
            </DialogTitle>
            <DialogDescription>
              How the HustlePortal engine frames this email. Your words stay yours; the frame is the look you picked.
            </DialogDescription>
          </DialogHeader>
          {previewHtml ? (
            <iframe
              title="Email look preview"
              sandbox=""
              srcDoc={previewHtml}
              className="w-full rounded-lg border bg-white"
              style={{ height: 480 }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              The Plain look has no frame — your email goes out as clean text, exactly as you wrote it.
            </p>
          )}
        </DialogContent>
      </Dialog>

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
            <DialogTitle className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand" /> {composerMode === 'add' ? `Add email — ${campaignLabel(addSource)}` : 'New campaign'}</DialogTitle>
            <DialogDescription>
              {composerStep === 'audience'
                ? composerMode === 'add'
                  ? `Pull the people ${campaignLabel(addSource)} already reached — sliced by who opened — or paste fresh addresses.`
                  : 'Pick the audience. The whole platform, your pipeline contacts, or paste any list.'
                : 'Write the message and set the pace. Review the draft before it queues.'}
            </DialogDescription>
          </DialogHeader>

          {composerStep === 'audience' ? (
            composerMode === 'add' ? (
              <div className="space-y-3">
                {sourceAud === null ? (
                  <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-md bg-white/5 animate-pulse" />)}</div>
                ) : !sourceAud.found ? (
                  <p className="text-xs text-muted-foreground rounded-lg border p-3">
                    Nothing was ever sent under this campaign yet — paste addresses below instead.
                  </p>
                ) : (
                  <div className="space-y-2" role="radiogroup" aria-label="Who gets this email">
                    {([
                      { id: 'opened', title: 'Opened it', n: sourceAud.opened, blurb: 'The warm list — they read the last one. Best odds for a follow-up.' },
                      { id: 'unopened', title: 'Never opened', n: sourceAud.unopened, blurb: 'A fresh subject line gives the quiet ones a second chance.' },
                      { id: 'all', title: 'Everyone reached', n: sourceAud.total, blurb: 'Opened and not opened — everyone this campaign actually delivered to.' },
                    ] as const).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={sourcePick === opt.id}
                        onClick={() => setSourcePick(opt.id)}
                        className={`w-full rounded-lg border p-3 text-left transition ${sourcePick === opt.id ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'hover:bg-muted/40'}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium">{opt.title}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{opt.n} contact{opt.n === 1 ? '' : 's'}</span>
                        </span>
                        <span className="block text-[11px] text-muted-foreground mt-0.5">{opt.blurb}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="c-paste">Or paste extra addresses</Label>
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
              <label
                className={`rounded-lg border p-3 flex items-start gap-2.5 cursor-pointer transition ${systemPick ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'hover:bg-muted/40'}`}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--brand)] h-4 w-4 mt-0.5"
                  checked={systemPick}
                  onChange={(e) => setSystemPick(e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">Everyone on the system</span>
                  {systemAud ? (
                    <span className="block text-[11px] text-muted-foreground leading-relaxed">
                      {systemAud.eligible} accounts ready for mail · {systemAud.neverLoggedIn} never signed in yet
                      {systemAud.excluded.kloofstreet > 0 ? ` · ${systemAud.excluded.kloofstreet} on kloofstreet.online skipped, already mailed` : ''}
                      {systemAud.excluded.paying > 0 ? ` · ${systemAud.excluded.paying} already paying` : ''}
                      {systemAud.excluded.suspended + systemAud.excluded.suppressed + systemAud.excluded.internal > 0
                        ? ` · ${systemAud.excluded.suspended + systemAud.excluded.suppressed + systemAud.excluded.internal} paused, unsubscribed or internal, refused`
                        : ''}
                    </span>
                  ) : (
                    <span className="block text-[11px] text-muted-foreground">Counting the roster…</span>
                  )}
                </span>
              </label>
              {systemPick && systemAud && systemAud.excluded.paying > 0 && (
                <label className="flex items-center gap-2 pl-7 -mt-1.5 text-[11px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-[var(--brand)] h-3.5 w-3.5"
                    checked={systemIncludePaying}
                    onChange={(e) => setSystemIncludePaying(e.target.checked)}
                  />
                  Include the {systemAud.excluded.paying} already paying too
                </label>
              )}
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
            )
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="c-name">{composerMode === 'add' ? 'Queue name' : 'Campaign name'}</Label>
                  <Input id="c-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="blackbiz-intro" />
                  {composerMode === 'add' && (
                    <p className="text-[11px] text-muted-foreground">
                      Queues as its own card with its own Start button. Set it back to the campaign&apos;s own name and it joins that queue instead.
                    </p>
                  )}
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
                <Label>The look</Label>
                <Select value={cTheme} onValueChange={(v) => setCTheme(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="engine">Engine default (Gold Rush)</SelectItem>
                    {LOOKS.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-subject">Subject</Label>
                <Input id="c-subject" value={cSubject} onChange={(e) => setCSubject(e.target.value)} placeholder="Your next client is one search away" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-body">Message</Label>
                <Textarea id="c-body" rows={8} value={cBody} onChange={(e) => setCBody(e.target.value)} placeholder="Write it the way you speak. Short lines win." />
                <p className="text-[11px] text-muted-foreground">A line starting with &quot;See it in motion: &lt;video link&gt;&quot; renders as a big clickable video card.</p>
                <p className="text-[11px] text-muted-foreground">Type {'{name}'} in the greeting and {'{email}'} where their address goes. Every email is filled per person before it sends.</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-xs">
                <p className="font-medium text-[13px]">Before it queues</p>
                <p className="text-muted-foreground">{pickCount} recipients · {cPerHour} per hour · {cProvider === 'SES' ? 'SES lane' : 'free lane'} · finishes in {finishEstimate(pickCount, Number(cPerHour))}</p>
                {composerMode === 'add' && (
                  <p className="text-muted-foreground">Queues under <span className="font-medium text-foreground">{cName.trim() || '—'}</span> — a new letter always re-pauses the queue until you approve it.</p>
                )}
                <p className="text-muted-foreground">Every email carries a one tap unsubscribe link and open tracking. Bounces and spam complaints remove the address automatically.</p>
                <p className="text-foreground/80 font-medium">Nothing sends yet. The queue waits paused, you press Start on the card once the draft is approved.</p>
              </div>
              {cSubject.trim() && cBody.trim() && (
                <div className="rounded-lg border p-3">
                  <p className="text-[11px] text-muted-foreground mb-1">Draft preview{personalizable ? ' · names filled with a sample account' : ''}</p>
                  <p className="text-[13px] font-medium">{personalizable ? sampleFill(cSubject) : cSubject}</p>
                  <p className="text-xs whitespace-pre-wrap mt-1 max-h-36 overflow-y-auto hp-scroll">{personalizable ? sampleFill(cBody) : cBody}</p>
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

      {/* Edit draft: the boss's handle on a queue that already exists. Rewrites
          every still-queued email; sent mail is history and stays untouched. */}
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
              <Label htmlFor="ed-from">From — the sender their inbox shows</Label>
              <Input
                id="ed-from"
                value={editDraft.from}
                onChange={(e) => setEditDraft({ ...editDraft, from: e.target.value })}
                placeholder='You <you@hustleportal.online>'
              />
              <p className="text-[11px] text-muted-foreground">
                Any label and address on the hustleportal.online domain works — the domain is verified with the mail provider.
                A different domain needs its DNS verified first; say the word and it gets wired.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-subject">Subject</Label>
              <Input id="ed-subject" value={editDraft.subject} onChange={(e) => setEditDraft({ ...editDraft, subject: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-body">Message</Label>
              <Textarea id="ed-body" rows={10} value={editDraft.body} onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">
                Type {'{name}'} in the greeting and it fills per person where the account exists. A line starting with &quot;See it in motion: &lt;video link&gt;&quot; renders as a big clickable video card.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ed-perhour">Sends per hour</Label>
                <Input
                  id="ed-perhour" type="number" min={1} max={600} value={editDraft.perHour}
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
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditTag(null)} disabled={editSaving}>Close</Button>
              <Button className="flex-1" onClick={saveEdit} disabled={editSaving || !editDraft.subject.trim() || editDraft.body.trim().length < 20}>
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Pencil className="h-4 w-4 mr-1" />}
                Save & rewrite queue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Abandoned checkout follow-up: the editable recovery letter. Queues
          under abandoned-cart-<month>, born paused, {name} fills per account. */}
      <Dialog open={abandonOpen} onOpenChange={(o) => { if (!o) setAbandonOpen(false) }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto hp-scroll">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-brand" /> Follow-up blast — abandoned checkouts
            </DialogTitle>
            <DialogDescription>
              {abandoned ? `${abandoned.abandoned.filter((a) => !a.alreadyQueued).length} abandoned checkout${abandoned.abandoned.filter((a) => !a.alreadyQueued).length === 1 ? '' : 's'} get the nudge · {name} fills per account` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ab-subject">Subject</Label>
              <Input id="ab-subject" value={abandonDraft.subject} onChange={(e) => setAbandonDraft({ ...abandonDraft, subject: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ab-body">Message</Label>
              <Textarea id="ab-body" rows={10} value={abandonDraft.body} onChange={(e) => setAbandonDraft({ ...abandonDraft, body: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">
                These are real accounts, so {'{name}'} fills with their own first name. One tap unsubscribe and the legal footer ride along automatically.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAbandonOpen(false)} disabled={abandonBusy}>Close</Button>
              <Button className="flex-1" onClick={queueFollowup} disabled={abandonBusy || !abandonDraft.subject.trim() || abandonDraft.body.trim().length < 20}>
                {abandonBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Megaphone className="h-4 w-4 mr-1" />}
                Queue the follow-up
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
