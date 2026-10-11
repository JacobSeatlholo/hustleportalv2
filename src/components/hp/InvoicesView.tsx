'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api, rands, randsPlain, type Invoice, type ProjectFull } from './shared'
import { useHp } from './store'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, ReceiptText, Printer, Send, Trash2, Upload, X } from 'lucide-react'

type Item = { description: string; quantity: number; unitPrice: number }

function itemsOf(inv: Invoice): Item[] {
  if (typeof inv.items === 'string') {
    try { return JSON.parse(inv.items) as Item[] } catch { return [] }
  }
  return inv.items || []
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'border-stone-500/40 text-stone-400',
  SENT: 'border-yellow-500/40 text-yellow-500',
  PAID: 'border-emerald-500/40 text-emerald-500',
  OVERDUE: 'border-rose-500/40 text-rose-500',
}

export default function InvoicesView() {
  const { activeProjectId, bumpRefresh } = useHp()
  const { toast } = useToast()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [printable, setPrintable] = useState<Invoice | null>(null)
  const [profile, setProfile] = useState<ProjectFull | null>(null)

  // create form
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: 1, unitPrice: 0 }])
  const [taxRate, setTaxRate] = useState(15)
  const [notes, setNotes] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [sendAfter, setSendAfter] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inv, proj] = await Promise.all([
        api<{ invoices: Invoice[] }>('/api/invoices'),
        activeProjectId ? api<{ project: ProjectFull }>(`/api/projects/${activeProjectId}`).catch(() => null) : Promise.resolve(null),
      ])
      setInvoices(inv.invoices)
      if (proj) setProfile(proj.project)
    } catch (e) {
      toast({ title: 'Could not load invoices', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast, activeProjectId])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0)
    const total = subtotal * (1 + (Number(taxRate) || 0) / 100)
    return { subtotal, total }
  }, [items, taxRate])

  function resetForm() {
    setClientName(''); setClientEmail('')
    setItems([{ description: '', quantity: 1, unitPrice: 0 }])
    setTaxRate(15); setNotes(''); setLogoUrl(null); setSendAfter(false)
  }

  async function create(status: 'DRAFT' | 'SENT') {
    if (!clientName.trim()) {
      toast({ title: 'Who is this for?', description: 'Add a client name.', variant: 'destructive' })
      return
    }
    if (!items.some((i) => i.description.trim())) {
      toast({ title: 'Add a line item', description: 'At least one item needs a description.', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const res = await api<{ invoice: Invoice }>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          clientName, clientEmail, items, taxRate, notes, logoUrl,
          status, projectId: activeProjectId,
        }),
      })
      toast({ title: `${res.invoice.number} created ✓`, description: status === 'SENT' ? 'Marked as sent.' : 'Saved as draft.' })
      resetForm()
      setShowCreate(false)
      bumpRefresh()
      load()
    } catch (e) {
      toast({ title: 'Could not create invoice', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function setStatus(inv: Invoice, status: 'SENT' | 'PAID') {
    try {
      await api(`/api/invoices/${inv.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast({ title: `${inv.number} → ${status}` })
      load()
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/invoices/${id}`, { method: 'DELETE' })
      setInvoices((rows) => rows.filter((r) => r.id !== id))
    } catch {
      // non-fatal
    }
  }

  function onLogoFile(file: File | undefined) {
    if (!file) return
    if (file.size > 300_000) {
      toast({ title: 'Logo too large', description: 'Keep it under 300 KB for the printable template.', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setLogoUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  function printInvoice(inv: Invoice) {
    setPrintable(inv)
    setTimeout(() => window.print(), 120)
  }

  return (
    <div className="space-y-6 print:hidden">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Invoices</h2>
          <p className="text-sm text-muted-foreground">VAT-ready ZAR invoices with your logo — print, PDF via the browser, or mark as sent.</p>
        </div>
        <Button onClick={() => setShowCreate((s) => !s)}>
          <Plus className="h-4 w-4" /> New invoice
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">New invoice</h3>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              <Upload className="h-3.5 w-3.5" /> Logo
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogoFile(e.target.files?.[0])} />
              {logoUrl && <img src={logoUrl} alt="logo preview" className="h-6 rounded" />}
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="i-client">Client name</Label>
              <Input id="i-client" placeholder="Bloom Beauty Bar" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-email">Client email (optional)</Label>
              <Input id="i-email" type="email" placeholder="nomsa@bloombeauty.co.za" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Line items</Label>
            {items.map((item, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  placeholder={`Item ${idx + 1} — e.g. Social media retainer`}
                  value={item.description}
                  onChange={(e) => setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))}
                  className="flex-1"
                />
                <Input
                  type="number" min={1} step={1} aria-label="Quantity"
                  value={item.quantity}
                  onChange={(e) => setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, quantity: Number(e.target.value) } : r)))}
                  className="w-16"
                />
                <Input
                  type="number" min={0} step={0.01} aria-label="Unit price (rand)"
                  value={item.unitPrice}
                  onChange={(e) => setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, unitPrice: Number(e.target.value) } : r)))}
                  className="w-28"
                />
                <button onClick={() => setItems((rows) => rows.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-rose-400" aria-label="Remove item">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setItems((rows) => [...rows, { description: '', quantity: 1, unitPrice: 0 }])}>
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="i-tax">VAT / tax %</Label>
              <Input id="i-tax" type="number" min={0} max={100} step={0.5} value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Subtotal <b className="text-foreground">{randsPlain(totals.subtotal)}</b></p>
              <p>Total incl. VAT <b className="text-brand font-display text-lg">{randsPlain(Math.round(totals.total * 100) / 100)}</b></p>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={sendAfter} onChange={(e) => setSendAfter(e.target.checked)} className="accent-yellow-400" />
              Mark as sent immediately
            </label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="i-notes">Notes (optional)</Label>
            <Textarea id="i-notes" rows={2} placeholder="Payment due in 14 days. Banking: FNB 6284…, reference INV-number." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => create(sendAfter ? 'SENT' : 'DRAFT')} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
              Create {sendAfter ? '& send' : 'draft'}
            </Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-md bg-white/5 animate-pulse" />)}</div>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">No invoices yet — create your first one above.</p>
        ) : (
          <div className="divide-y">
            {invoices.map((inv) => (
              <div key={inv.id} className="p-3.5 flex flex-wrap items-center gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{inv.number} · {inv.clientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {itemsOf(inv).length} item{itemsOf(inv).length === 1 ? '' : 's'} · due {inv.dueAt ? new Date(inv.dueAt).toLocaleDateString('en-ZA') : '—'}
                  </p>
                </div>
                <span className="font-display text-brand text-lg">{rands(inv.total * 100)}</span>
                <Badge variant="outline" className={STATUS_STYLES[inv.status] ?? ''}>{inv.status}</Badge>
                <div className="flex items-center gap-1.5">
                  {inv.status === 'DRAFT' && (
                    <button onClick={() => setStatus(inv, 'SENT')} title="Mark as sent" className="rounded-full border p-1.5 hover:border-brand transition">
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {(inv.status === 'SENT' || inv.status === 'OVERDUE') && (
                    <button onClick={() => setStatus(inv, 'PAID')} title="Mark as paid" className="rounded-full border p-1.5 hover:border-emerald-500 transition text-emerald-500">
                      ✓
                    </button>
                  )}
                  <button onClick={() => printInvoice(inv)} title="Print / save PDF" className="rounded-full border p-1.5 hover:border-brand transition">
                    <Printer className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(inv.id)} title="Delete" className="rounded-full border p-1.5 hover:border-rose-500 hover:text-rose-400 transition">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Printable template (also drives window.print) */}
      {printable && <InvoicePrint invoice={printable} profile={profile} onDone={() => setPrintable(null)} />}
    </div>
  )
}

function InvoicePrint({ invoice, profile, onDone }: { invoice: Invoice; profile: ProjectFull | null }) {
  const items = itemsOf(invoice)
  const vat = invoice.total - invoice.subtotal
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 overflow-auto p-4 print:static print:bg-white print:text-black print:p-0 print:z-auto">
      <div className="max-w-[820px] mx-auto bg-white text-black rounded-lg shadow-2xl print:shadow-none print:rounded-none print:max-w-none">
        <div className="p-8 md:p-10">
          <div className="flex items-start justify-between gap-6 border-b pb-6">
            <div>
              {invoice.logoUrl
                ? <img src={invoice.logoUrl} alt="Business logo" className="h-14 mb-2" />
                : <div className="font-display text-3xl tracking-wide">HUSTLE<span className="text-yellow-500">PORTAL</span></div>}
              <p className="text-sm font-semibold mt-1">{profile?.name || 'Your business'}</p>
              {profile?.website && <p className="text-xs text-neutral-500">{profile.website}</p>}
              {profile?.contactEmail && <p className="text-xs text-neutral-500">{profile.contactEmail}</p>}
              {profile?.contactPhone && <p className="text-xs text-neutral-500">{profile.contactPhone}</p>}
            </div>
            <div className="text-right">
              <div className="font-display text-3xl">INVOICE</div>
              <p className="text-sm font-semibold">{invoice.number}</p>
              <p className="text-xs text-neutral-500">Issued {new Date(invoice.issuedAt).toLocaleDateString('en-ZA')}</p>
              <p className="text-xs text-neutral-500">Due {invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString('en-ZA') : '—'}</p>
              <p className={`text-xs font-bold mt-1 ${invoice.status === 'PAID' ? 'text-emerald-700' : invoice.status === 'OVERDUE' ? 'text-rose-700' : 'text-neutral-700'}`}>
                {invoice.status}
              </p>
            </div>
          </div>

          <div className="py-6">
            <p className="text-[10px] uppercase tracking-widest text-neutral-400">Billed to</p>
            <p className="font-semibold">{invoice.clientName}</p>
            {invoice.clientEmail && <p className="text-sm text-neutral-500">{invoice.clientEmail}</p>}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-widest text-neutral-400">
                <th className="pb-2 font-medium">Description</th>
                <th className="pb-2 font-medium text-right">Qty</th>
                <th className="pb-2 font-medium text-right">Unit</th>
                <th className="pb-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-neutral-100">
                  <td className="py-2.5 pr-2">{it.description}</td>
                  <td className="py-2.5 text-right">{it.quantity}</td>
                  <td className="py-2.5 text-right">{randsPlain(it.unitPrice)}</td>
                  <td className="py-2.5 text-right">{randsPlain(it.quantity * it.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end mt-4">
            <div className="w-56 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-neutral-500">Subtotal</span><span>{randsPlain(invoice.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">VAT ({invoice.taxRate}%)</span><span>{randsPlain(Math.round(vat * 100) / 100)}</span></div>
              <div className="flex justify-between font-bold text-base border-t pt-1.5"><span>Total</span><span>{randsPlain(invoice.total)}</span></div>
            </div>
          </div>

          {invoice.notes && <div className="mt-6 text-xs text-neutral-500 whitespace-pre-line">{invoice.notes}</div>}
          <p className="mt-8 text-center text-[10px] text-neutral-400">
            Powered by HustlePortal™ · Business Hustle · Simple Eternity Holdings (Pty) Ltd
          </p>
        </div>
      </div>
      <div className="max-w-[820px] mx-auto flex justify-end gap-2 py-3 print:hidden">
        <Button variant="outline" onClick={onDone}>Close</Button>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save PDF</Button>
      </div>
    </div>
  )
}
