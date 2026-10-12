'use client'

import { EmptyState, ErrorState, LoadingRows, StatusBadge, daysUntil, fmtDate } from '@/components/hustle/kit'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiFetch, useResource } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { CalendarDays, KanbanSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

type Task = {
  id: string; title: string; notes: string | null; status: string; priority: string
  dueDate: string | null; completed: string | null
  client: { id: string; name: string } | null
  project: { id: string; name: string } | null
}

type ClientOption = { id: string; name: string }
type ProjectOption = { id: string; name: string }

const COLUMNS = [
  { key: 'TODO', label: 'To do' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'DONE', label: 'Done' },
] as const

const EMPTY = { title: '', notes: '', status: 'TODO', priority: 'MEDIUM', dueDate: '', clientId: 'none', projectId: 'none' }

export function TasksView() {
  const tasksRes = useResource<Task[]>('/api/tasks')
  const clientsRes = useResource<ClientOption[]>('/api/clients')
  const projectsRes = useResource<ProjectOption[]>('/api/projects')
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  function startCreate(status = 'TODO') {
    setEditing(null)
    setForm({ ...EMPTY, status })
    setOpen(true)
  }

  function startEdit(t: Task) {
    setEditing(t)
    setForm({
      title: t.title, notes: t.notes ?? '', status: t.status, priority: t.priority,
      dueDate: t.dueDate ? t.dueDate.slice(0, 10) : '',
      clientId: t.client?.id ?? 'none', projectId: t.project?.id ?? 'none',
    })
    setOpen(true)
  }

  async function save() {
    if (!form.title.trim()) {
      toast({ title: 'Task title is required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await apiFetch(editing ? `/api/tasks/${editing.id}` : '/api/tasks', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          notes: form.notes || null,
          dueDate: form.dueDate || null,
          clientId: form.clientId === 'none' ? null : form.clientId,
          projectId: form.projectId === 'none' ? null : form.projectId,
        }),
      })
      toast({ title: editing ? 'Task updated' : 'Task added', description: form.title })
      setOpen(false)
      tasksRes.refresh()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function move(t: Task, status: string) {
    try {
      await apiFetch(`/api/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      tasksRes.refresh()
    } catch (e) {
      toast({ title: 'Move failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  async function remove(t: Task) {
    if (!confirm(`Delete task "${t.title}"?`)) return
    try {
      await apiFetch(`/api/tasks/${t.id}`, { method: 'DELETE' })
      toast({ title: 'Task deleted' })
      tasksRes.refresh()
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const byColumn = (key: string) => (tasksRes.data ?? []).filter((t) => t.status === key)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {(tasksRes.data ?? []).filter((t) => t.status !== 'DONE').length} open · {(tasksRes.data ?? []).filter((t) => t.status === 'DONE').length} done
        </span>
        <Button onClick={() => startCreate()}><Plus className="mr-1.5 h-4 w-4" aria-hidden /> New task</Button>
      </div>

      {tasksRes.loading ? <LoadingRows rows={6} /> : tasksRes.error ? (
        <ErrorState message={tasksRes.error} onRetry={tasksRes.refresh} />
      ) : (tasksRes.data?.length ?? 0) === 0 ? (
        <EmptyState icon={KanbanSquare} title="No tasks yet" hint="Break the hustle into next actions and move them across the board." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const tasks = byColumn(col.key)
            return (
              <Card key={col.key} className="flex flex-col bg-muted/40">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span>{col.label}</span>
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{tasks.length}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-[65vh] space-y-2 overflow-y-auto">
                  {tasks.length === 0 ? (
                    <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">Nothing here</p>
                  ) : (
                    tasks.map((t) => {
                      const due = daysUntil(t.dueDate)
                      return (
                        <div key={t.id} className="rounded-lg border bg-card p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn('text-sm font-medium leading-snug', t.status === 'DONE' && 'text-muted-foreground line-through')}>{t.title}</p>
                            <StatusBadge status={t.priority} />
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {t.dueDate ? (
                              <span className={cn('flex items-center gap-1', t.status !== 'DONE' && due !== null && due < 0 && 'font-medium text-rose-600 dark:text-rose-400')}>
                                <CalendarDays className="h-3 w-3" aria-hidden />
                                {due !== null && due < 0 && t.status !== 'DONE' ? `${fmtDate(t.dueDate)} (overdue)` : fmtDate(t.dueDate)}
                              </span>
                            ) : null}
                            {t.client ? <span>· {t.client.name}</span> : null}
                            {t.project ? <span>· {t.project.name}</span> : null}
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex gap-1">
                              {t.status !== 'TODO' && t.status !== 'DONE' ? (
                                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => move(t, 'TODO')}>← To do</Button>
                              ) : null}
                              {t.status !== 'IN_PROGRESS' ? (
                                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => move(t, 'IN_PROGRESS')}>
                                  {t.status === 'DONE' ? '↺ Reopen' : '→ Doing'}
                                </Button>
                              ) : null}
                              {t.status !== 'DONE' ? (
                                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => move(t, 'DONE')}>✓ Done</Button>
                              ) : null}
                            </div>
                            <div className="flex gap-0.5">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(t)} aria-label={`Edit ${t.title}`}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600" onClick={() => remove(t)} aria-label={`Delete ${t.title}`}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit task' : 'New task'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="t-title">Title *</Label>
              <Input id="t-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Send proposal to…" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODO">To do</SelectItem>
                    <SelectItem value="IN_PROGRESS">In progress</SelectItem>
                    <SelectItem value="DONE">Done</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="t-due">Due date</Label>
                <Input id="t-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Client</Label>
                <Select value={form.clientId} onValueChange={(v) => setForm({ ...form, clientId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No client</SelectItem>
                    {(clientsRes.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Project</Label>
                <Select value={form.projectId} onValueChange={(v) => setForm({ ...form, projectId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {(projectsRes.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-notes">Notes</Label>
              <Textarea id="t-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add task'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
