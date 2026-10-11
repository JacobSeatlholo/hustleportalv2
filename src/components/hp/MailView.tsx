'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api, type EmailLogRow, type Lead } from './shared'
import { useHp } from './store'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Mail, Send, Sparkles, Trash2, Inbox, ShieldCheck, X } from 'lucide-react'

const GOALS = [
  'Introduce my business and book a call',
  'Follow up on a quote I sent',
  'Re-engage a cold prospect',
  'Pitch a specific offering',
]

interface MailStatus {
  platformConfigured: boolean
  fromAddress: string
  sendingDomain: string
  domainStatus: 'verified' | 'pending' | 'not_started' | 'failed' | 'unknown'
  domains: { name: string; status: string }[]
  gmailConfigured: boolean
}

export default function MailView() {
  const { activeProjectId, bumpRefresh, setView } = useHp()
  const { toast } = useToast()
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
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)

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
    setDrafting(true)
    try {
      const res = await api<{ draft: { id: string; subject: string; body: string; toEmail: string } }>(
        '/api/ai/generate-email',
        {
          method: 'POST',
          body: JSON.stringify({ leadId: leadId || undefined, to, goal, projectId: activeProjectId }),
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
      const res = await api<{ email: EmailLogRow; notice?: string | null }>('/api/emails', {
        method: 'POST',
        body: JSON.stringify({ draftId, to, subject, body, projectId: activeProjectId }),
      })
      toast({
        title: 'Sent ✓',
        description: res.notice || `${subject} → ${to}`,
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
    if (engineReady) return `Email ready — goes out from ${mailStatus.fromAddress}. Replies route to your inbox.`
    return `${mailStatus.sendingDomain} is verifying in Resend — your sends work to your own inbox meanwhile and open up to everyone the moment verification completes. Nothing for you to configure.`
  })()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl">Mail</h2>
        <p className="text-sm text-muted-foreground">AI drafts grounded in your business profile — sending works out of the box. Connect your Gmail if you want it sent from your own address.</p>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* Compose */}
        <div className="lg:col-span-3 rounded-xl border bg-card p-4 space-y-4">
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
              <select id="m-goal" value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full h-9 rounded-md border bg-background px-2 text-sm">
                {GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
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
        <div className="lg:col-span-2 rounded-xl border bg-card p-4">
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

      <div className="rounded-xl border border-brand/20 bg-brand/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Mail className="h-4 w-4 text-brand shrink-0 mt-0.5" />
        <span>
          Sending is included — hit Send and HustlePortal delivers, with replies routed back to your account email.
          Prefer your own address on the label? Connect Gmail in Integrations (optional, takes about a minute).
        </span>
      </div>
    </div>
  )
}
