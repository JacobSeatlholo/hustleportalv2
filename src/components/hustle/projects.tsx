'use client'

import { EmptyState, ErrorState, LoadingRows, StatusBadge, fmtDate, fmtHours, fmtMoney } from '@/components/hustle/kit'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiFetch, useResource } from '@/lib/hooks'
import { CalendarDays, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

type Project = {
  id: string; name: string; clientId: string | null; status: string
  budget: number; deadline: string | null; createdAt: string
  client: { id: string; name: string; company: string | null } | null
  _count: { tasks: number; expenses: number; timeEntries: number }
  taskDone: number; taskTotal: number; minutes: number; spent: number
}

type ClientOption = { id: string; name: string; company: string | null }

const EMPTY = { name: '', clientId: 'none', status: 'PLANNING', budget: '', deadline: '' }

export function ProjectsView({ currency }: { currency: string }) {
  const projects = useResource<Project[]>('/api/projects')
  const clientsRes = useResource<ClientOption[]>('/api/clients')
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  function startCreate() {
    setEditing(null)
    setForm({ ...EMPTY })
    setOpen(true)
  }

  function startEdit(p: Project) {
    setEditing(p)
    setForm({
      name: p.name,
      clientId: p.clientId ?? 'none',
      status: p.status,
      budget: p.budget ? String(p.budget) : '',
      deadline: p.deadline ? p.deadline.slice(0, 10) : '',
    })
    setOpen(true)
  }

  async function save() {
    if (!form.name.trim()) {
      toast({ title: 'Project name is required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await apiFetch(editing ? `/api/projects/${editing.id}` : '/api/projects', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          clientId: form.clientId === 'none' ? null : form.clientId,
          budget: Number(form.budget) || 0,
          deadline: form.deadline || null,
        }),
      })
      toast({ title: editing ? 'Project updated' : 'Project created', description: form.name })
      setOpen(false)
      projects.refresh()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function remove(p: Project) {
    if (!confirm(`Delete project "${p.name}"?`)) return
    try {
      await apiFetch(`/api/projects/${p.id}`, { method: 'DELETE' })
      toast({ title: 'Project deleted', description: p.name })
      projects.refresh()
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{projects.data?.length ?? 0} projects</span>
        <Button onClick={startCreate}><Plus className="mr-1.5 h-4 w-4" aria-hidden /> New project</Button>
      </div>

      {projects.loading ? <LoadingRows rows={6} /> : projects.error ? (
        <ErrorState message={projects.error} onRetry={projects.refresh} />
      ) : (projects.data?.length ?? 0) === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" hint="Group billable work under a project to track budget, tasks and time." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.data!.map((p) => {
            const taskPct = p.taskTotal > 0 ? Math.round((p.taskDone / p.taskTotal) * 100) : 0
            const budgetPct = p.budget > 0 ? Math.min(100, Math.round((p.spent / p.budget) * 100)) : 0
            return (
              <Card key={p.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{p.name}</CardTitle>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{p.client ? `${p.client.name}${p.client.company ? ` · ${p.client.company}` : ''}` : 'Internal / no client'}</p>
                </CardHeader>
                <CardContent className="mt-auto space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-muted p-2">
                      <p className="text-muted-foreground">Budget</p>
                      <p className="font-semibold tabular-nums">{fmtMoney(p.budget, currency)}</p>
                      {p.budget > 0 ? (
                        <>
                          <Progress value={budgetPct} className="mt-1.5 h-1.5" />
                          <p className="mt-1 text-[10px] text-muted-foreground">{fmtMoney(p.spent, currency)} spent · {budgetPct}%</p>
                        </>
                      ) : (
                        <p className="mt-1 text-[10px] text-muted-foreground">{fmtMoney(p.spent, currency)} spent</p>
                      )}
                    </div>
                    <div className="rounded-lg bg-muted p-2">
                      <p className="text-muted-foreground">Tasks</p>
                      <p className="font-semibold tabular-nums">{p.taskDone}/{p.taskTotal}</p>
                      <Progress value={taskPct} className="mt-1.5 h-1.5" />
                      <p className="mt-1 text-[10px] text-muted-foreground">{fmtHours(p.minutes)} logged</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      {p.deadline ? `Due ${fmtDate(p.deadline)}` : 'No deadline'}
                    </p>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(p)} aria-label={`Edit ${p.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit project' : 'New project'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="p-name">Project name *</Label>
              <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Website rebuild" />
            </div>
            <div className="grid gap-2">
              <Label>Client</Label>
              <Select value={form.clientId} onValueChange={(v) => setForm({ ...form, clientId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No client</SelectItem>
                  {(clientsRes.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLANNING">Planning</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="PAUSED">Paused</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-budget">Budget ({currency})</Label>
                <Input id="p-budget" type="number" min="0" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="1500" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-deadline">Deadline</Label>
              <Input id="p-deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create project'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
