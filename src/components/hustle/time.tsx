'use client'

import { EmptyState, ErrorState, LoadingRows, fmtDate, fmtHours, fmtMoney } from '@/components/hustle/kit'
import { Badge } from '@/components/ui/badge'
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
import { Switch } from '@/components/ui/switch'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { apiFetch, useResource } from '@/lib/hooks'
import { Clock3, Plus, Timer, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

type Entry = {
  id: string; description: string; minutes: number; billable: boolean
  hourlyRate: number; date: string
  client: { id: string; name: string } | null
  project: { id: string; name: string } | null
}

const EMPTY = { description: '', minutes: '60', hourlyRate: '', billable: true, date: '', clientId: 'none', projectId: 'none' }

export function TimeView({ currency }: { currency: string }) {
  const entriesRes = useResource<Entry[]>('/api/time-entries')
  const clientsRes = useResource<{ id: string; name: string }[]>('/api/clients')
  const projectsRes = useResource<{ id: string; name: string }[]>('/api/projects')
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  const stats = useMemo(() => {
    const entries = entriesRes.data ?? []
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())
    weekStart.setHours(0, 0, 0, 0)
    const thisWeek = entries.filter((e) => new Date(e.date) >= weekStart)
    const weekMinutes = thisWeek.reduce((s, e) => s + e.minutes, 0)
    const billableValue = entries.filter((e) => e.billable).reduce((s, e) => s + (e.minutes / 60) * e.hourlyRate, 0)
    return { weekMinutes, weekCount: thisWeek.length, billableValue }
  }, [entriesRes.data])

  async function save() {
    if (!form.description.trim()) {
      toast({ title: 'Description is required', variant: 'destructive' })
      return
    }
    const minutes = Number(form.minutes)
    if (!minutes || minutes <= 0) {
      toast({ title: 'Enter minutes worked', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await apiFetch('/api/time-entries', {
        method: 'POST',
        body: JSON.stringify({
          description: form.description,
          minutes,
          hourlyRate: Number(form.hourlyRate) || 0,
          billable: form.billable,
          date: form.date || undefined,
          clientId: form.clientId === 'none' ? null : form.clientId,
          projectId: form.projectId === 'none' ? null : form.projectId,
        }),
      })
      toast({ title: 'Time logged', description: `${fmtHours(minutes)} — ${form.description}` })
      setOpen(false)
      setForm({ ...EMPTY })
      entriesRes.refresh()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function remove(e: Entry) {
    if (!confirm(`Delete entry "${e.description}"?`)) return
    try {
      await apiFetch(`/api/time-entries/${e.id}`, { method: 'DELETE' })
      toast({ title: 'Entry deleted' })
      entriesRes.refresh()
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="py-4">
          <CardHeader className="pb-1"><CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Timer className="h-3.5 w-3.5" aria-hidden /> This week</CardTitle></CardHeader>
          <CardContent className="px-4"><p className="text-xl font-bold tabular-nums">{fmtHours(stats.weekMinutes)}</p><p className="text-xs text-muted-foreground">{stats.weekCount} entries</p></CardContent>
        </Card>
        <Card className="py-4">
          <CardHeader className="pb-1"><CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock3 className="h-3.5 w-3.5" aria-hidden /> All logged</CardTitle></CardHeader>
          <CardContent className="px-4"><p className="text-xl font-bold tabular-nums">{fmtHours((entriesRes.data ?? []).reduce((s, e) => s + e.minutes, 0))}</p><p className="text-xs text-muted-foreground">{entriesRes.data?.length ?? 0} entries</p></CardContent>
        </Card>
        <Card className="py-4">
          <CardHeader className="pb-1"><CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Timer className="h-3.5 w-3.5" aria-hidden /> Billable value</CardTitle></CardHeader>
          <CardContent className="px-4"><p className="text-xl font-bold tabular-nums">{fmtMoney(stats.billableValue, currency)}</p><p className="text-xs text-muted-foreground">at logged rates</p></CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-end">
        <Button onClick={() => { setForm({ ...EMPTY, date: new Date().toISOString().slice(0, 10) }); setOpen(true) }}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Log time
        </Button>
      </div>

      {entriesRes.loading ? <LoadingRows rows={6} /> : entriesRes.error ? (
        <ErrorState message={entriesRes.error} onRetry={entriesRes.refresh} />
      ) : (entriesRes.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Clock3} title="No time logged" hint="Log billable and non-billable minutes to see where the hours go." />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work</TableHead>
                    <TableHead className="hidden md:table-cell">Client / project</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
                    <TableHead className="w-14 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entriesRes.data!.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <p className="font-medium">{e.description}</p>
                        {e.billable ? (
                          <Badge variant="outline" className="mt-0.5 px-1 py-0 text-[10px]">billable · {fmtMoney(e.hourlyRate, currency)}/h</Badge>
                        ) : (
                          <Badge variant="secondary" className="mt-0.5 px-1 py-0 text-[10px]">non-billable</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {e.client?.name ?? e.project?.name ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{fmtDate(e.date)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fmtHours(e.minutes)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {e.billable ? fmtMoney((e.minutes / 60) * e.hourlyRate, currency) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" onClick={() => remove(e)} aria-label={`Delete ${e.description}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader><DialogTitle>Log time</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="tm-desc">What did you work on? *</Label>
              <Input id="tm-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Homepage build, client call…" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="tm-min">Minutes *</Label>
                <Input id="tm-min" type="number" min="1" step="5" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tm-date">Date</Label>
                <Input id="tm-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="tm-rate">Hourly rate ({currency})</Label>
                <Input id="tm-rate" type="number" min="0" step="0.01" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} placeholder="50" />
              </div>
              <div className="flex items-end pb-1">
                <div className="flex w-full items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="tm-billable" className="text-sm">Billable</Label>
                  <Switch id="tm-billable" checked={form.billable} onCheckedChange={(v) => setForm({ ...form, billable: v })} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Log time'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
