'use client'

import { useEffect, useState, useRef, type ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api, PRIORITIES, type Task, type TaskCommentRow, type TaskEventRow } from './shared'
import { useHp } from './store'
import ScanDiaryDialog from './ScanDiaryDialog'
import DealsView from './DealsView'
import DocPanel from './DocPanel'
import { useVoiceInput } from './useVoiceInput'
import { Plus, Trash2, Loader2, CalendarDays, Users, User as UserIcon, NotebookPen, MessageSquare, SendHorizontal, ChevronDown, ChevronUp, ShieldCheck, Clock, Mic, MicOff, AlignLeft, Search, Handshake, Paperclip, AlertTriangle, FileSignature, Download, X } from 'lucide-react'

// Task list ordering. CREATED_DESC (date added, newest first) is the default view;
// PRIORITY sorts by importance; DUE keeps no-date tasks at the bottom, never the top.
const TASK_SORTS = [
  { key: 'CREATED_DESC', label: 'Date added (newest)' },
  { key: 'CREATED_ASC', label: 'Date added (oldest)' },
  { key: 'PRIORITY', label: 'Importance (high first)' },
  { key: 'DUE', label: 'Due date (soonest)' },
] as const

const PRIORITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

function sortTasks(list: Task[], sortBy: string): Task[] {
  const arr = [...list]
  const ts = (d: string | null) => (d ? new Date(d).getTime() : Infinity)
  if (sortBy === 'PRIORITY') arr.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) || ts(b.createdAt) - ts(a.createdAt))
  else if (sortBy === 'DUE') arr.sort((a, b) => ts(a.dueDate) - ts(b.dueDate) || (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1))
  else if (sortBy === 'CREATED_ASC') arr.sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
  else arr.sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
  return arr
}

export default function TasksView() {
  const { session, bumpRefresh } = useHp()
  const { toast } = useToast()
  // Task 213: the deal room lives one tab over from the task list, so deals,
  // their tasks and their signing desk are reachable from Team Tasks.
  const [section, setSection] = useState<'tasks' | 'deals'>('tasks')
  const [scope, setScope] = useState<'mine' | 'team'>('mine')
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState(session?.user.id || 'me')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [notes, setNotes] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [priority, setPriority] = useState('MEDIUM')
  const [isPrivate, setIsPrivate] = useState(false)
  // Where does this task belong? 'personal' = private to me · 'business' = workspace-shared
  // (no team, not private) · otherwise the team's id.
  const [dest, setDest] = useState<string>('personal')
  const [teams, setTeams] = useState<{ id: string; name: string; members: { id: string; name: string; email: string }[] }[]>([])
  const [adding, setAdding] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  // Find and order: search across title + notes, sort by date added, importance or due date.
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<string>('CREATED_DESC')

  // Voice dictation, title mic and description mic write straight into the fields
  const titleVoice = useVoiceInput(setTitle)
  const notesVoice = useVoiceInput(setNotes)
  // Live comment counts per task (list payload ships the DB count; the thread updates it locally)
  const [counts, setCounts] = useState<Record<string, number>>({})

  async function load() {
    setLoading(true)
    try {
      const res = await api<{ tasks: Task[] }>(`/api/tasks?scope=${scope}`)
      setTasks(res.tasks)
      setCounts(Object.fromEntries(res.tasks.map((t) => [t.id, t._count?.comments || 0])))
    } catch {
      toast({ title: 'Failed to load tasks', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    api<{ teams: typeof teams }>('/api/teams')
      .then((r) => setTeams(r.teams))
      .catch(() => {})
     
  }, [scope])

  async function addTask() {
    if (!title.trim()) return
    setAdding(true)
    try {
      const isTeam = dest !== 'personal' && dest !== 'business'
      // Date + time combine into one exact moment, resolved in THIS browser's
      // timezone and sent as a UTC instant, so a 14:00 reminder means 14:00 to the user.
      const dueIso = dueDate
        ? new Date(dueTime ? `${dueDate}T${dueTime}` : `${dueDate}T00:00`).toISOString()
        : null
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          notes: notes.trim() || null,
          priority,
          dueDate: dueIso,
          isPrivate: dest === 'personal' && isPrivate,
          teamId: isTeam ? dest : null,
          assigneeId: isTeam && assigneeId !== 'me' ? assigneeId : session?.user.id,
        }),
      })
      setTitle('')
      setNotes('')
      setDueDate('')
      setDueTime('')
      toast({
        title: dest === 'personal' ? 'Task added' : dest === 'business' ? 'Business task added' : 'Shared with the team',
        description: dueIso && dueTime ? 'A reminder fires in the app when it is due.' : undefined,
      })
      load()
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Could not add task', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  // Notion style: a patch lands locally the moment the server accepts it, so
  // the row never flips back mid session.
  function patchTask(id: string, patch: Partial<Task>) {
    setTasks((rows) => rows.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  async function toggle(task: Task) {
    const status = task.status === 'DONE' ? 'TODO' : 'DONE'
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)))
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      bumpRefresh()
    } catch {
      load()
    }
  }

  async function remove(task: Task) {
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' })
      setTasks((prev) => prev.filter((t) => t.id !== task.id))
    } catch {
      toast({ title: 'Could not delete', variant: 'destructive' })
    }
  }

  const needle = q.trim().toLowerCase()
  const matchesQ = (t: Task) =>
    !needle || t.title.toLowerCase().includes(needle) || (t.notes || '').toLowerCase().includes(needle)
  const open = sortTasks(tasks.filter((t) => t.status !== 'DONE' && matchesQ(t)), sortBy)
  const done = sortTasks(tasks.filter((t) => t.status === 'DONE' && matchesQ(t)), sortBy)
  const teamMembers = teams.find((t) => t.id === dest)?.members || []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={section} onValueChange={(v) => setSection(v as 'tasks' | 'deals')}>
          <TabsList>
            <TabsTrigger value="tasks" className="gap-1"><NotebookPen className="h-3.5 w-3.5" /> Tasks</TabsTrigger>
            <TabsTrigger value="deals" className="gap-1"><Handshake className="h-3.5 w-3.5" /> Deals</TabsTrigger>
          </TabsList>
        </Tabs>
        {section === 'tasks' && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setScanOpen(true)}>
              <NotebookPen className="h-4 w-4 mr-1.5 text-brand" /> Scan diary
            </Button>
            <Tabs value={scope} onValueChange={(v) => setScope(v as 'mine' | 'team')}>
              <TabsList>
                <TabsTrigger value="mine" className="gap-1"><UserIcon className="h-3.5 w-3.5" /> My tasks</TabsTrigger>
                <TabsTrigger value="team" className="gap-1" disabled={!session?.team}><Users className="h-3.5 w-3.5" /> Team tasks</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}
      </div>

      {section === 'deals' ? (
        <DealsView teams={teams} />
      ) : (
        <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Tasks</h1>
          <p className="text-sm text-muted-foreground">{open.length} open · {done.length} done</p>
        </div>
      </div>

      {!session?.team && (
        <Card className="border-brand/40 bg-brand/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Want to share tasks with your team?</span> Create a team in Profile → Team, invite teammates by email, then switch to Team tasks.
          </CardContent>
        </Card>
      )}

      {/* Add task bar */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && addTask()}
                placeholder="Add a task… e.g. Follow up with Nkosi Brands"
                className="pr-10"
              />
              {titleVoice.supported && (
                <button
                  type="button"
                  onClick={titleVoice.toggle}
                  aria-label={titleVoice.listening ? 'Stop voice typing' : 'Type with your voice'}
                  title={titleVoice.listening ? 'Stop voice typing' : 'Speak the task title'}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full flex items-center justify-center transition ${
                    titleVoice.listening ? 'bg-red-500/15 text-red-500 animate-pulse' : 'text-muted-foreground hover:text-brand'
                  }`}
                >
                  {titleVoice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              )}
            </div>
            <Select value={dest} onValueChange={setDest}>
              <SelectTrigger className="w-[150px]" aria-label="Task list"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dest !== 'personal' && dest !== 'business' && (
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Assignee" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">Me</SelectItem>
                  {teamMembers.filter((m) => m.id !== session?.user.id).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-[140px]" />
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dest === 'personal' && (
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground px-1">
                <Checkbox checked={isPrivate} onCheckedChange={(c) => setIsPrivate(c === true)} /> Private
              </label>
            )}
            <Button onClick={addTask} disabled={adding || !title.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add
            </Button>
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-brand transition px-1"
              aria-expanded={detailsOpen}
            >
              <AlignLeft className="h-3.5 w-3.5" /> Details
              {detailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>

          {detailsOpen && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="relative">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Describe the task so the person who gets it knows exactly what done looks like. Tap the mic and just talk."
                  className="pr-10 text-sm"
                />
                {notesVoice.supported && (
                  <button
                    type="button"
                    onClick={notesVoice.toggle}
                    aria-label={notesVoice.listening ? 'Stop voice typing' : 'Dictate the description'}
                    title={notesVoice.listening ? 'Stop voice typing' : 'Speak the description'}
                    className={`absolute right-2 top-2 h-7 w-7 rounded-full flex items-center justify-center transition ${
                      notesVoice.listening ? 'bg-red-500/15 text-red-500 animate-pulse' : 'text-muted-foreground hover:text-brand'
                    }`}
                  >
                    {notesVoice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {(titleVoice.error || notesVoice.error) && (
                <p className="text-[11px] text-amber-500">{titleVoice.error || notesVoice.error}</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Due time
                  <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="w-[110px] h-8" />
                </label>
                <span className="text-[11px] text-muted-foreground">
                  {dueDate
                    ? dueTime
                      ? 'The reminder fires in the app at this exact time.'
                      : 'Add a time and the reminder fires at that exact moment.'
                    : 'Pick a date first, then set the time.'}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Find and order */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks… title or description" className="pl-9" aria-label="Search tasks" />
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[210px]" aria-label="Sort tasks"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TASK_SORTS.map((s) => (
              <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Lists */}
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : (
        <div className="space-y-2">
          {open.length === 0 && done.length === 0 && (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                {needle
                  ? `No tasks match “${q.trim()}”. Try another word or clear the search.`
                  : 'No tasks yet. Add your first task above and start earning XP. 💪'}
              </CardContent>
            </Card>
          )}
          {open.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} onCommentCountChange={(id, n) => setCounts((c) => ({ ...c, [id]: n }))} currentUserId={session?.user.id || ''} teams={teams} onUpdated={patchTask} />
          ))}
          {done.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Completed</p>
              <div className="space-y-2">
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} onCommentCountChange={(id, n) => setCounts((c) => ({ ...c, [id]: n }))} currentUserId={session?.user.id || ''} teams={teams} onUpdated={patchTask} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

        </>
      )}

      <ScanDiaryDialog open={scanOpen} onOpenChange={setScanOpen} onDone={() => load()} />
    </div>
  )
}

function TaskRow({ task, onToggle, onRemove, onCommentCountChange, currentUserId, teams, onUpdated }: {
  task: Task
  onToggle: (t: Task) => void
  onRemove: (t: Task) => void
  onCommentCountChange: (taskId: string, count: number) => void
  currentUserId: string
  teams: { id: string; name: string; members: { id: string; name: string; email: string }[] }[]
  onUpdated: (taskId: string, patch: Partial<Task>) => void
}) {
  const due = task.dueDate ? new Date(task.dueDate) : null
  const overdue = due && task.status !== 'DONE' && due < new Date()
  const hasTime = due !== null && (due.getHours() !== 0 || due.getMinutes() !== 0)
  const [descOpen, setDescOpen] = useState(false)
  const [threadOpen, setThreadOpen] = useState(false)
  const [comments, setComments] = useState<TaskCommentRow[] | null>(null)
  const [loadingComments, setLoadingComments] = useState(false)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  // The sealed record: timestamps a team can hold each other to
  const [record, setRecord] = useState<{ events: TaskEventRow[]; verified: boolean } | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [loadingRecord, setLoadingRecord] = useState(false)
  // Deal room (Task 213): documents + first-party e-sign invites live on the task
  const [filesOpen, setFilesOpen] = useState(false)
  // Send to teammate (Hayley case, round 2): forward any task you created
  // straight onto a teammate — the task moves onto the shared team, lands in
  // their inbox (the PATCH announces it) and stays on your list too.
  const { toast } = useToast()
  const [sendOpen, setSendOpen] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [sending, setSending] = useState(false)
  // Teammates across all my teams, deduped; each carries the first shared team
  // so the forward lands on a team both of us actually belong to.
  const teammates = (() => {
    const seen = new Map<string, { id: string; name: string; email: string; teamId: string }>()
    for (const t of teams) {
      for (const m of t.members) {
        if (m.id === currentUserId || seen.has(m.id)) continue
        seen.set(m.id, { ...m, teamId: t.id })
      }
    }
    return [...seen.values()]
  })()
  const sendTask = async () => {
    const target = teammates.find((m) => m.id === sendTo)
    if (!target) return
    setSending(true)
    try {
      const r = await api<{ task: Task }>(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ teamId: target.teamId, assigneeId: target.id, isPrivate: false }),
      })
      onUpdated(task.id, r.task)
      setSendOpen(false)
      setSendTo('')
      toast({ title: `Sent to ${target.name}`, description: `"${task.title}" is now on their list — they'll get the email too.` })
    } catch (e) {
      toast({ title: 'Could not send the task', description: e instanceof Error ? e.message : 'Try again in a moment.', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }
  // Notion style: click the title, type, Enter. The sealed record witnesses
  // the rename server side (EDIT event on the chain).
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  // @mentions: typing @ opens a picker over the people who can see this task.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  // Conversations (Task 215 round 4): urgent flags, CC'd addresses, attachments
  // and document-signing cards — the whole team discussion lives in the thread.
  const [urgent, setUrgent] = useState(false)
  const [copied, setCopied] = useState('')
  const [attached, setAttached] = useState<{ id: string; filename: string }[]>([])
  const [attachBusy, setAttachBusy] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [signDocs, setSignDocs] = useState<{ id: string; filename: string }[] | null>(null)
  const [signDocId, setSignDocId] = useState('')
  const [signName, setSignName] = useState('')
  const [signEmail, setSignEmail] = useState('')
  const [signBusy, setSignBusy] = useState(false)
  const attachRef = useRef<HTMLInputElement>(null)

  const commentCount = comments ? comments.length : task._count?.comments || 0

  // Who can be tagged: the task's team roster carries the emails. Only people
  // who can already read the task can be mentioned, nobody else ever hears
  // about it from a tag.
  const audience = (() => {
    const team = task.teamId ? teams.find((x) => x.id === task.teamId) : null
    return (team?.members || []).filter((m) => m.id !== currentUserId)
  })()
  const mentionList = mention
    ? audience.filter((m) => m.name.toLowerCase().includes(mention.query) || m.email.toLowerCase().includes(mention.query)).slice(0, 5)
    : []

  function onDraftChange(v: string, caret: number) {
    setDraft(v)
    const m = /@([A-Za-z0-9._+\-']*)$/.exec(v.slice(0, caret))
    if (m && audience.length > 0) {
      setMention({ query: m[1].toLowerCase(), start: caret - m[1].length - 1 })
      setMentionIdx(0)
    } else {
      setMention(null)
    }
  }

  function pickMention(m: { name: string; email: string }) {
    if (!mention) return
    const before = draft.slice(0, mention.start)
    const after = draft.slice(mention.start + 1 + mention.query.length)
    setDraft(`${before}@${m.email} ${after}`)
    setMention(null)
  }

  async function saveTitle() {
    setEditingTitle(false)
    const t = titleDraft.trim()
    if (!t || t === task.title) return
    setSavingTitle(true)
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ title: t }) })
      onUpdated(task.id, { title: t })
    } catch {
      // the old title stays, the row never flips back
    } finally {
      setSavingTitle(false)
    }
  }

  // @email tokens render as the teammate's name inside the thread.
  function renderBody(body: string): ReactNode {
    if (audience.length === 0) return body
    const esc = audience
      .map((m) => ({ m, e: m.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }))
      .sort((a, b) => b.e.length - a.e.length)
    const re = new RegExp(`@(${esc.map((x) => x.e).join('|')})`, 'g')
    const out: ReactNode[] = []
    let last = 0
    let g: RegExpExecArray | null
    while ((g = re.exec(body)) !== null) {
      if (g.index > last) out.push(body.slice(last, g.index))
      const hit = esc.find((x) => x.e === g![1])
      out.push(<span key={g.index} className="text-sky-400 font-medium">@{hit?.m.name || g![1]}</span>)
      last = g.index + g[0].length
    }
    if (last < body.length) out.push(body.slice(last))
    return out
  }

  async function openThread() {
    setThreadOpen((v) => !v)
    if (!threadOpen && comments === null) {
      setLoadingComments(true)
      try {
        const res = await api<{ comments: TaskCommentRow[] }>(`/api/tasks/${task.id}/comments`)
        setComments(res.comments)
        onCommentCountChange(task.id, res.comments.length)
      } catch {
        setComments([])
      } finally {
        setLoadingComments(false)
      }
    }
  }

  async function openRecord() {
    setRecordOpen((v) => !v)
    if (!recordOpen && record === null) {
      setLoadingRecord(true)
      try {
        const res = await api<{ events: TaskEventRow[]; verified: boolean }>(`/api/tasks/${task.id}/record`)
        setRecord(res)
      } catch {
        setRecord({ events: [], verified: false })
      } finally {
        setLoadingRecord(false)
      }
    }
  }

  async function postComment() {
    const body = draft.trim()
    if (!body) return
    setPosting(true)
    setThreadError(null)
    try {
      const res = await api<{ comment: TaskCommentRow }>(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          urgent,
          copiedEmails: urgent ? copied : '',
          docIds: attached.map((a) => a.id),
        }),
      })
      setComments((prev) => [...(prev || []), res.comment])
      onCommentCountChange(task.id, (comments?.length || 0) + 1)
      setDraft('')
      setUrgent(false)
      setCopied('')
      setAttached([])
    } catch (e) {
      // the draft stays in the input, the reason shows under it
      setThreadError(e instanceof Error ? e.message : 'Could not send the message.')
    } finally {
      setPosting(false)
    }
  }

  async function attachDoc(file: File) {
    setAttachBusy(true)
    setThreadError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('taskId', task.id)
      const res = await fetch('/api/docs', { method: 'POST', body: fd })
      const json = (await res.json().catch(() => null)) as { doc?: { id: string; filename: string }; error?: string } | null
      if (!res.ok || !json?.doc) throw new Error(json?.error || 'Upload failed')
      setAttached((prev) => [...prev, json.doc as { id: string; filename: string }])
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : 'Could not upload the attachment.')
    } finally {
      setAttachBusy(false)
      if (attachRef.current) attachRef.current.value = ''
    }
  }

  // Send a task document for signature right from the conversation: the esign
  // engine creates the session and emails the signer, then a signing card is
  // posted into the thread so the whole team can watch it move SENT → SIGNED.
  async function openSignForm() {
    setSignOpen((v) => !v)
    if (!signOpen && signDocs === null) {
      try {
        const res = await api<{ docs: { id: string; filename: string }[] }>(`/api/docs?taskId=${task.id}`)
        setSignDocs(res.docs)
        if (res.docs[0]) setSignDocId(res.docs[0].id)
      } catch {
        setSignDocs([])
      }
    }
  }

  async function sendForSigning() {
    if (!signDocId || !signName.trim() || !signEmail.trim()) return
    setSignBusy(true)
    setThreadError(null)
    try {
      const res = await api<{ session: { id: string; docTitle: string; signerName: string; signerEmail: string } }>(
        `/api/docs/${signDocId}/esign`,
        {
          method: 'POST',
          body: JSON.stringify({ signerName: signName.trim(), signerEmail: signEmail.trim() }),
        },
      )
      const s = res.session
      const cres = await api<{ comment: TaskCommentRow }>(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: `Sent "${s.docTitle}" for signature to ${s.signerName} <${s.signerEmail}>. The signed copy lands in this conversation when it is done.`,
          sessionId: s.id,
        }),
      })
      setComments((prev) => [...(prev || []), cres.comment])
      onCommentCountChange(task.id, (comments?.length || 0) + 1)
      setSignOpen(false)
      setSignName('')
      setSignEmail('')
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : 'Could not send for signing.')
    } finally {
      setSignBusy(false)
    }
  }

  return (
    <Card className={task.status === 'DONE' ? 'opacity-60' : ''}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onToggle(task)}
            className={`h-5 w-5 rounded-md border-2 flex items-center justify-center shrink-0 transition ${
              task.status === 'DONE' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-500 hover:border-brand'
            }`}
            aria-label={task.status === 'DONE' ? 'Mark as not done' : 'Mark as done'}
          >
            {task.status === 'DONE' && '✓'}
          </button>
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); saveTitle() }
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
                className="h-7 text-sm font-medium"
                aria-label="Task title"
              />
            ) : (
              <div
                className={`text-sm font-medium cursor-text hover:bg-white/5 rounded px-1 -mx-1 transition ${task.status === 'DONE' ? 'line-through' : ''}`}
                title="Click to rename"
                onClick={() => { setTitleDraft(task.title); setEditingTitle(true) }}
              >
                {savingTitle ? <Loader2 className="inline h-3 w-3 animate-spin" /> : task.title}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
              {due && (
                <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-500 font-medium' : ''}`}>
                  <CalendarDays className="h-3 w-3" />
                  {due.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                  {hasTime && ` · ${due.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`}
                </span>
              )}
              {task.priority === 'HIGH' && <Badge variant="destructive" className="text-[10px] h-4">High</Badge>}
              {task.priority === 'LOW' && <Badge variant="secondary" className="text-[10px] h-4">Low</Badge>}
              {task.team && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {task.team.name}</span>}
              {task.deal && (
                <span className="inline-flex items-center gap-1 text-brand" title={`Deal: ${task.deal.title}`}>
                  <Handshake className="h-3 w-3" /> {task.deal.title}
                </span>
              )}
              {!task.team && !task.isPrivate && <Badge variant="secondary" className="text-[10px] h-4">Business</Badge>}
              {task.isPrivate && <span className="text-[10px]">🔒 private</span>}
              {task.assignee && task.assignee.id !== currentUserId && <span>→ {task.assignee.name}</span>}
              {task.creatorId !== currentUserId && task.assignee?.id === currentUserId && <span>from {task.creator.name}</span>}
              {/* Accountability at a glance: the record shows exactly when it was opened */}
              {task._openedAt && (
                <span className="inline-flex items-center gap-1 text-emerald-500" title={`First opened ${new Date(task._openedAt).toLocaleString('en-ZA')}`}>
                  <ShieldCheck className="h-3 w-3" /> Opened
                </span>
              )}
            </div>
            {/* The brief: what done looks like, in the writer's own words */}
            {task.notes && (
              <div className="mt-1">
                <button
                  onClick={() => setDescOpen((v) => !v)}
                  className={`text-xs text-left whitespace-pre-wrap break-words text-muted-foreground ${descOpen ? '' : 'line-clamp-2'}`}
                  aria-expanded={descOpen}
                >
                  {task.notes}
                </button>
                {!descOpen && task.notes.length > 120 && (
                  <button onClick={() => setDescOpen(true)} className="text-[11px] text-brand mt-0.5">Show more</button>
                )}
              </div>
            )}
          </div>
          {/* Conversations: the team's discussion happens IN context — updates,
              urgent alerts that email everyone, attachments, signature cards */}
          <button
            onClick={openThread}
            className={`flex items-center gap-1 rounded-full border px-2.5 min-h-[32px] text-xs shrink-0 transition ${
              threadOpen || commentCount > 0
                ? 'border-brand/50 text-brand bg-brand/5'
                : 'border-stone-600/60 text-muted-foreground hover:border-brand hover:text-brand'
            }`}
            aria-label={threadOpen ? 'Hide conversation' : `Conversations, ${commentCount} message${commentCount === 1 ? '' : 's'}`}
            aria-expanded={threadOpen}
            title="Conversations: discuss, attach, mark urgent, send for signature"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {commentCount > 0 && <span>{commentCount}</span>}
            {threadOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {/* The sealed record, sent, opened, done: who did what, and exactly when */}
          <button
            onClick={openRecord}
            className={`flex items-center gap-1 rounded-full border px-2.5 min-h-[32px] text-xs shrink-0 transition ${
              recordOpen
                ? 'border-emerald-500/50 text-emerald-500 bg-emerald-500/5'
                : 'border-stone-600/60 text-muted-foreground hover:border-emerald-500 hover:text-emerald-500'
            }`}
            aria-label={recordOpen ? 'Hide record' : 'Sealed record'}
            aria-expanded={recordOpen}
            title="Sealed record: who sent it, who opened it, when"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {recordOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {/* Deal room: documents + e-sign invites on this task */}
          <button
            onClick={() => setFilesOpen((v) => !v)}
            className={`flex items-center gap-1 rounded-full border px-2.5 min-h-[32px] text-xs shrink-0 transition ${
              filesOpen || (task._count?.docs || 0) > 0
                ? 'border-brand/50 text-brand bg-brand/5'
                : 'border-stone-600/60 text-muted-foreground hover:border-brand hover:text-brand'
            }`}
            aria-label={filesOpen ? 'Hide documents' : 'Documents'}
            aria-expanded={filesOpen}
            title="Documents & signatures on this task"
          >
            <Paperclip className="h-3.5 w-3.5" />
            {(task._count?.docs || 0) > 0 && <span>{task._count?.docs}</span>}
            {filesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {/* Send to teammate: one tap forward, the inbox announcement rides along */}
          {task.creatorId === currentUserId && teammates.length > 0 && (
            <button
              onClick={() => setSendOpen((v) => !v)}
              className={`flex items-center gap-1 rounded-full border px-2.5 min-h-[32px] text-xs shrink-0 transition ${
                sendOpen
                  ? 'border-brand/50 text-brand bg-brand/5'
                  : 'border-stone-600/60 text-muted-foreground hover:border-brand hover:text-brand'
              }`}
              aria-label={sendOpen ? 'Hide send options' : 'Send to a teammate'}
              aria-expanded={sendOpen}
              title="Send to a teammate: the task moves onto your shared team and lands on their list"
            >
              <SendHorizontal className="h-3.5 w-3.5" />
              {sendOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
          <Button variant="ghost" size="icon" onClick={() => onRemove(task)} className="text-muted-foreground hover:text-red-600 shrink-0">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {sendOpen && (
          <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Send this task to</span>
            <Select value={sendTo} onValueChange={setSendTo}>
              <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Pick a teammate">
                <SelectValue placeholder="Pick a teammate" />
              </SelectTrigger>
              <SelectContent>
                {teammates.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8" onClick={sendTask} disabled={!sendTo || sending}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
              Send
            </Button>
            <span className="text-[11px] text-muted-foreground">It moves onto your shared team — it stays on your list too.</span>
          </div>
        )}

        {threadOpen && (
          <div className="mt-3 border-t pt-3 space-y-2.5">
            {loadingComments ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading conversation…
              </div>
            ) : !comments || comments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No messages yet — start the conversation. Everyone on this task sees it here, in
                context; mark a message urgent to email the whole team at once.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto hp-scroll pr-1">
                {comments.map((c) => {
                  const mine = c.userId === currentUserId
                  return (
                    <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                          c.urgent
                            ? 'bg-red-500/10 border border-red-500/40'
                            : mine
                              ? 'bg-brand/15 border border-brand/30'
                              : 'bg-white/5 border'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className={`text-[11px] font-medium ${mine ? 'text-brand' : 'text-foreground'}`}>
                            {mine ? 'You' : c.user.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(c.createdAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {c.urgent && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-500 text-[10px] font-bold px-2 py-0.5">
                              <AlertTriangle className="h-3 w-3" /> URGENT
                            </span>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap break-words">{renderBody(c.body)}</p>
                        {c.docs.length > 0 && (
                          <div className="mt-1.5 space-y-1">
                            {c.docs.map((d) => (
                              <a
                                key={d.id}
                                href={`/api/docs/${d.id}/file`}
                                title="Download the attachment"
                                className="flex items-center gap-1.5 text-xs text-brand underline"
                              >
                                <Download className="h-3 w-3 shrink-0" />
                                <span className="truncate">{d.filename}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {d.size < 1024 * 1024 ? `${(d.size / 1024).toFixed(0)} KB` : `${(d.size / (1024 * 1024)).toFixed(1)} MB`}
                                </span>
                              </a>
                            ))}
                          </div>
                        )}
                        {c.session && (
                          <div className="mt-2 rounded-lg border bg-card p-2 space-y-1">
                            <p className="text-xs font-medium flex items-center gap-1.5">
                              <FileSignature className="h-3.5 w-3.5 text-brand shrink-0" />
                              <span className="truncate">Signing: {c.session.docTitle}</span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              for {c.session.signerName} ({c.session.signerEmail})
                            </p>
                            {c.session.status === 'SIGNED' ? (
                              <div className="flex items-center gap-2 text-[11px] flex-wrap">
                                <span className="rounded-full bg-emerald-500/15 text-emerald-500 font-bold px-2 py-0.5 text-[10px]">
                                  SIGNED
                                </span>
                                <a href={`/api/sign/${c.session.token}/file`} className="text-brand underline">
                                  Download signed copy
                                </a>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-[11px] flex-wrap">
                                <span className={`rounded-full px-2 py-0.5 font-bold text-[10px] ${c.session.status === 'VIEWED' ? 'bg-sky-500/15 text-sky-500' : 'bg-amber-500/15 text-amber-500'}`}>
                                  {c.session.status}
                                </span>
                                <a href={`/sign/${c.session.token}`} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                                  Open signing page
                                </a>
                              </div>
                            )}
                          </div>
                        )}
                        {c.copiedEmails && (
                          <p className="text-[10px] text-muted-foreground mt-1">Copied: {c.copiedEmails}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {mention && mentionList.length > 0 && (
              <div className="rounded-lg border bg-card shadow-lg overflow-hidden">
                {mentionList.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${i === mentionIdx ? 'bg-brand/10' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); pickMention(m) }}
                    onMouseEnter={() => setMentionIdx(i)}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground">{m.email}</span>
                  </button>
                ))}
                <p className="px-3 py-1 text-[10px] text-muted-foreground border-t">Tag by name or email. A tagged teammate gets a mail about this task.</p>
              </div>
            )}
            {threadError && (
              <p className="text-xs text-red-500">{threadError}</p>
            )}
            {attached.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attached.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] max-w-full">
                    <Paperclip className="h-3 w-3 text-brand shrink-0" />
                    <span className="truncate max-w-[12rem]">{a.filename}</span>
                    <button
                      onClick={() => setAttached((p) => p.filter((x) => x.id !== a.id))}
                      aria-label={`Remove ${a.filename} from this message`}
                      className="text-muted-foreground hover:text-red-500 shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {signOpen && (
              <div className="rounded-lg border bg-muted/20 p-2.5 space-y-2">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <FileSignature className="h-3.5 w-3.5 text-brand" /> Send a document for signature
                </p>
                {signDocs === null ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : signDocs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    No documents on this task yet — attach one with the paperclip first, then send it for signing.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={signDocId}
                      onChange={(e) => setSignDocId(e.target.value)}
                      className="w-full h-8 rounded-lg border bg-card px-2 text-xs"
                      aria-label="Document to sign"
                    >
                      {signDocs.map((d) => (
                        <option key={d.id} value={d.id}>{d.filename}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <Input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Signer name" className="h-8 text-xs" />
                      <Input value={signEmail} onChange={(e) => setSignEmail(e.target.value)} placeholder="Signer email" type="email" className="h-8 text-xs" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button onClick={sendForSigning} disabled={signBusy || !signDocId || !signName.trim() || !signEmail.trim()} size="sm" className="h-7 text-xs">
                        {signBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3 w-3 mr-1" />} Send for signature
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSignOpen(false)}>Cancel</Button>
                      <span className="text-[10px] text-muted-foreground">The signer gets an email with their signing page.</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {urgent && (
              <div className="space-y-1">
                <Input
                  value={copied}
                  onChange={(e) => setCopied(e.target.value)}
                  placeholder="Copy others (comma-separated emails, optional)"
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-red-500">
                  URGENT emails everyone on this task&apos;s team plus anyone copied here the moment you send.
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                onKeyDown={(e) => {
                  if (mention && mentionList.length > 0) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionList.length); return }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionList.length) % mentionList.length); return }
                    if (e.key === 'Enter') { e.preventDefault(); pickMention(mentionList[Math.min(mentionIdx, mentionList.length - 1)]); return }
                    if (e.key === 'Escape') { setMention(null); return }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postComment() }
                }}
                placeholder={urgent ? 'Write the urgent update…' : 'Message the team… type @ to tag a teammate'}
                className="flex-1"
              />
              <input
                ref={attachRef}
                type="file"
                accept="application/pdf,.pdf,.docx,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && attachDoc(e.target.files[0])}
              />
              <Button
                onClick={() => attachRef.current?.click()}
                disabled={attachBusy}
                size="icon"
                variant="ghost"
                className="shrink-0 text-muted-foreground hover:text-brand"
                aria-label="Attach a document"
                title="Attach a document"
              >
                {attachBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
              <Button
                onClick={() => setUrgent((v) => !v)}
                size="icon"
                variant="ghost"
                className={`shrink-0 ${urgent ? 'text-red-500 bg-red-500/10' : 'text-muted-foreground hover:text-red-500'}`}
                aria-label={urgent ? 'Urgent is on — click to send normally' : 'Mark this message urgent'}
                aria-pressed={urgent}
                title="Mark urgent — emails the whole team the moment you send"
              >
                <AlertTriangle className="h-4 w-4" />
              </Button>
              <Button
                onClick={openSignForm}
                size="icon"
                variant="ghost"
                className={`shrink-0 ${signOpen ? 'text-brand bg-brand/10' : 'text-muted-foreground hover:text-brand'}`}
                aria-label="Send a document for signature"
                aria-expanded={signOpen}
                title="Send a document for signature"
              >
                <FileSignature className="h-4 w-4" />
              </Button>
              <Button onClick={postComment} disabled={posting || !draft.trim()} size="icon" className="shrink-0" aria-label="Send message">
                {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}

        {recordOpen && (
          <div className="mt-3 border-t pt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <ShieldCheck className={`h-3.5 w-3.5 ${record?.verified ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                Sealed record
                {record && (
                  <span className={record.verified ? 'text-emerald-500' : 'text-amber-500'}>
                    {record.verified ? '· verified' : '· checking'}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground">Every entry is timestamped and sealed in order</span>
            </div>
            {loadingRecord ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening the record…
              </div>
            ) : !record || record.events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing sealed yet. The moment this task is sent, opened or moved, it lands here with the exact time.
              </p>
            ) : (
              <div className="space-y-1.5">
                {record.events.map((e) => (
                  <div key={e.id} className="flex items-start gap-2 text-xs">
                    <Clock className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{e.actorName}</span>{' '}
                      <span className="text-muted-foreground">{e.detail}</span>{' '}
                      <span className="text-muted-foreground/70">
                        {new Date(e.createdAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <span className="font-mono text-[9px] text-muted-foreground/50 shrink-0 mt-0.5" title={`Seal ${e.hash.slice(0, 16)}…`}>
                      #{e.hash.slice(0, 6)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {filesOpen && (
          <div className="mt-3 border-t pt-3">
            <DocPanel taskId={task.id} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
