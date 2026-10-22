'use client'

import { useEffect, useState } from 'react'
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
import { useVoiceInput } from './useVoiceInput'
import { Plus, Trash2, Loader2, CalendarDays, Users, User as UserIcon, NotebookPen, MessageSquare, SendHorizontal, ChevronDown, ChevronUp, ShieldCheck, Clock, Mic, MicOff, AlignLeft } from 'lucide-react'

export default function TasksView() {
  const { session, bumpRefresh } = useHp()
  const { toast } = useToast()
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
  const [teams, setTeams] = useState<{ id: string; name: string; members: { id: string; name: string }[] }[]>([])
  const [adding, setAdding] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)

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

  const open = tasks.filter((t) => t.status !== 'DONE')
  const done = tasks.filter((t) => t.status === 'DONE')
  const teamMembers = teams.find((t) => t.id === dest)?.members || []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Tasks</h1>
          <p className="text-sm text-muted-foreground">{open.length} open · {done.length} done</p>
        </div>
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

      {/* Lists */}
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : (
        <div className="space-y-2">
          {open.length === 0 && done.length === 0 && (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                No tasks yet. Add your first task above and start earning XP. 💪
              </CardContent>
            </Card>
          )}
          {open.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} onCommentCountChange={(id, n) => setCounts((c) => ({ ...c, [id]: n }))} currentUserId={session?.user.id || ''} />
          ))}
          {done.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Completed</p>
              <div className="space-y-2">
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} onCommentCountChange={(id, n) => setCounts((c) => ({ ...c, [id]: n }))} currentUserId={session?.user.id || ''} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <ScanDiaryDialog open={scanOpen} onOpenChange={setScanOpen} onDone={() => load()} />
    </div>
  )
}

function TaskRow({ task, onToggle, onRemove, onCommentCountChange, currentUserId }: {
  task: Task
  onToggle: (t: Task) => void
  onRemove: (t: Task) => void
  onCommentCountChange: (taskId: string, count: number) => void
  currentUserId: string
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

  const commentCount = comments ? comments.length : task._count?.comments || 0

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
    try {
      const res = await api<{ comment: TaskCommentRow }>(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      setComments((prev) => [...(prev || []), res.comment])
      onCommentCountChange(task.id, (comments?.length || 0) + 1)
      setDraft('')
    } catch {
      // non-fatal, the draft stays in the input
    } finally {
      setPosting(false)
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
            <div className={`text-sm font-medium ${task.status === 'DONE' ? 'line-through' : ''}`}>{task.title}</div>
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
          {/* Team discussion, comments happen IN context, not in a WhatsApp group */}
          <button
            onClick={openThread}
            className={`flex items-center gap-1 rounded-full border px-2.5 min-h-[32px] text-xs shrink-0 transition ${
              threadOpen || commentCount > 0
                ? 'border-brand/50 text-brand bg-brand/5'
                : 'border-stone-600/60 text-muted-foreground hover:border-brand hover:text-brand'
            }`}
            aria-label={threadOpen ? 'Hide discussion' : `Discussion, ${commentCount} comment${commentCount === 1 ? '' : 's'}`}
            aria-expanded={threadOpen}
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
          <Button variant="ghost" size="icon" onClick={() => onRemove(task)} className="text-muted-foreground hover:text-red-600 shrink-0">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {threadOpen && (
          <div className="mt-3 border-t pt-3 space-y-2.5">
            {loadingComments ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading discussion…
              </div>
            ) : !comments || comments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No comments yet, start the discussion. Everyone on this task sees it here, in context.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto hp-scroll pr-1">
                {comments.map((c) => {
                  const mine = c.userId === currentUserId
                  return (
                    <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                          mine ? 'bg-brand/15 border border-brand/30' : 'bg-white/5 border'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[11px] font-medium ${mine ? 'text-brand' : 'text-foreground'}`}>
                            {mine ? 'You' : c.user.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(c.createdAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap break-words">{c.body}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postComment() } }}
                placeholder="Add a comment… e.g. Quoted them R1 200, waiting for Friday"
                className="flex-1"
              />
              <Button onClick={postComment} disabled={posting || !draft.trim()} size="icon" className="shrink-0" aria-label="Send comment">
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
      </CardContent>
    </Card>
  )
}
