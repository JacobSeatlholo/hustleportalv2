'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api, PRIORITIES, type Task } from './shared'
import { useHp } from './store'
import { Plus, Trash2, Loader2, CalendarDays, Users, User as UserIcon } from 'lucide-react'

export default function TasksView() {
  const { session, bumpRefresh } = useHp()
  const { toast } = useToast()
  const [scope, setScope] = useState<'mine' | 'team'>('mine')
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState(session?.user.id || 'me')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState('MEDIUM')
  const [isPrivate, setIsPrivate] = useState(false)
  const [teamId, setTeamId] = useState<string>('personal')
  const [teams, setTeams] = useState<{ id: string; name: string; members: { id: string; name: string }[] }[]>([])
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await api<{ tasks: Task[] }>(`/api/tasks?scope=${scope}`)
      setTasks(res.tasks)
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
      const isTeam = teamId !== 'personal'
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          priority,
          dueDate: dueDate || null,
          isPrivate: !isTeam && isPrivate,
          teamId: isTeam ? teamId : null,
          assigneeId: isTeam && assigneeId !== 'me' ? assigneeId : session?.user.id,
        }),
      })
      setTitle('')
      setDueDate('')
      toast({ title: isTeam ? 'Shared with the team' : 'Task added' })
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
  const teamMembers = teams.find((t) => t.id === teamId)?.members || []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Tasks</h1>
          <p className="text-sm text-muted-foreground">{open.length} open · {done.length} done</p>
        </div>
        <Tabs value={scope} onValueChange={(v) => setScope(v as 'mine' | 'team')}>
          <TabsList>
            <TabsTrigger value="mine" className="gap-1"><UserIcon className="h-3.5 w-3.5" /> My tasks</TabsTrigger>
            <TabsTrigger value="team" className="gap-1" disabled={!session?.team}><Users className="h-3.5 w-3.5" /> Team tasks</TabsTrigger>
          </TabsList>
        </Tabs>
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
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
              placeholder="Add a task… e.g. Follow up with Nkosi Brands"
              className="flex-1 min-w-[160px]"
            />
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">Personal</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {teamId !== 'personal' && (
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
            {teamId === 'personal' && (
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground px-1">
                <Checkbox checked={isPrivate} onCheckedChange={(c) => setIsPrivate(c === true)} /> Private
              </label>
            )}
            <Button onClick={addTask} disabled={adding || !title.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lists */}
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
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
            <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} currentUserId={session?.user.id || ''} />
          ))}
          {done.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Completed</p>
              <div className="space-y-2">
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} currentUserId={session?.user.id || ''} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TaskRow({ task, onToggle, onRemove, currentUserId }: {
  task: Task
  onToggle: (t: Task) => void
  onRemove: (t: Task) => void
  currentUserId: string
}) {
  const overdue = task.dueDate && task.status !== 'DONE' && new Date(task.dueDate) < new Date()
  return (
    <Card className={task.status === 'DONE' ? 'opacity-60' : ''}>
      <CardContent className="p-3 flex items-center gap-3">
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
            {task.dueDate && (
              <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-500 font-medium' : ''}`}>
                <CalendarDays className="h-3 w-3" />
                {new Date(task.dueDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
              </span>
            )}
            {task.priority === 'HIGH' && <Badge variant="destructive" className="text-[10px] h-4">High</Badge>}
            {task.priority === 'LOW' && <Badge variant="secondary" className="text-[10px] h-4">Low</Badge>}
            {task.team && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {task.team.name}</span>}
            {task.isPrivate && <span className="text-[10px]">🔒 private</span>}
            {task.assignee && task.assignee.id !== currentUserId && <span>→ {task.assignee.name}</span>}
            {task.creatorId !== currentUserId && task.assignee?.id === currentUserId && <span>from {task.creator.name}</span>}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onRemove(task)} className="text-muted-foreground hover:text-red-600 shrink-0">
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}
