'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, rands, randsPlain, type Invoice, type ProjectFull, type IntegrationSetting } from './shared'
import { useHp } from './store'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, ReceiptText, Printer, Send, Trash2, Upload, X, Lock } from 'lucide-react'
import { tpCanShow, tpMarkShown } from './touchpoints'
import { TouchpointCard, TouchpointAction } from './TouchpointCard'
import { ServiceRequestDialog, type RequestedService } from './ServiceRequestDialog'
import { usePlan, requestUpgrade } from './useUpgrade'

type Item = { description: string; quantity: number; unitPrice: number }
type BankDetails = {
  bankName: string
  accountName: string
  accountNumber: string
  branchCode: string
  accountType: string
  reference: string
}

const EMPTY_BANK: BankDetails = { bankName: '', accountName: '', accountNumber: '', branchCode: '', accountType: '', reference: '' }

/** Flat, print-ready rendering of the banking block (one fact per line). */
function bankLines(b: Partial<BankDetails>): string[] {
  return [
    b.bankName ? `Bank: ${b.bankName}` : '',
    b.accountName ? `Account name: ${b.accountName}` : '',
    b.accountNumber ? `Account number: ${b.accountNumber}` : '',
    b.branchCode ? `Branch code: ${b.branchCode}` : '',
    b.accountType ? `Account type: ${b.accountType}` : '',
    b.reference ? `Payment reference: ${b.reference}` : '',
  ].filter(Boolean)
}

function parseBank(raw: string | null | undefined): BankDetails {
  if (!raw) return { ...EMPTY_BANK }
  try {
    const p = JSON.parse(raw) as Partial<BankDetails>
    return {
      bankName: String(p.bankName || ''), accountName: String(p.accountName || ''),
      accountNumber: String(p.accountNumber || ''), branchCode: String(p.branchCode || ''),
      accountType: String(p.accountType || ''), reference: String(p.reference || ''),
    }
  } catch {
    return { ...EMPTY_BANK }
  }
}

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
  const { session, activeProjectId, bumpRefresh, setView, setStoreFocus } = useHp()
  const { toast } = useToast()
  const { paid } = usePlan()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [printable, setPrintable] = useState<Invoice | null>(null)
  const [profile, setProfile] = useState<ProjectFull | null>(null)
  const [bank, setBank] = useState<BankDetails>({ ...EMPTY_BANK })
  const [showBank, setShowBank] = useState(false)
  const [bankSaving, setBankSaving] = useState(false)
  const bankAutoRef = useRef(false)

  // create form
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: 1, unitPrice: 0 }])
  const [taxRate, setTaxRate] = useState(15)
  const [vatMode, setVatMode] = useState<'excl' | 'incl'>('excl')
  const [notes, setNotes] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [sendAfter, setSendAfter] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Business logo (Operator): uploaded once as SVG, printed on every invoice.
  const [bizLogo, setBizLogo] = useState<string | null>(null)
  const [bizLogoBusy, setBizLogoBusy] = useState(false)
  const bizLogoRef = useRef<HTMLInputElement>(null)

  // Conversion touchpoints, quiet, frequency-capped, never blocking (see touchpoints.ts)
  // invoice-logo is DERIVED: latest invoice without a logo + frequency gate → the card
  // survives navigation and reappears until its 2-show cap (or snooze/retire) ends it.
  const [logoNudgeNumber, setLogoNudgeNumber] = useState('')
  const logoMarkedRef = useRef('')
  const [firstPayNudge, setFirstPayNudge] = useState(false)
  const [reqOpen, setReqOpen] = useState(false)
  const [reqService, setReqService] = useState<RequestedService | null>(null)
  const [reqPreset, setReqPreset] = useState<string | undefined>(undefined)

  // Workspace focus: follows the active workspace (top nav switcher) until the user picks explicitly.
  const [invProject, setInvProject] = useState('')
  const effProject = invProject || activeProjectId || 'ALL'

  // The top-bar switcher always wins: switching projects in the top nav repopulates
  // the invoice book for that workspace, seamlessly.
  useEffect(() => {
    setInvProject('')
  }, [activeProjectId])

  useEffect(() => {
    if (logoNudgeNumber && logoMarkedRef.current !== logoNudgeNumber) {
      logoMarkedRef.current = logoNudgeNumber
      tpMarkShown('invoice-logo', 2)
    }
  }, [logoNudgeNumber])

  function goStore(focus?: string) {
    if (focus) setStoreFocus(focus)
    setView('store')
  }

  function openRequest(service: RequestedService, preset?: string) {
    setReqService(service)
    setReqPreset(preset)
    setReqOpen(true)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inv, proj] = await Promise.all([
        api<{ invoices: Invoice[]; logoUrl?: string | null }>(
          effProject && effProject !== 'ALL' ? `/api/invoices?projectId=${encodeURIComponent(effProject)}` : '/api/invoices'
        ),
        activeProjectId ? api<{ project: ProjectFull }>(`/api/projects/${activeProjectId}`).catch(() => null) : Promise.resolve(null),
      ])
      setInvoices(inv.invoices)
      setBizLogo(inv.logoUrl || null)
      // Touchpoint: latest invoice without a logo → one quiet, professional prompt
      // (frequency-capped in localStorage; survives navigation until capped).
      const latest = inv.invoices[0]
      setLogoNudgeNumber(latest && !latest.logoUrl && tpCanShow('invoice-logo') ? latest.number : '')
      if (proj) setProfile(proj.project)
      try {
        const s = await api<{ settings: IntegrationSetting[] }>('/api/settings')
        const row = s.settings.find((r) => r.key === 'INVOICE_BANK')
        const parsed = parseBank(row?.value)
        setBank(parsed)
        if (!bankAutoRef.current) {
          bankAutoRef.current = true
          setShowBank(!bankLines(parsed).length)
        }
      } catch {
        bankAutoRef.current = true
      }
    } catch (e) {
      toast({ title: 'Could not load invoices', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast, effProject])

  useEffect(() => { load() }, [load])

  // Same math as the server: exclude mode adds VAT on top, include mode pulls
  // VAT OUT (gross x rate/(100+rate)) so the client is never charged twice.
  const totals = useMemo(() => {
    const gross = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0)
    const rate = Number(taxRate) || 0
    const incl = vatMode === 'incl'
    const subtotal = incl ? Math.round((gross * 100) / (100 + rate) * 100) / 100 : gross
    const total = incl ? gross : Math.round(subtotal * (1 + rate / 100) * 100) / 100
    return { subtotal, total, vat: Math.round((total - subtotal) * 100) / 100 }
  }, [items, taxRate, vatMode])

  function resetForm() {
    setClientName(''); setClientEmail('')
    setItems([{ description: '', quantity: 1, unitPrice: 0 }])
    setTaxRate(15); setNotes(''); setLogoUrl(bizLogo); setSendAfter(false)
  }

  async function onBizLogoFile(file: File | undefined) {
    if (!file) return
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      toast({ title: 'SVG please', description: 'Export your logo as an SVG file. It stays crisp at every print size.', variant: 'destructive' })
      return
    }
    if (file.size > 150_000) {
      toast({ title: 'Logo too large', description: 'Keep the SVG under 150 KB. Most logo exports are far smaller.', variant: 'destructive' })
      return
    }
    setBizLogoBusy(true)
    try {
      const svg = await file.text()
      const res = await api<{ logoUrl: string }>('/api/invoice-logo', { method: 'PUT', body: JSON.stringify({ svg }) })
      setBizLogo(res.logoUrl)
      setLogoUrl(res.logoUrl)
      toast({ title: 'Logo saved ✓', description: 'Every invoice you create from now on prints it.' })
    } catch (e) {
      toast({ title: 'Could not save the logo', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBizLogoBusy(false)
      if (bizLogoRef.current) bizLogoRef.current.value = ''
    }
  }

  async function removeBizLogo() {
    try {
      await api('/api/invoice-logo', { method: 'DELETE' })
      setBizLogo(null)
      toast({ title: 'Logo removed' })
    } catch {
      toast({ title: 'Could not remove the logo', variant: 'destructive' })
    }
  }

  async function saveBank() {
    setBankSaving(true)
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ key: 'INVOICE_BANK', value: JSON.stringify(bank) }) })
      toast({ title: 'Banking details saved ✓', description: 'Every new invoice prints them automatically.' })
      setShowBank(false)
    } catch (e) {
      toast({ title: 'Could not save banking details', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBankSaving(false)
    }
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
          clientName, clientEmail, items, taxRate, pricesIncludeVat: vatMode === 'incl', notes, logoUrl,
          status, projectId: effProject !== 'ALL' ? effProject : (activeProjectId || undefined),
          bankDetails: bankLines(bank).join('\n'),
        }),
      })
      toast({ title: `${res.invoice.number} created ✓`, description: status === 'SENT' ? 'Marked as sent.' : 'Saved as draft.' })
      resetForm()
      setShowCreate(false)
      bumpRefresh()
      load() // load() re-derives the invoice-logo touchpoint from the fresh list
    } catch (e) {
      toast({ title: 'Could not create invoice', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function setStatus(inv: Invoice, status: 'SENT' | 'PAID') {
    const isFirstPaid = status === 'PAID' && inv.status !== 'PAID' && invoices.filter((i) => i.status === 'PAID').length === 0
    try {
      await api(`/api/invoices/${inv.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast({ title: `${inv.number} → ${status}` })
      // Touchpoint: first money in, the natural moment to suggest reinvesting in growth.
      if (isFirstPaid && tpCanShow('first-paid')) {
        tpMarkShown('first-paid', 1)
        setFirstPayNudge(true)
      }
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
    // The logo feature lives on Operator, wherever it is touched from.
    if (!paid) {
      requestUpgrade('logo')
      return
    }
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
    setTimeout(() => window.print(), 300)
  }

  return (
    <>
      <div className="space-y-6 print:hidden">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Invoices</h2>
          <p className="text-sm text-muted-foreground">VAT-ready ZAR invoices with your logo, print, PDF via the browser, or mark as sent.</p>
        </div>
        <div className="flex items-center gap-2">
          {(session?.projects?.length ?? 0) > 1 && (
            <Select value={effProject} onValueChange={setInvProject}>
              <SelectTrigger className="w-[170px]" aria-label="Workspace"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All workspaces</SelectItem>
                {session!.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={() => setShowCreate((s) => !s)}>
            <Plus className="h-4 w-4" /> New invoice
          </Button>
        </div>
      </div>

      {/* Banking details, printed on every new invoice */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium text-sm">Your banking details</h3>
              <p className="text-xs text-muted-foreground">Saved once, printed automatically on every invoice you create.</p>
            </div>
            <div className="flex items-center gap-2">
              {bankLines(bank).length > 0 ? (
                <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">ON INVOICES</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">NOT SET YET</Badge>
              )}
              <Button size="sm" variant="outline" onClick={() => setShowBank((s) => !s)}>
                {showBank ? 'Hide' : bankLines(bank).length ? 'Edit' : 'Add bank details'}
              </Button>
            </div>
          </div>
          {bankLines(bank).length > 0 && !showBank && (
            <div className="rounded-lg border border-brand/20 bg-brand/5 p-2.5 text-xs whitespace-pre-line">{bankLines(bank).join('\n')}</div>
          )}
          {showBank && (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bk-name">Bank</Label>
                  <Input id="bk-name" placeholder="FNB / Capitec / Standard Bank" value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-accname">Account name</Label>
                  <Input id="bk-accname" placeholder="Your business name" value={bank.accountName} onChange={(e) => setBank({ ...bank, accountName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-accno">Account number</Label>
                  <Input id="bk-accno" placeholder="e.g. 62841234567" value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-branch">Branch code</Label>
                  <Input id="bk-branch" placeholder="e.g. 250655" value={bank.branchCode} onChange={(e) => setBank({ ...bank, branchCode: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-type">Account type</Label>
                  <Input id="bk-type" placeholder="Cheque / Savings" value={bank.accountType} onChange={(e) => setBank({ ...bank, accountType: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-ref">Payment reference</Label>
                  <Input id="bk-ref" placeholder="e.g. INV-number or your business name" value={bank.reference} onChange={(e) => setBank({ ...bank, reference: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={saveBank} disabled={bankSaving || !bank.accountNumber.trim() || !bank.accountName.trim()}>
                  {bankSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save banking details'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowBank(false)}>Cancel</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Stored privately on your account. Each invoice keeps a snapshot, so old invoices always show the details they were paid with.</p>
            </div>
          )}
      </div>

      {/* Business logo (Operator), uploaded once, printed on every invoice */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium text-sm">Your business logo</h3>
            <p className="text-xs text-muted-foreground">Upload it once as an SVG. Every invoice you print or email carries your brand.</p>
          </div>
          <div className="flex items-center gap-2">
            {bizLogo ? (
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">ON INVOICES</Badge>
            ) : paid ? (
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">NOT SET YET</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-brand/40 text-brand">OPERATOR</Badge>
            )}
            {paid ? (
              <>
                <Button size="sm" variant="outline" disabled={bizLogoBusy} onClick={() => bizLogoRef.current?.click()}>
                  {bizLogoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-3.5 w-3.5 mr-1" /> {bizLogo ? 'Replace' : 'Upload SVG'}</>}
                </Button>
                {bizLogo && (
                  <Button size="sm" variant="ghost" onClick={removeBizLogo}>Remove</Button>
                )}
              </>
            ) : (
              <Button size="sm" variant="outline" className="border-brand/50" onClick={() => requestUpgrade('logo')}>
                <Lock className="h-3.5 w-3.5 mr-1 text-brand" /> Unlock on Operator
              </Button>
            )}
          </div>
        </div>
        {bizLogo && (
          <div className="rounded-lg border bg-background p-3 inline-block">
            <img src={bizLogo} alt="Business logo" className="h-12" />
          </div>
        )}
        <input
          ref={bizLogoRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={(e) => onBizLogoFile(e.target.files?.[0])}
        />
      </div>

      {showCreate && (
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">New invoice</h3>
            <label
              className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={(e) => {
                if (!paid) {
                  e.preventDefault()
                  requestUpgrade('logo')
                }
              }}
            >
              <Upload className="h-3.5 w-3.5" /> Logo{!paid ? ' · Operator' : ''}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogoFile(e.target.files?.[0])} />
              {logoUrl && <img src={logoUrl} alt="logo preview" className="h-6 rounded" />}
            </label>
          </div>
          {!logoUrl && (
            <p className="text-[11px] text-muted-foreground">
              Tip, invoices with a logo read as established and get paid faster.{' '}
              <button type="button" className="underline underline-offset-2 hover:text-brand" onClick={() => goStore('Content Creation')}>
                See packages from R1,550
              </button>{' '}or{' '}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-brand"
                onClick={() => openRequest({ id: 'graphic-design', title: 'Graphic Design' }, "I'd like a logo / brand mark for my invoices and documents. Here's my business in one line: ")}
              >
                ask our team to design one
              </button>.
            </p>
          )}
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
                  placeholder={`Item ${idx + 1}, e.g. Social media retainer`}
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
              <Label htmlFor="i-tax">VAT rate %</Label>
              <Input id="i-tax" type="number" min={0} max={100} step={0.5} value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
              <Select value={vatMode} onValueChange={(v) => setVatMode(v as 'excl' | 'incl')}>
                <SelectTrigger className="h-8 text-xs" aria-label="Are your prices including VAT?"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excl">Prices exclude VAT</SelectItem>
                  <SelectItem value="incl">Prices include VAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Subtotal (excl VAT) <b className="text-foreground">{randsPlain(totals.subtotal)}</b></p>
              <p className="text-muted-foreground">VAT <b className="text-foreground">{randsPlain(totals.vat)}</b></p>
              <p>Total <b className="text-brand font-display text-lg">{randsPlain(Math.round(totals.total * 100) / 100)}</b></p>
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

      {/* Touchpoints, quiet conversions at the moment they matter */}
      {logoNudgeNumber && (
        <TouchpointCard
          id="invoice-logo"
          title={`${logoNudgeNumber} is out, without your logo`}
          body="Invoices that look established get paid faster. A logo and consistent branding make every document read as a real business."
          snoozeDays={7}
          footer="Quoted before any work starts · tracked on your Tasks · replies come to your email"
        >
          <TouchpointAction primary onClick={() => goStore('Content Creation')}>
            See content packages · R1,550
          </TouchpointAction>
          <TouchpointAction
            onClick={() => openRequest(
              { id: 'graphic-design', title: 'Graphic Design' },
              "I'd like a logo / brand mark for my invoices and documents. Here's my business in one line: "
            )}
          >
            Request something custom
          </TouchpointAction>
        </TouchpointCard>
      )}
      {firstPayNudge && (
        <TouchpointCard
          id="first-paid"
          title="First payment in, well run."
          body="Cashflow is fuel, and owners who reinvest early grow fastest. Content and marketing packages turn this month's invoices into next month's customers."
          snoozeDays={30}
          footer="Free assessment, our team reviews where your business is and recommends the next step"
        >
          <TouchpointAction primary onClick={() => goStore()}>
            Browse growth packages
          </TouchpointAction>
          <TouchpointAction
            onClick={() => openRequest(
              { id: 'free-assessment', title: 'Free Business Assessment' },
              "My first payment just came through HustlePortal. Here's where my business is right now: "
            )}
          >
            Get a free assessment
          </TouchpointAction>
        </TouchpointCard>
      )}

      {/* List */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-md bg-white/5 animate-pulse" />)}</div>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">No invoices yet, create your first one above.</p>
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

      {/* Direct line to the team, shared with every touchpoint on the platform */}
      <ServiceRequestDialog open={reqOpen} onOpenChange={setReqOpen} service={reqService} presetMessage={reqPreset} />
      </div>

      {/* Printable template lives OUTSIDE the print:hidden container above.
          Inside it, printing hid the invoice itself and produced a blank page. */}
      {printable && <InvoicePrint invoice={printable} profile={profile} bankFallback={bank} onDone={() => setPrintable(null)} />}
    </>
  )
}

function InvoicePrint({ invoice, profile, bankFallback, onDone }: { invoice: Invoice; profile: ProjectFull | null; bankFallback: BankDetails | null; onDone: () => void }) {
  const items = itemsOf(invoice)
  const vat = invoice.total - invoice.subtotal
  // Prefer the snapshot saved on the invoice; fall back to current settings for older invoices.
  const bankBlock = invoice.bankDetails?.trim()
    ? invoice.bankDetails.trim()
    : bankFallback
      ? bankLines(bankFallback).join('\n')
      : ''
  // Portal to document.body so the sheet is a DIRECT child of body: the print law
  // in globals.css (body:has(#invoice-print-root) > *:not(#invoice-print-root))
  // then hides the ENTIRE app tree on print. Tutorial, toasts, tours and any
  // future chrome physically cannot reach the paper. Only the invoice prints.
  return createPortal(
    <div id="invoice-print-root" className="fixed inset-0 z-[60] bg-black/70 overflow-auto p-4 print:static print:bg-white print:text-black print:p-0 print:z-auto">
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
              {invoice.dueAt && <p className="text-xs text-neutral-500">Due {new Date(invoice.dueAt).toLocaleDateString('en-ZA')}</p>}
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
              <div className="flex justify-between"><span className="text-neutral-500">Subtotal (excl VAT)</span><span>{randsPlain(invoice.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">VAT ({invoice.taxRate}%)</span><span>{randsPlain(Math.round(vat * 100) / 100)}</span></div>
              <div className="flex justify-between font-bold text-base border-t pt-1.5"><span>Total (incl VAT)</span><span>{randsPlain(invoice.total)}</span></div>
              {invoice.pricesIncludeVat && (
                <p className="text-[10px] text-neutral-400 text-right">Line prices shown include VAT.</p>
              )}
            </div>
          </div>

          {bankBlock && (
            <div className="mt-6 rounded border border-neutral-200 p-3">
              <p className="text-[10px] uppercase tracking-widest text-neutral-400 mb-1.5">Banking details</p>
              <div className="text-xs text-neutral-700 whitespace-pre-line font-mono">{bankBlock}</div>
            </div>
          )}
          {invoice.notes && <div className="mt-6 text-xs text-neutral-500 whitespace-pre-line">{invoice.notes}</div>}
        </div>
      </div>
      <div className="max-w-[820px] mx-auto flex justify-end gap-2 py-3 print:hidden">
        <Button variant="outline" onClick={onDone}>Close</Button>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save PDF</Button>
      </div>
    </div>,
    document.body
  )
}
