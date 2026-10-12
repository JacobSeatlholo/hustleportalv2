'use client'

import { EmptyState, ErrorState, PAY_METHODS, LoadingRows, StatusBadge, fmtDate, fmtMoney } from '@/components/hustle/kit'
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
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiFetch, useResource } from '@/lib/hooks'
import { Eye, FileText, Plus, Send, Trash2, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'

type Item = { description: string; quantity: number; unitPrice: number }

type Invoice = {
  id: string; number: string; clientId: string | null; status: string
  issueDate: string; dueDate: string | null; taxRate: number; notes: string | null
  client: { id: string; name: string; company: string | null; email: string | null } | null
  items: Item[]
  payments: { id: string; amount: number; method: string; paidAt: string; note: string | null }[]
  totals: { subtotal: number; tax: number; total: number; paid: number; balance: number; itemCount: number }
}

type ClientOption = { id: string; name: string; company: string | null }

const EMPTY_FORM = { clientId: 'none', dueDate: '', taxRate: '0', notes: '' }
const EMPTY_ITEM: Item = { description: '', quantity: 1, unitPrice: 0 }

export function InvoicesView({ currency, defaultTaxRate }: { currency: string; defaultTaxRate: number }) {
  const invoicesRes = useResource<Invoice[]>('/api/invoices')
  const clientsRes = useResource<ClientOption[]>('/api/clients')
  const { toast } = useToast()
  const [filter, setFilter] = useState('ALL')

  // create dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM, taxRate: String(defaultTaxRate) })
  const [items, setItems] = useState<Item[]>([{ ...EMPTY_ITEM }])
  const [saving, setSaving] = useState(false)

  // detail dialog state
  const [detail, setDetail] = useState<Invoice | null>(null)

  // payment dialog state
  const [payFor, setPayFor] = useState<Invoice | null>(null)
  const [payForm, setPayForm] = useState({ amount: '', method: 'BANK', note: '' })
  const [paying, setPaying] = useState(false)

  const filtered = useMemo(
    () => (invoicesRes.data ?? []).filter((i) => filter === 'ALL' || i.status === filter),
    [invoicesRes.data, filter],
  )

  const draftTotal = useMemo(() => {
    const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0)
    return subtotal * (1 + (Number(form.taxRate) || 0) / 100)
  }, [items, form.taxRate])

  function startCreate() {
    setForm({ ...EMPTY_FORM, taxRate: String(defaultTaxRate) })
    setItems([{ ...EMPTY_ITEM }])
    setCreateOpen(true)
  }

  async function createInvoice(status: 'DRAFT' | 'SENT') {
    const clean = items.filter((it) => it.description.trim())
    if (clean.length === 0) {
      toast({ title: 'Add at least one line item', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const created = await apiFetch<Invoice>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          clientId: form.clientId === 'none' ? null : form.clientId,
          dueDate: form.dueDate || null,
          taxRate: Number(form.taxRate) || 0,
          status,
          items: clean,
        }),
      })
      toast({ title: `Invoice ${created.number} created`, description: status === 'SENT' ? 'Marked as sent' : 'Saved as draft' })
      setCreateOpen(false)
      invoicesRes.refresh()
    } catch (e) {
      toast({ title: 'Create failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function patchInvoice(inv: Invoice, data: Record<string, unknown>, okMsg: string) {
    try {
      await apiFetch(`/api/invoices/${inv.id}`, { method: 'PATCH', body: JSON.stringify(data) })
      toast({ title: okMsg })
      setDetail(null)
      invoicesRes.refresh()
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  async function remove(inv: Invoice) {
    if (!confirm(`Delete invoice ${inv.number}?`)) return
    try {
      await apiFetch(`/api/invoices/${inv.id}`, { method: 'DELETE' })
      toast({ title: 'Invoice deleted', description: inv.number })
      invoicesRes.refresh()
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  function openPay(inv: Invoice) {
    setPayFor(inv)
    setPayForm({ amount: String(inv.totals.balance > 0 ? inv.totals.balance : ''), method: 'BANK', note: '' })
  }

  async function recordPayment() {
    if (!payFor) return
    const amount = Number(payForm.amount)
    if (!amount || amount <= 0) {
      toast({ title: 'Enter a payment amount', variant: 'destructive' })
      return
    }
    setPaying(true)
    try {
      await apiFetch('/api/payments', {
        method: 'POST',
        body: JSON.stringify({ invoiceId: payFor.id, amount, method: payForm.method, note: payForm.note || null }),
      })
      toast({ title: 'Payment recorded', description: `${fmtMoney(amount, currency)} on ${payFor.number}` })
      setPayFor(null)
      setDetail(null)
      invoicesRes.refresh()
    } catch (e) {
      toast({ title: 'Payment failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40" aria-label="Filter invoices">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All invoices</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="OVERDUE">Overdue</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{filtered.length} shown</span>
        </div>
        <Button onClick={startCreate}><Plus className="mr-1.5 h-4 w-4" aria-hidden /> New invoice</Button>
      </div>

      {invoicesRes.loading ? <LoadingRows rows={6} /> : invoicesRes.error ? (
        <ErrorState message={invoicesRes.error} onRetry={invoicesRes.refresh} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No invoices here" hint="Create an invoice, send it, and record payments as they land." />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="hidden sm:table-cell">Client</TableHead>
                    <TableHead className="hidden lg:table-cell">Issued</TableHead>
                    <TableHead className="hidden md:table-cell">Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Balance</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.number}</TableCell>
                      <TableCell className="hidden sm:table-cell">{inv.client?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{fmtDate(inv.issueDate)}</TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{fmtDate(inv.dueDate)}</TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(inv.totals.total, currency)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        <span className={inv.totals.balance > 0 && inv.status !== 'DRAFT' ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}>
                          {fmtMoney(inv.totals.balance, currency)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetail(inv)} aria-label={`View ${inv.number}`}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {inv.status === 'DRAFT' ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => patchInvoice(inv, { status: 'SENT' }, `${inv.number} marked as sent`)} aria-label={`Send ${inv.number}`}>
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          {inv.status !== 'PAID' && inv.status !== 'DRAFT' ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openPay(inv)} aria-label={`Record payment for ${inv.number}`}>
                              <Wallet className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => remove(inv)} aria-label={`Delete ${inv.number}`}>
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

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New invoice</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2 sm:col-span-2">
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
              <div className="grid gap-2">
                <Label htmlFor="inv-due">Due date</Label>
                <Input id="inv-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Line items</Label>
                <Button variant="outline" size="sm" onClick={() => setItems([...items, { ...EMPTY_ITEM }])}>
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add line
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      className="flex-1"
                      placeholder="Description of work"
                      value={item.description}
                      onChange={(e) => setItems(items.map((it, i) => (i === idx ? { ...it, description: e.target.value } : it)))}
                      aria-label={`Item ${idx + 1} description`}
                    />
                    <Input
                      className="w-20"
                      type="number"
                      min="0"
                      step="0.5"
                      value={item.quantity}
                      onChange={(e) => setItems(items.map((it, i) => (i === idx ? { ...it, quantity: Number(e.target.value) } : it)))}
                      aria-label={`Item ${idx + 1} quantity`}
                    />
                    <Input
                      className="w-28"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Rate"
                      value={item.unitPrice || ''}
                      onChange={(e) => setItems(items.map((it, i) => (i === idx ? { ...it, unitPrice: Number(e.target.value) } : it)))}
                      aria-label={`Item ${idx + 1} unit price`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-rose-600"
                      disabled={items.length === 1}
                      onClick={() => setItems(items.filter((_, i) => i !== idx))}
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">Invoice total</span>
                <span className="font-semibold tabular-nums">{fmtMoney(draftTotal, currency)}</span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="inv-tax">Tax rate %</Label>
                <Input id="inv-tax" type="number" min="0" step="0.1" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="inv-notes">Notes</Label>
                <Input id="inv-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Payment details, thank-you note…" />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => createInvoice('DRAFT')} disabled={saving}>Save draft</Button>
            <Button onClick={() => createInvoice('SENT')} disabled={saving}>{saving ? 'Saving…' : 'Create & mark sent'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detail.number} <StatusBadge status={detail.status} />
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <div>
                    <p className="font-medium">{detail.client?.name ?? 'No client'}</p>
                    <p className="text-xs text-muted-foreground">{detail.client?.company}</p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>Issued {fmtDate(detail.issueDate)}</p>
                    <p>Due {fmtDate(detail.dueDate)}</p>
                  </div>
                </div>
                <Separator />
                <div className="space-y-1.5">
                  {detail.items.map((it, i) => (
                    <div key={i} className="flex justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{it.description} <span className="text-muted-foreground">× {it.quantity}</span></span>
                      <span className="shrink-0 tabular-nums">{fmtMoney(it.quantity * it.unitPrice, currency)}</span>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{fmtMoney(detail.totals.subtotal, currency)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>Tax ({detail.taxRate}%)</span><span className="tabular-nums">{fmtMoney(detail.totals.tax, currency)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{fmtMoney(detail.totals.total, currency)}</span></div>
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400"><span>Paid</span><span className="tabular-nums">{fmtMoney(detail.totals.paid, currency)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Balance</span><span className="tabular-nums">{fmtMoney(detail.totals.balance, currency)}</span></div>
                </div>
                {detail.payments.length > 0 ? (
                  <>
                    <Separator />
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">PAYMENTS</p>
                      <div className="space-y-1">
                        {detail.payments.map((p) => (
                          <div key={p.id} className="flex justify-between text-xs">
                            <span className="capitalize text-muted-foreground">{p.method.toLowerCase()} · {fmtDate(p.paidAt)}{p.note ? ` · ${p.note}` : ''}</span>
                            <span className="tabular-nums">{fmtMoney(p.amount, currency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                {detail.notes ? <p className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">{detail.notes}</p> : null}
              </div>
              <DialogFooter className="flex-wrap gap-2 sm:gap-0">
                {detail.status === 'DRAFT' ? (
                  <Button variant="outline" onClick={() => patchInvoice(detail, { status: 'SENT' }, `${detail.number} marked as sent`)}>
                    <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Mark sent
                  </Button>
                ) : null}
                {detail.status !== 'PAID' && detail.status !== 'DRAFT' ? (
                  <Button onClick={() => openPay(detail)}><Wallet className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Record payment</Button>
                ) : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={payFor !== null} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
          {payFor ? (
            <>
              <DialogHeader>
                <DialogTitle>Record payment — {payFor.number}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Balance due</span>
                  <span className="font-semibold tabular-nums">{fmtMoney(payFor.totals.balance, currency)}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="pay-amount">Amount ({currency})</Label>
                    <Input id="pay-amount" type="number" min="0" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Method</Label>
                    <Select value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAY_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>{m[0] + m.slice(1).toLowerCase()}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pay-note">Note</Label>
                  <Input id="pay-note" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="Deposit, partial, etc." />
                </div>
                <p className="text-xs text-muted-foreground">Invoices are auto-marked paid when the balance reaches zero.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
                <Button onClick={recordPayment} disabled={paying}>{paying ? 'Saving…' : 'Record payment'}</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
