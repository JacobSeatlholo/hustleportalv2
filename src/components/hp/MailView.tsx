'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api, type EmailLogRow, type Lead, type CampaignRow, type CampaignSummary } from './shared'
import { useHp } from './store'
import { usePlan, requestUpgrade } from './useUpgrade'
import { useToast } from '@/hooks/use-toast'
import { requestOpenLead } from './leadBus'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Mail, Send, Sparkles, Trash2, Inbox, ShieldCheck, X, Megaphone, MailCheck, CalendarPlus, ChevronDown, ChevronUp, User } from 'lucide-react'

const GOALS = [
  'Introduce my business and book a call',
  'Follow up on a quote I sent',
  'Re-engage a cold prospect',
  'Pitch a specific offering',
  '__custom__', // “Write my own…” — free-text goal, e.g. “Welcome email for my team”
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

  // Campaigns (exec): bulk sends grouped by campaign with read receipts,
  // one tap from a recipient row to a follow up task or the contact itself.
  const isAdmin = session?.user?.role === 'ADMIN'
  const [campaignRows, setCampaignRows] = useState<CampaignRow[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [taskRow, setTaskRow] = useState<CampaignRow | null>(null)
  const [task, setTask] = useState({ title: '', dueDate: '', dueTime: '', priority: 'MEDIUM', notes: '' })
  const [taskSaving, setTaskSaving] = useState(false)

  const loadCampaigns = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await api<{ rows: CampaignRow[]; summary: Record<string, CampaignSummary> }>('/api/admin/exec/campaign')
      setCampaignRows(res.rows || [])
    } catch {
      setCampaignRows([])
    }
  }, [isAdmin])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])

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
    // A typed goal wins — the presets are just the fast path.
    const effectiveGoal = goal === CUSTOM_GOAL ? customGoal.trim() : goal
    if (goal === CUSTOM_GOAL && !effectiveGoal) {
      toast({ title: 'Write your goal first', description: 'One line is enough — e.g. "Welcome email for my team".', variant: 'destructive' })
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
        body: JSON.stringify({ draftId, to, subject, body, projectId: activeProjectId }),
      })
      toast({
        title: 'Sent ✓',
        description:
          res.notice ||
          (typeof res.freeRemaining === 'number' && !paid
            ? `${res.freeRemaining} free email${res.freeRemaining === 1 ? '' : 's'} left this plan. Operator sends unlimited.`
            : `${subject} → ${to}`),
      })
      setSubject(''); setBody(''); setTo(''); setDraftId(null)
      load()
    } catch (e) {
      // Calm inline card instead of a toast wall — details stay under the composer
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
    if (!mailStatus) return 'Sends via the HustlePortal mail engine — replies route back to your inbox.'
    if (mailStatus.gmailConfigured && engineReady) {
      return `Goes out from your Gmail — the HustlePortal engine (${mailStatus.fromAddress}) backs it up automatically.`
    }
    if (mailStatus.gmailConfigured && !engineReady) {
      return 'Goes out from your Gmail when it passes the connection test — meanwhile the HustlePortal engine is finishing setup and may only reach your own inbox.'
    }
    if (!mailStatus.platformConfigured) {
      return 'HustlePortal mail engine is warming up — connect Gmail under Integrations to send in the meantime.'
    }
    if (engineReady) {
      return mailStatus.sendingAs
        ? `Email ready — goes out from ${mailStatus.sendingAs} (your business's own address). Replies route to your inbox.`
        : `Email ready — goes out from ${mailStatus.fromAddress}. Replies route to your inbox.`
    }
    return `${mailStatus.sendingDomain} is verifying in Resend — your sends work to your own inbox meanwhile and open up to everyone the moment verification completes. Nothing for you to configure.`
  })()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl">Mail</h2>
        <p className="text-sm text-muted-foreground">AI drafts grounded in your business profile — sending works out of the box. Connect your Gmail if you want it sent from your own address.</p>
      </div>

      {/* Campaigns (exec): every bulk send, who opened it, one tap to follow up */}
      {isAdmin && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div>
            <h3 className="font-medium text-sm flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-brand" /> Campaigns
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Bulk sends and who opened them. Follow up with a task or open the contact.</p>
          </div>
          {campaignRows === null ? (
            <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-12 rounded-md bg-white/5 animate-pulse" />)}</div>
          ) : campaignRows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No campaigns yet. Bulk sends show up here with their read receipts.</p>
          ) : (
            (() => {
              const groups = new Map<string, CampaignRow[]>()
              for (const r of campaignRows) {
                const key = r.campaign || 'other'
                if (!groups.has(key)) groups.set(key, [])
                groups.get(key)!.push(r)
              }
              return [...groups.entries()].map(([key, rows]) => {
                const sent = rows.filter((r) => r.status === 'SENT').length
                const failed = rows.filter((r) => r.status === 'FAILED').length
                const opened = rows.filter((r) => r.openedAt).length
                const rate = rows.length ? Math.round((opened / rows.length) * 100) : 0
                const isOpen = expanded === key
                return (
                  <div key={key} className="rounded-lg border overflow-hidden">
                    <button onClick={() => setExpanded(isOpen ? null : key)} className="w-full text-left p-3 hover:bg-muted/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{campaignLabel(key)}</span>
                        <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                          {sent} sent · {opened} opened{failed ? ` · ${failed} failed` : ''}
                          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rate}%` }} />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">{rate}% opened · green bar grows as they read</p>
                    </button>
                    {isOpen && (
                      <div className="divide-y border-t max-h-80 overflow-y-auto hp-scroll">
                        {rows.map((r) => (
                          <div key={r.id} className="p-2.5 flex items-start gap-2 text-sm">
                            <MailCheck className={`h-4 w-4 mt-0.5 shrink-0 ${r.openedAt ? 'text-emerald-500' : 'text-muted-foreground/50'}`} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium">{r.lead?.company || r.toEmail}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {r.lead?.company && r.toEmail !== r.lead.company ? `${r.toEmail} · ` : ''}
                                {r.status === 'FAILED'
                                  ? 'Send failed'
                                  : r.openedAt
                                    ? `Opened ${new Date(r.openedAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${r.openCount > 1 ? ` · ${r.openCount} times` : ''}`
                                    : `Not opened yet · sent ${new Date(r.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`}
                              </p>
                            </div>
                            {r.openedAt ? (
                              <Badge className="bg-emerald-500/15 text-emerald-600 border-0 text-[10px] shrink-0">read</Badge>
                            ) : r.status === 'FAILED' ? (
                              <Badge variant="outline" className="text-[10px] text-rose-500 border-rose-500/40 shrink-0">failed</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] shrink-0">sent</Badge>
                            )}
                            {r.lead?.id && (
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
                    )}
                  </div>
                )
              })
            })()
          )}
        </div>
      )}

      {/* Free plan email meter — honest count, calm tone, one tap to the plans.
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
                <option value="">— No lead —</option>
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
                <p className="text-[11px] text-muted-foreground">Any goal works — the AI drafts around it. Presets stay one click away.</p>
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
                  <p className="text-xs font-medium text-rose-400">Send failed — here&apos;s why and the fix</p>
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
            <p className="text-xs text-muted-foreground py-6 text-center">No emails yet — draft one and it lands here.</p>
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
          Sending is included — hit Send and HustlePortal delivers, with replies routed back to your account email.
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
    </div>
  )
}
