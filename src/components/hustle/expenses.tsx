'use client'

import { CATEGORIES, EmptyState, ErrorState, LoadingRows, PAY_METHODS, fmtDate, fmtMoney } from '@/components/hustle/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Pencil, Plus, ReceiptText, Repeat, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

type Expense = {
  id: string; description: string; category: string; amount: number
  date: string; vendor: string | null; method: string
  recurring: boolean; billable: boolean; projectId: string | null
  project: { id: string; name: string } | null
}

type ProjectOption = { id: string; name: string }

const EMPTY = { description: '', category: 'SOFTWARE', amount: '', vendor: '', method: 'CARD', date: '', recurring: false, billable: false, projectId: 'none' }

export function ExpensesView({ currency }: { currency: string }) {
  const expensesRes = useResource<Expense[]>('/api/expenses')
  const projectsRes = useResource<ProjectOption[]>('/api/projects')
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState('ALL')
  const [month, setMonth] = useState('ALL')

  const months = useMemo(() => {
    const set = new Set((expensesRes.data ?? []).map((e) => e.date.slice(0, 7)))
    return Array.from(set).sort().reverse()
  }, [expensesRes.data])

  const filtered = useMemo(
    () => (expensesRes.data ?? []).filter((e) =>
      (category === 'ALL' || e.category === category) && (month === 'ALL' || e.date.slice(0, 7) === month)),
    [expensesRes.data, category, month],
  )

  const total = filtered.reduce((s, e) => s + e.amount, 0)
  const recurringTotal = filtered.filter((e) => e.recurring).reduce((s, e) => s + e.amount, 0)

  function startCreate() {
    setEditing(null)
    setForm({ ...EMPTY, date: new Date().toISOString().slice(0, 10) })
    setOpen(true)
  }

  function startEdit(e: Expense) {
    setEditing(e)
    setForm({
      description: e.description, category: e.category, amount: String(e.amount),
      vendor: e.vendor ?? '', method: e.method, date: e.date.slice(0, 10),
      recurring: e.recurring, billable: e.billable, projectId: e.projectId ?? 'none',
    })
    setOpen(true)
  }

  async function save() {
    if (!form.description.trim()) {
      toast({ title: 'Description is required', variant: 'destructive' })
      return
    }
    const amount = Number(form.amount)
    if (!amount || amount <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await apiFetch(editing ? `/api/expenses/${editing.id}` : '/api/expenses', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          amount,
          vendor: form.vendor || null,
          date: form.date || undefined,
          projectId: form.projectId === 'none' ? null : form.projectId,
        }),
      })
      toast({ title: editing ? 'Expense updated' : 'Expense added', description: form.description })
      setOpen(false)
      expensesRes.refresh()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function remove(e: Expense) {
    if (!confirm(`Delete expense "${e.description}"?`)) return
    try {
      await apiFetch(`/api/expenses/${e.id}`, { method: 'DELETE' })
      toast({ title: 'Expense deleted' })
      expensesRes.refresh()
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-40" aria-label="Filter by category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c[0] + c.slice(1).toLowerCase()}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-40" aria-label="Filter by month"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All months</SelectItem>
              {months.map((m) => (
                <SelectItem key={m} value={m}>{new Date(`${m}-02`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="tabular-nums">Shown: {fmtMoney(total, currency)}</Badge>
          <Badge variant="outline" className="tabular-nums">Recurring: {fmtMoney(recurringTotal, currency)}</Badge>
        </div>
        <Button onClick={startCreate}><Plus className="mr-1.5 h-4 w-4" aria-hidden /> New expense</Button>
      </div>

      {expensesRes.loading ? <LoadingRows rows={6} /> : expensesRes.error ? (
        <ErrorState message={expensesRes.error} onRetry={expensesRes.refresh} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No expenses found" hint="Track software, gear, marketing and everything else you spend on the hustle." />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Expense</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead className="hidden lg:table-cell">Project</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <p className="font-medium">{e.description}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {e.vendor ? <span>{e.vendor}</span> : null}
                          <span className="capitalize">{e.method.toLowerCase()}</span>
                          {e.recurring ? (
                            <Badge variant="secondary" className="gap-0.5 px-1 py-0 text-[10px]"><Repeat className="h-2.5 w-2.5" aria-hidden /> recurring</Badge>
                          ) : null}
                          {e.billable ? (
                            <Badge variant="outline" className="px-1 py-0 text-[10px]">billable</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{e.category[0] + e.category.slice(1).toLowerCase()}</TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">{e.project?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{fmtDate(e.date)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">−{fmtMoney(e.amount, currency)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(e)} aria-label={`Edit ${e.description}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => remove(e)} aria-label={`Delete ${e.description}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit expense' : 'New expense'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="e-desc">Description *</Label>
              <Input id="e-desc" value={form.description} onChange={(e2) => setForm({ ...form, description: e2.target.value })} placeholder="Software subscription, gear, ad spend…" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="e-amount">Amount ({currency}) *</Label>
                <Input id="e-amount" type="number" min="0" step="0.01" value={form.amount} onChange={(e2) => setForm({ ...form, amount: e2.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="e-date">Date</Label>
                <Input id="e-date" type="date" value={form.date} onChange={(e2) => setForm({ ...form, date: e2.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c[0] + c.slice(1).toLowerCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Method</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{m[0] + m.slice(1).toLowerCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="e-vendor">Vendor</Label>
                <Input id="e-vendor" value={form.vendor} onChange={(e2) => setForm({ ...form, vendor: e2.target.value })} placeholder="Adobe, Uber…" />
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
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="e-recurring" className="text-sm">Recurring</Label>
                <p className="text-xs text-muted-foreground">Charged every month</p>
              </div>
              <Switch id="e-recurring" checked={form.recurring} onCheckedChange={(v) => setForm({ ...form, recurring: v })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="e-billable" className="text-sm">Billable to client</Label>
                <p className="text-xs text-muted-foreground">Rebill this on an invoice</p>
              </div>
              <Switch id="e-billable" checked={form.billable} onCheckedChange={(v) => setForm({ ...form, billable: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
