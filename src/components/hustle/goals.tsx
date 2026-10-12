'use client'

import { EmptyState, ErrorState, LoadingRows, fmtMoney } from '@/components/hustle/kit'
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
import { useToast } from '@/hooks/use-toast'
import { apiFetch, useResource } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { CheckCircle2, Minus, Plus, Target, Trash2, Trophy } from 'lucide-react'
import { useState } from 'react'

type Goal = {
  id: string; title: string; metric: string; targetValue: number; currentValue: number
  period: string; status: string; deadline: string | null
}

const EMPTY = { title: '', metric: 'REVENUE', targetValue: '', currentValue: '0', period: 'MONTHLY', deadline: '' }

export function GoalsView({ currency }: { currency: string }) {
  const goalsRes = useResource<Goal[]>('/api/goals')
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  function isMoney(g: Goal) {
    return g.metric === 'REVENUE'
  }
  function fmtVal(g: Goal, v: number) {
    return isMoney(g) ? fmtMoney(v, currency) : String(Math.round(v * 10) / 10)
  }

  async function save() {
    if (!form.title.trim()) {
      toast({ title: 'Goal title is required', variant: 'destructive' })
      return
    }
    const target = Number(form.targetValue)
    if (!target || target <= 0) {
      toast({ title: 'Enter a target value', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await apiFetch('/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title, metric: form.metric, period: form.period,
          targetValue: target, currentValue: Number(form.currentValue) || 0,
          deadline: form.deadline || null,
        }),
      })
      toast({ title: 'Goal created', description: form.title })
      setOpen(false)
      goalsRes.refresh()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function bump(g: Goal, delta: number) {
    const next = Math.max(0, g.currentValue + delta)
    try {
      await apiFetch(`/api/goals/${g.id}`, { method: 'PATCH', body: JSON.stringify({ currentValue: next }) })
      goalsRes.refresh()
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  async function setStatus(g: Goal, status: string) {
    try {
      await apiFetch(`/api/goals/${g.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      goalsRes.refresh()
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  async function remove(g: Goal) {
    if (!confirm(`Delete goal "${g.title}"?`)) return
    try {
      await apiFetch(`/api/goals/${g.id}`, { method: 'DELETE' })
      toast({ title: 'Goal deleted' })
      goalsRes.refresh()
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const step = (g: Goal) => (g.targetValue >= 1000 ? Math.round(g.targetValue / 20) : g.metric === 'REVENUE' ? 100 : g.metric === 'HOURS' ? 5 : 1)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {(goalsRes.data ?? []).filter((g) => g.status === 'ACTIVE').length} active · {(goalsRes.data ?? []).filter((g) => g.status === 'ACHIEVED').length} achieved
        </span>
        <Button onClick={() => { setForm({ ...EMPTY }); setOpen(true) }}><Plus className="mr-1.5 h-4 w-4" aria-hidden /> New goal</Button>
      </div>

      {goalsRes.loading ? <LoadingRows rows={4} /> : goalsRes.error ? (
        <ErrorState message={goalsRes.error} onRetry={goalsRes.refresh} />
      ) : (goalsRes.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Target} title="No goals yet" hint="Set revenue, client or hours targets and track progress against them." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goalsRes.data!.map((g) => {
            const pct = g.targetValue > 0 ? Math.min(100, Math.round((g.currentValue / g.targetValue) * 100)) : 0
            const achieved = g.status === 'ACHIEVED' || pct >= 100
            return (
              <Card key={g.id} className={cn(achieved && 'border-emerald-300 dark:border-emerald-800')}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {achieved ? <Trophy className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <Target className="h-4 w-4 text-muted-foreground" aria-hidden />}
                      {g.title}
                    </CardTitle>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => bump(g, step(g))} aria-label={`Increase ${g.title}`}>
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => bump(g, -step(g))} aria-label={`Decrease ${g.title}`}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600" onClick={() => remove(g)} aria-label={`Delete ${g.title}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs capitalize text-muted-foreground">{g.metric.toLowerCase()} · {g.period.toLowerCase()}{g.deadline ? ` · due ${new Date(g.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold tabular-nums">{fmtVal(g, g.currentValue)}</span>
                    <span className="text-muted-foreground tabular-nums">of {fmtVal(g, g.targetValue)}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full transition-all', achieved ? 'bg-emerald-500' : 'bg-amber-500')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className={cn('text-xs tabular-nums', achieved ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{pct}% {achieved ? '— achieved!' : ''}</p>
                    {g.status === 'ACTIVE' && pct >= 100 ? (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatus(g, 'ACHIEVED')}>
                        <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> Mark achieved
                      </Button>
                    ) : null}
                    {g.status === 'ACHIEVED' ? (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatus(g, 'ACTIVE')}>Set active</Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader><DialogTitle>New goal</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="g-title">Title *</Label>
              <Input id="g-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Monthly revenue, new clients…" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Metric</Label>
                <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REVENUE">Revenue</SelectItem>
                    <SelectItem value="CLIENTS">Clients</SelectItem>
                    <SelectItem value="INVOICES">Invoices paid</SelectItem>
                    <SelectItem value="HOURS">Billable hours</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Period</Label>
                <Select value={form.period} onValueChange={(v) => setForm({ ...form, period: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                    <SelectItem value="YEARLY">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="g-target">Target value *</Label>
                <Input id="g-target" type="number" min="0" step="0.1" value={form.targetValue} onChange={(e) => setForm({ ...form, targetValue: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="g-deadline">Deadline</Label>
                <Input id="g-deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create goal'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
