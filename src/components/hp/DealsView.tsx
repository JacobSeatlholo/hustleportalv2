'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  api, DEAL_STAGES, DEAL_STAGE_LABELS,
  type Deal, type DealTaskRow, type DealDocRow, type EsignRow,
} from './shared'
import { useHp } from './store'
import DocPanel from './DocPanel'
import {
  Plus, Loader2, ChevronRight, ChevronLeft, Trash2, Building2, Handshake,
  MessageSquare, Paperclip, NotebookPen, CircleCheck, CircleX,
} from 'lucide-react'

// ============ DEAL ROOM VIEW (Task 213) ============
// The in-platform deal room, one tab over from Team Tasks. Fill in a short
// form to open a deal, move it across the five-stage pipeline, wire tasks to
// it (they keep their own discussion threads), and keep the agreement PDFs +
// first-party e-sign sessions right on the deal. Built for onboarding brand
// strategists without leaving the platform.

const STAGE_STYLES: Record<string, string> = {
  LEAD: 'text-stone-400',
  PROPOSAL: 'text-sky-500',
  NEGOTIATION: 'text-amber-500',
  WON: 'text-emerald-500',
  LOST: 'text-red-500',
}

function fmtValue(v: number | null): string {
  return v === null ? '' : `R${v.toLocaleString('en-ZA')}`
}

export default function DealsView({ teams }: {
  teams: { id: string; name: string; members: { id: string; name: string; email: string }[] }[]
}) {
  const { session, bumpRefresh } = useHp()
  const { toast } = useToast()
  const [scope, setScope] = useState<'mine' | 'team'>('mine')
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  // create form
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [value, setValue] = useState('')
  const [dest, setDest] = useState<string>('personal')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ deals: Deal[] }>(`/api/deals?scope=${scope}`)
      setDeals(res.deals)
    } catch {
      toast({ title: 'Failed to load deals', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [scope, toast])

  useEffect(() => {
    load()
  }, [load])

  function patchDeal(id: string, patch: Partial<Deal>) {
    setDeals((rows) => rows.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  async function addDeal() {
    if (!title.trim() || !company.trim() || !contactName.trim()) return
    setAdding(true)
    try {
      const res = await api<{ deal: Deal }>('/api/deals', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          company: company.trim(),
          contactName: contactName.trim(),
          contactEmail: contactEmail.trim() || null,
          contactPhone: contactPhone.trim() || null,
          value: value.trim() || null,
          teamId: dest !== 'personal' ? dest : null,
        }),
      })
      setDeals((prev) => [res.deal, ...prev])
      setTitle('')
      setCompany('')
      setContactName('')
      setContactEmail('')
      setContactPhone('')
      setValue('')
      toast({
        title: 'Deal opened',
        description: 'Move it through the pipeline as it progresses. Upload the agreement and invite a signature when you are ready.',
      })
    } catch (e) {
      toast({ title: 'Could not open the deal', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  async function moveStage(deal: Deal, dir: 1 | -1) {
    const idx = DEAL_STAGES.indexOf(deal.stage as (typeof DEAL_STAGES)[number])
    const next = DEAL_STAGES[Math.min(DEAL_STAGES.length - 1, Math.max(0, idx + dir))]
    if (!next || next === deal.stage) return
    patchDeal(deal.id, { stage: next })
    try {
      await api(`/api/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ stage: next }) })
    } catch {
      patchDeal(deal.id, { stage: deal.stage })
    }
  }

  async function deleteDeal(deal: Deal) {
    try {
      await api(`/api/deals/${deal.id}`, { method: 'DELETE' })
      setDeals((prev) => prev.filter((d) => d.id !== deal.id))
      if (selected === deal.id) setSelected(null)
    } catch (e) {
      toast({ title: 'Could not delete', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  const sel = deals.find((d) => d.id === selected) || null
  const myId = session?.user.id || ''

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Deal room</h1>
          <p className="text-sm text-muted-foreground">
            {deals.length} deal{deals.length === 1 ? '' : 's'} · open one, wire its tasks, sign its documents, all here
          </p>
        </div>
        <Tabs value={scope} onValueChange={(v) => setScope(v as 'mine' | 'team')}>
          <TabsList>
            <TabsTrigger value="mine">My deals</TabsTrigger>
            <TabsTrigger value="team" disabled={teams.length === 0}>Team deals</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Open a deal: the whole pipeline starts as a short form */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Deal name… e.g. Trinity Direct onboarding" className="flex-1 min-w-[180px]" />
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="w-[160px]" />
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact person" className="w-[160px]" />
            <Select value={dest} onValueChange={setDest}>
              <SelectTrigger className="w-[150px]" aria-label="Deal room"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">Just me</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={addDeal} disabled={adding || !title.trim() || !company.trim() || !contactName.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Open deal
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Contact email (optional)" className="w-[240px]" />
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Contact phone (optional)" className="w-[200px]" />
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Deal value in R (optional)" inputMode="decimal" className="w-[190px]" />
            <span className="text-[11px] text-muted-foreground">Everything is optional except name, company and contact — fill the rest as it comes in.</span>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline: five stages, newest activity first in every column */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {DEAL_STAGES.map((stage) => {
            const col = deals.filter((d) => d.stage === stage)
            return (
              <div key={stage} className="space-y-2">
                <p className={`text-xs font-semibold px-1 flex items-center gap-1.5 ${STAGE_STYLES[stage]}`}>
                  {stage === 'WON' ? <CircleCheck className="h-3.5 w-3.5" /> : stage === 'LOST' ? <CircleX className="h-3.5 w-3.5" /> : <Handshake className="h-3.5 w-3.5" />}
                  {DEAL_STAGE_LABELS[stage]}
                  <span className="font-normal text-muted-foreground">· {col.length}</span>
                </p>
                {col.length === 0 && <p className="text-[11px] text-muted-foreground px-1 py-2">—</p>}
                {col.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelected((v) => (v === d.id ? null : d.id))}
                    className={`w-full text-left rounded-xl border bg-card p-3 space-y-1 transition ${
                      selected === d.id ? 'border-brand ring-1 ring-brand/40' : 'border-border hover:border-brand/50'
                    }`}
                  >
                    <p className="text-sm font-medium leading-tight">{d.title}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" /> {d.company}</p>
                    {d.value !== null && <p className="text-xs font-medium text-brand">{fmtValue(d.value)}</p>}
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground pt-0.5">
                      {d._count && <span className="inline-flex items-center gap-0.5"><NotebookPen className="h-3 w-3" /> {d._count.tasks}</span>}
                      {d._count && <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" /> {d._count.docs}</span>}
                      {d.team && <span>{d.team.name}</span>}
                      {!d.team && <span>private</span>}
                      {d.ownerId !== myId && <span>· {d.owner.name}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* Deal detail: contacts, stage, tasks and the signing desk */}
      {sel && (
        <DealDetail
          deal={sel}
          teams={teams}
          onPatched={(patch) => patchDeal(sel.id, patch)}
          onDeleted={() => { setDeals((prev) => prev.filter((d) => d.id !== sel.id)); setSelected(null) }}
          onTaskAdded={() => { bumpRefresh() }}
        />
      )}
    </div>
  )
}

function DealDetail({ deal, teams, onPatched, onDeleted, onTaskAdded }: {
  deal: Deal
  teams: { id: string; name: string; members: { id: string; name: string; email: string }[] }[]
  onPatched: (patch: Partial<Deal>) => void
  onDeleted: () => void
  onTaskAdded: () => void
}) {
  const { toast } = useToast()
  const [tasks, setTasks] = useState<DealTaskRow[] | null>(null)
  const [newTask, setNewTask] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [notes, setNotes] = useState(deal.notes || '')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => {
    setNotes(deal.notes || '')
    setTasks(null)
    api<{ tasks: DealTaskRow[] }>(`/api/deals/${deal.id}`)
      .then((r) => setTasks(r.tasks))
      .catch(() => setTasks([]))
  }, [deal.id, deal.notes])

  async function setStage(stage: string) {
    onPatched({ stage })
    try {
      await api(`/api/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ stage }) })
    } catch {
      toast({ title: 'Could not move the deal', variant: 'destructive' })
    }
  }

  async function saveNotes() {
    setSavingNotes(true)
    try {
      await api(`/api/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ notes }) })
      onPatched({ notes })
      toast({ title: 'Notes saved' })
    } catch {
      toast({ title: 'Could not save notes', variant: 'destructive' })
    } finally {
      setSavingNotes(false)
    }
  }

  async function addTask() {
    const t = newTask.trim()
    if (!t) return
    setAddingTask(true)
    try {
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: t,
          teamId: deal.teamId,
          assigneeId: undefined,
          dealId: deal.id,
        }),
      })
      setNewTask('')
      const r = await api<{ tasks: DealTaskRow[] }>(`/api/deals/${deal.id}`)
      setTasks(r.tasks)
      onTaskAdded()
      toast({ title: 'Task added to the deal', description: 'Open it on Team tasks to discuss it with whoever it is assigned to.' })
    } catch (e) {
      toast({ title: 'Could not add the task', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setAddingTask(false)
    }
  }

  return (
    <Card className="border-brand/40">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-[200px]">
            <p className="font-display text-xl leading-tight">{deal.title}</p>
            <p className="text-sm text-muted-foreground">{deal.company} · {deal.contactName}</p>
            <p className="text-xs text-muted-foreground">
              {[deal.contactEmail, deal.contactPhone, fmtValue(deal.value)].filter(Boolean).join(' · ') || 'No further details yet'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={deal.stage} onValueChange={setStage}>
              <SelectTrigger className="w-[160px]" aria-label="Deal stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEAL_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>{DEAL_STAGE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="icon" className="h-9 w-9"
                aria-label="Stage back"
                disabled={deal.stage === DEAL_STAGES[0]}
                onClick={() => setStage(DEAL_STAGES[Math.max(0, DEAL_STAGES.indexOf(deal.stage as (typeof DEAL_STAGES)[number]) - 1)])}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline" size="icon" className="h-9 w-9"
                aria-label="Stage forward"
                disabled={deal.stage === DEAL_STAGES[DEAL_STAGES.length - 1]}
                onClick={() => setStage(DEAL_STAGES[Math.min(DEAL_STAGES.length - 1, DEAL_STAGES.indexOf(deal.stage as (typeof DEAL_STAGES)[number]) + 1)])}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600" onClick={onDeleted} aria-label="Delete deal">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Deal tasks: each keeps its own discussion thread on Team tasks */}
        <div className="space-y-2">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <NotebookPen className="h-3.5 w-3.5 text-brand" /> Tasks on this deal
          </p>
          {tasks === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tasks yet. Add the next step below — it shows up on Team tasks with the deal tag.</p>
          ) : (
            <div className="space-y-1">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs rounded-lg border bg-muted/20 px-2 py-1.5">
                  <Badge variant="secondary" className="text-[10px] h-4 shrink-0">{t.status}</Badge>
                  <span className="font-medium truncate flex-1">{t.title}</span>
                  {t.assignee && <span className="text-muted-foreground shrink-0">→ {t.assignee.name}</span>}
                  {t._count && (
                    <span className="inline-flex items-center gap-0.5 text-muted-foreground shrink-0">
                      <MessageSquare className="h-3 w-3" /> {t._count.comments}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
              placeholder="Next step for this deal… e.g. Send agreement for signature"
              className="flex-1"
            />
            <Button onClick={addTask} disabled={addingTask || !newTask.trim()} size="sm">
              {addingTask ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add
            </Button>
          </div>
        </div>

        {/* Signing desk: upload the agreement, invite a signature */}
        <DocPanel dealId={deal.id} />

        {/* Notes */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <Paperclip className="h-3.5 w-3.5 text-brand" /> Notes
          </p>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything the team should know about this deal…" className="text-sm" />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={saveNotes} disabled={savingNotes || notes === (deal.notes || '')}>
              {savingNotes ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save notes
            </Button>
            <span className="text-[10px] text-muted-foreground">Everyone who can see this deal sees these notes.</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
