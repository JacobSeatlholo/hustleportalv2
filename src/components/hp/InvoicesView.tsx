'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, rands, randsPlain, type Invoice, type ProjectFull, type IntegrationSetting } from './shared'
import { useHp } from './store'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, ReceiptText, FileText, Printer, Send, Trash2, Upload, X, Lock, Check, Ban, Sparkles, Paperclip } from 'lucide-react'
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
  ACCEPTED: 'border-emerald-500/40 text-emerald-500',
  DECLINED: 'border-rose-500/40 text-rose-500',
}

export function kindOf(inv: Pick<Invoice, 'kind'>): 'INVOICE' | 'QUOTE' {
  return inv.kind === 'QUOTE' ? 'QUOTE' : 'INVOICE'
}

/** The sending domain is the verified one the engine signs — only the part
 *  before the @ is the user's to edit (the composer keeps it that way). */
const FROM_DOMAIN = 'hustleportal.online'

/** The honest default draft: what was sent, for how much, when it's due. */
function invoiceEmailBody(inv: Invoice, bizName: string): string {
  const isQuote = kindOf(inv) === 'QUOTE'
  const items = itemsOf(inv)
  const first = items.find((i) => i.description.trim())?.description.trim()
  const due = inv.dueAt ? new Date(inv.dueAt).toLocaleDateString('en-ZA') : null
  return [
    `Hi ${inv.clientName},`,
    '',
    `Please find ${isQuote ? 'quote' : 'invoice'} ${inv.number} attached${first ? ` — ${first}` : ''}. The total comes to ${rands(inv.total * 100)}${isQuote ? '' : due ? `, due ${due}` : ''}.`,
    '',
    isQuote
      ? 'If everything looks right, accept the quote and I will get started.'
      : 'Banking details are on the document. Payment is due by the date above.',
    inv.notes?.trim() ? `\n${inv.notes.trim()}` : '',
    '',
    'Any questions, just reply to this email.',
    '',
    'Kind regards,',
    bizName || 'Me',
  ].filter((line) => line !== '').join('\n')
}

/** Suggested local parts for the sender picker — the identity slug is added at open. */
const FROM_IDEAS = ['accounts', 'invoices', 'sales', 'hello', 'team']

/**
 * Notion style document name: the client name on an invoice or quote is
 * click to edit, inline in the list. The number never moves (series law),
 * only the name does, and the same PATCH the editor uses carries it.
 */
function DocTitle({ inv, onRenamed }: { inv: Invoice; onRenamed: (id: string, clientName: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setEditing(false)
    const v = draft.trim()
    if (!v || v === inv.clientName) return
    setSaving(true)
    try {
      await api(`/api/invoices/${inv.id}`, { method: 'PATCH', body: JSON.stringify({ clientName: v }) })
      onRenamed(inv.id, v)
    } catch {
      // the old name stays on a failed save
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); save() }
          if (e.key === 'Escape') setEditing(false)
        }}
        className="h-7 max-w-[260px] inline-flex text-sm font-medium align-middle"
        aria-label="Document name"
      />
    )
  }
  return (
    <span
      className="cursor-text hover:bg-white/5 rounded px-1 transition"
      title="Click to rename"
      onClick={() => { setDraft(inv.clientName); setEditing(true) }}
    >
      {saving ? '…' : inv.clientName}
    </span>
  )
}

export default function InvoicesView() {
  const { session, activeProjectId, bumpRefresh, setView, setStoreFocus } = useHp()
  const { toast } = useToast()
  const { paid } = usePlan()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  // Quotes share the invoice book: same math, QT- numbers, accept/decline instead of paid.
  const [docKind, setDocKind] = useState<'INVOICE' | 'QUOTE'>('INVOICE')
  const [kindFilter, setKindFilter] = useState<'ALL' | 'INVOICE' | 'QUOTE'>('ALL')
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

  // ---- Email the invoice/quote (campaigns-style composer) ----
  // The Send icon now opens a real composer: edit the message, pick the
  // sender's local part (the domain stays the verified one), copy the
  // accountant in, Gemini-draft it, and tick "listed client" so the CRM
  // record hears about the send on its own. Nothing sends until Send is
  // pressed — the icon is a door, not a trigger.
  const [sendInv, setSendInv] = useState<Invoice | null>(null)
  const [emailTo, setEmailTo] = useState('')
  const [emailCc, setEmailCc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [fromLocal, setFromLocal] = useState('')
  const [identityLocal, setIdentityLocal] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [listedClient, setListedClient] = useState(false)
  const [emailAttach, setEmailAttach] = useState<{ filename: string; content: string; sizeBytes: number } | null>(null)
  const [attachBusy, setAttachBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [geminiDraftId, setGeminiDraftId] = useState<string | null>(null)
  const [spendQuote, setSpendQuote] = useState<{ mode: 'ALLOWANCE' | 'AIRTIME' | 'EMPTY'; priceCents: number; allowanceRemaining: number; balanceCents: number } | null>(null)
  // The off-screen sheet the PDF is captured from — statements' one-sheet law:
  // the PDF is pixel-identical to the print preview by construction.
  const [hiddenInv, setHiddenInv] = useState<Invoice | null>(null)
  const hiddenInvRef = useRef<HTMLDivElement>(null)

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

  async function create() {
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
      const res = await api<{ invoice: Invoice; statementNote?: string }>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          kind: docKind,
          clientName, clientEmail, items, taxRate, pricesIncludeVat: vatMode === 'incl', notes, logoUrl,
          status: 'DRAFT', projectId: effProject !== 'ALL' ? effProject : (activeProjectId || undefined),
          bankDetails: bankLines(bank).join('\n'),
        }),
      })
      toast({ title: `${res.invoice.number} created ✓`, description: res.statementNote || 'Saved as draft.' })
      resetForm()
      setShowCreate(false)
      bumpRefresh()
      load() // load() re-derives the invoice-logo touchpoint from the fresh list
      // "Create & send" was checked → the composer opens on the fresh document.
      // Nothing is marked SENT until the email itself actually goes out.
      if (sendAfter) openSend(res.invoice)
    } catch (e) {
      toast({ title: 'Could not create invoice', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function setStatus(inv: Invoice, status: 'SENT' | 'PAID' | 'ACCEPTED' | 'DECLINED') {
    const isFirstPaid = status === 'PAID' && inv.status !== 'PAID' && invoices.filter((i) => i.status === 'PAID').length === 0
    try {
      const res = await api<{ invoice: Invoice; statementNote?: string }>(`/api/invoices/${inv.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast({ title: `${inv.number} → ${status}`, description: res.statementNote || undefined })
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

  // ---- Email the document: build the PDF from the REAL printable sheet ----
  // (statements' law: pixel-identical to the print preview by construction),
  // sliced across A4 pages when a long document outgrows one sheet.
  async function buildInvoicePdf(inv: Invoice) {
    setAttachBusy(true)
    try {
      const filename = `${kindOf(inv) === 'QUOTE' ? 'Quote' : 'Invoice'}-${inv.number}.pdf`
      setHiddenInv(inv)
      await new Promise((r) => setTimeout(r, 80)) // let React commit the sheet
      const el = hiddenInvRef.current?.querySelector('.invoice-sheet') as HTMLElement | null
      if (!el) throw new Error('The document sheet did not render.')
      const imgs = Array.from(el.querySelectorAll('img'))
      await Promise.all(imgs.map((im) => (im.complete && im.naturalWidth > 0 ? null : new Promise<void>((res) => { im.onload = () => res(); im.onerror = () => res() }))))
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')])
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false })
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true })
      // A4 at the canvas's own resolution: slice tall documents page by page.
      const pageH = Math.floor(canvas.width * (841.89 / 595.28))
      const pages = Math.max(1, Math.ceil(canvas.height / pageH))
      for (let p = 0; p < pages; p++) {
        if (p > 0) pdf.addPage()
        const sliceH = Math.min(pageH, canvas.height - p * pageH)
        if (pages === 1) {
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 595.28, 841.89)
        } else {
          const slice = document.createElement('canvas')
          slice.width = canvas.width
          slice.height = pageH
          const ctx = slice.getContext('2d')
          if (!ctx) throw new Error('The PDF could not be assembled.')
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, slice.width, slice.height)
          ctx.drawImage(canvas, 0, p * pageH, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
          pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, 595.28, 841.89)
        }
      }
      const content = (pdf.output('datauristring') || '').split(',')[1] || ''
      if (!content) throw new Error('The PDF came out empty.')
      setEmailAttach({ filename, content, sizeBytes: Math.floor(content.length * 0.75) })
    } catch (e) {
      toast({ title: 'Could not build the PDF', description: e instanceof Error ? e.message : 'You can still send without it.', variant: 'destructive' })
    } finally {
      setHiddenInv(null)
      setAttachBusy(false)
    }
  }

  /** The Send icon's door: prefill the composer, build the PDF, fetch the sender identity + spend quote. */
  function openSend(inv: Invoice) {
    const isQuote = kindOf(inv) === 'QUOTE'
    setSendInv(inv)
    setEmailTo(inv.clientEmail || '')
    setEmailCc(localStorage.getItem('hp-invoice-cc') || '')
    setShowCc(!!localStorage.getItem('hp-invoice-cc'))
    setFromLocal(localStorage.getItem('hp-invoice-from') || '')
    setListedClient(localStorage.getItem('hp-invoice-listed') === '1')
    setEmailSubject(`${isQuote ? 'Quote' : 'Invoice'} ${inv.number} — ${rands(inv.total * 100)}`)
    setEmailBody(invoiceEmailBody(inv, profile?.name || ''))
    setEmailAttach(null)
    setGeminiDraftId(null)
    setSpendQuote(null)
    buildInvoicePdf(inv)
    // Best-effort garnish: the user's own address on our domain + the airtime
    // truth BEFORE the button. The composer works without both.
    api<{ status: { sendingAs?: string; sendingDomain: string }; spend?: { mode: 'ALLOWANCE' | 'AIRTIME' | 'EMPTY'; priceCents: number; allowanceRemaining: number; balanceCents: number } | null }>('/api/emails/status')
      .then((s) => {
        const slug = s.status?.sendingAs?.split('@')[0] || ''
        setIdentityLocal(slug)
        if (!localStorage.getItem('hp-invoice-from') && slug) setFromLocal(slug)
        setSpendQuote(s.spend ?? null)
      })
      .catch(() => { /* cosmetic */ })
  }

  /** Gemini draft, right there in the composer — same door the Mail screen uses. */
  async function draftWithGemini() {
    if (!sendInv) return
    setDrafting(true)
    try {
      const isQuote = kindOf(sendInv) === 'QUOTE'
      const lines = itemsOf(sendInv).map((i) => i.description.trim()).filter(Boolean).join(', ')
      const due = sendInv.dueAt && !isQuote ? ` The due date is ${new Date(sendInv.dueAt).toLocaleDateString('en-ZA')}.` : ''
      const goal = `Email a${isQuote ? ' quote' : 'n invoice'} (${sendInv.number}) to ${sendInv.clientName} for ${rands(sendInv.total * 100)}${lines ? `, covering ${lines}` : ''}.${due} The PDF document is attached — mention it, keep the email short and professional, banking details are on the document.`
      const res = await api<{ draft: { id: string; subject: string; body: string } }>('/api/ai/generate-email', {
        method: 'POST',
        body: JSON.stringify({ to: emailTo || undefined, goal, clientName: sendInv.clientName, projectId: activeProjectId || undefined }),
      })
      setEmailSubject(res.draft.subject)
      setEmailBody(res.draft.body)
      setGeminiDraftId(res.draft.id)
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Gemini draft failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setDrafting(false)
    }
  }

  /** One press, the whole loop: send → log → flip the book's status → update the CRM (if ticked). */
  async function sendInvoiceEmail() {
    if (!sendInv) return
    if (!emailTo.trim().includes('@')) {
      toast({ title: 'Add the recipient', description: 'A valid email address is needed for this to go out.', variant: 'destructive' })
      return
    }
    if (!fromLocal.trim()) {
      toast({ title: 'Pick the sender', description: `Type the part before the @ — e.g. accounts — or keep your default.`, variant: 'destructive' })
      return
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      toast({ title: 'Subject and message are required', description: 'Edit the draft however you like, but keep both.', variant: 'destructive' })
      return
    }
    setSending(true)
    try {
      const res = await api<{
        email: { id: string }
        notice?: string | null
        sentFrom?: string | null
        spend?: { chargedCents: number; balanceAfter: number } | null
        crm?: { linked?: boolean; created?: boolean; ambiguous?: boolean; lead?: { company: string }; error?: string } | null
      }>('/api/emails', {
        method: 'POST',
        body: JSON.stringify({
          to: emailTo.trim(),
          cc: emailCc.trim() || undefined,
          fromLocal: fromLocal.trim(),
          subject: emailSubject.trim(),
          body: emailBody,
          attachments: emailAttach ? [{ filename: emailAttach.filename, content: emailAttach.content }] : undefined,
          projectId: activeProjectId || undefined,
          draftId: geminiDraftId || undefined,
          updateCrm: listedClient,
          leadName: sendInv.clientName,
          dealValue: sendInv.total,
          docLabel: `${kindOf(sendInv) === 'QUOTE' ? 'quote' : 'invoice'} ${sendInv.number}`,
        }),
      })
      // The book follows the email: a draft (or a declined quote being re-sent)
      // walks to SENT only once the email is actually out. Never the other way.
      if (sendInv.status === 'DRAFT' || sendInv.status === 'DECLINED') {
        try {
          await api(`/api/invoices/${sendInv.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'SENT' }) })
        } catch { /* the email went out; a status stumble must not read as failure */ }
      }
      localStorage.setItem('hp-invoice-cc', emailCc.trim())
      localStorage.setItem('hp-invoice-from', fromLocal.trim())
      localStorage.setItem('hp-invoice-listed', listedClient ? '1' : '0')
      const crmBit = res.crm?.linked
        ? `Logged on ${res.crm.lead?.company}'s CRM record ✓`
        : res.crm?.created
          ? `Added ${res.crm.lead?.company} to your CRM as a new client ✓`
          : res.crm?.ambiguous
            ? 'Two or more CRM clients match this address — the record was left alone, no guessing.'
            : res.crm?.error
              ? `Heads up: the CRM update failed (${res.crm.error}).`
              : null
      const spendBit = res.spend?.chargedCents ? `${rands(res.spend.chargedCents)} airtime spent · ${rands(res.spend.balanceAfter)} left in the wallet` : null
      toast({
        title: `${sendInv.number} emailed ✓`,
        description: [crmBit, res.sentFrom ? `From ${res.sentFrom}` : null, spendBit, res.notice].filter(Boolean).join(' · ') || `${emailAttach ? emailAttach.filename : 'No PDF'} → ${emailTo.trim()}`,
      })
      setSendInv(null)
      setGeminiDraftId(null)
      bumpRefresh()
      load()
    } catch (e) {
      toast({ title: 'The email did not go out', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  // Notion style rename from the list itself. The PATCH is the same one the
  // editor uses, owner scoped, and the number series never moves.
  async function renameInvoice(id: string, clientName: string) {
    try {
      await api(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify({ clientName }) })
      setInvoices((rows) => rows.map((r) => (r.id === id ? { ...r, clientName } : r)))
      toast({ title: 'Renamed ✓' })
    } catch (e) {
      toast({ title: 'Rename failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
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
          <p className="text-sm text-muted-foreground">VAT-ready ZAR invoices and quotes with your logo — print, PDF via the browser, or mark as sent.</p>
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
          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as 'ALL' | 'INVOICE' | 'QUOTE')}>
            <SelectTrigger className="w-[150px]" aria-label="Document type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All documents</SelectItem>
              <SelectItem value="INVOICE">Invoices</SelectItem>
              <SelectItem value="QUOTE">Quotes</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => { setDocKind('QUOTE'); setShowCreate((s) => !s || docKind !== 'QUOTE') }}
          >
            <FileText className="h-4 w-4" /> New quote
          </Button>
          <Button onClick={() => { setDocKind('INVOICE'); setShowCreate((s) => !s || docKind !== 'INVOICE') }}>
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
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">New {docKind === 'QUOTE' ? 'quote' : 'invoice'}</h3>
              <div className="flex rounded-md border overflow-hidden text-xs" role="group" aria-label="Document type">
                <button
                  type="button"
                  onClick={() => setDocKind('INVOICE')}
                  className={`px-2.5 py-1 transition ${docKind === 'INVOICE' ? 'bg-brand text-black font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setDocKind('QUOTE')}
                  className={`px-2.5 py-1 transition border-l ${docKind === 'QUOTE' ? 'bg-brand text-black font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Quote
                </button>
              </div>
            </div>
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
              Open the email as soon as it's created
            </label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="i-notes">Notes (optional)</Label>
            <Textarea id="i-notes" rows={2} placeholder="Payment due in 14 days. Banking: FNB 6284…, reference INV-number." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => create()} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : docKind === 'QUOTE' ? <FileText className="h-4 w-4" /> : <ReceiptText className="h-4 w-4" />}
              {docKind === 'QUOTE'
                ? `Create quote${sendAfter ? ' & email it' : ' draft'}`
                : `Create ${sendAfter ? '& email' : 'draft'}`}
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
        ) : (() => {
            const shown = kindFilter === 'ALL' ? invoices : invoices.filter((i) => kindOf(i) === kindFilter)
            if (shown.length === 0) {
              return (
                <p className="text-sm text-muted-foreground py-12 text-center">
                  {kindFilter === 'QUOTE' ? 'No quotes yet, create your first one above.' : kindFilter === 'INVOICE' ? 'No invoices yet, create your first one above.' : 'Nothing here yet, create your first invoice or quote above.'}
                </p>
              )
            }
            return (
              <div className="divide-y">
                {shown.map((inv) => {
                  const isQuote = kindOf(inv) === 'QUOTE'
                  return (
                    <div key={inv.id} className="p-3.5 flex flex-wrap items-center gap-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {inv.number} · <DocTitle inv={inv} onRenamed={renameInvoice} />
                          {isQuote && (
                            <Badge variant="outline" className="ml-2 text-[10px] h-4 border-brand/50 text-brand align-middle">QUOTE</Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {itemsOf(inv).length} item{itemsOf(inv).length === 1 ? '' : 's'} · {isQuote ? 'valid until' : 'due'} {inv.dueAt ? new Date(inv.dueAt).toLocaleDateString('en-ZA') : '—'}
                        </p>
                      </div>
                      <span className="font-display text-brand text-lg">{rands(inv.total * 100)}</span>
                      <Badge variant="outline" className={STATUS_STYLES[inv.status] ?? ''}>{inv.status}</Badge>
                      <div className="flex items-center gap-1.5">
                        {inv.status === 'DRAFT' && (
                          <button onClick={() => openSend(inv)} title={`Email this ${isQuote ? 'quote' : 'invoice'}`} className="rounded-full border p-1.5 hover:border-brand transition">
                            <Send className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {!isQuote && inv.status === 'OVERDUE' && (
                          <button onClick={() => openSend(inv)} title="Email again (payment reminder)" className="rounded-full border p-1.5 hover:border-brand transition">
                            <Send className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {!isQuote && (inv.status === 'SENT' || inv.status === 'OVERDUE') && (
                          <button onClick={() => setStatus(inv, 'PAID')} title="Mark as paid" className="rounded-full border p-1.5 hover:border-emerald-500 transition text-emerald-500">
                            ✓
                          </button>
                        )}
                        {isQuote && inv.status === 'SENT' && (
                          <>
                            <button onClick={() => setStatus(inv, 'ACCEPTED')} title="Mark as accepted" className="rounded-full border p-1.5 hover:border-emerald-500 transition text-emerald-500">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setStatus(inv, 'DECLINED')} title="Mark as declined" className="rounded-full border p-1.5 hover:border-rose-500 transition text-rose-400">
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        {isQuote && inv.status === 'DECLINED' && (
                          <button onClick={() => openSend(inv)} title="Send again (revised quote)" className="rounded-full border p-1.5 hover:border-brand transition">
                            <Send className="h-3.5 w-3.5" />
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
                  )
                })}
              </div>
            )
          })()}
      </div>

      {/* Direct line to the team, shared with every touchpoint on the platform */}
      <ServiceRequestDialog open={reqOpen} onOpenChange={setReqOpen} service={reqService} presetMessage={reqPreset} />
      </div>

      {/* Printable template lives OUTSIDE the print:hidden container above.
          Inside it, printing hid the invoice itself and produced a blank page. */}
      {printable && <InvoicePrint invoice={printable} profile={profile} bankFallback={bank} onDone={() => setPrintable(null)} />}

      {/* The off-screen sheet the emailed PDF is captured from — the SAME DOM
          the printer gets, so the attachment is pixel-identical to the paper. */}
      {hiddenInv && (
        <div ref={hiddenInvRef} aria-hidden className="fixed top-0 -left-[9999px] -z-50">
          <InvoiceSheet invoice={hiddenInv} profile={profile} bankFallback={bank} />
        </div>
      )}

      {/* The composer the Send icon opens: campaigns-style, nothing sends until Send. */}
      <Dialog open={!!sendInv} onOpenChange={(o) => { if (!o) { setSendInv(null); setGeminiDraftId(null) } }}>
        <DialogContent className="sm:max-w-xl">
          {sendInv && (
            <>
              <DialogHeader>
                <DialogTitle>Email {kindOf(sendInv) === 'QUOTE' ? 'quote' : 'invoice'} — {sendInv.number}</DialogTitle>
                <DialogDescription>
                  Edit anything, pick the sender, copy the accountant in. Nothing sends until you press Send — the PDF rides along.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">To</label>
                  <Input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="client@email.co.za" />
                  {!sendInv.clientEmail && (
                    <p className="text-[11px] text-muted-foreground">No email on the document yet — type where it must go.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  {!showCc ? (
                    <button type="button" onClick={() => setShowCc(true)} className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                      <Paperclip className="h-3 w-3 rotate-45" /> Copy someone in (CC)
                    </button>
                  ) : (
                    <>
                      <label className="text-xs text-muted-foreground">Cc — copies land in their inbox too</label>
                      <Input
                        type="text"
                        value={emailCc}
                        onChange={(e) => setEmailCc(e.target.value)}
                        placeholder="accounts@businesshustle.co.za"
                      />
                      <p className="text-[11px] text-muted-foreground">Comma-separate for more than one. Remembered for next time.</p>
                    </>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">From — type the part before the @</label>
                  <div className="flex items-stretch rounded-md border overflow-hidden focus-within:ring-1 focus-within:ring-brand">
                    <Input
                      className="border-0 rounded-none focus-visible:ring-0"
                      value={fromLocal}
                      onChange={(e) => setFromLocal(e.target.value)}
                      placeholder="accounts"
                      aria-label="Sender email name"
                      list="invoice-from-ideas"
                    />
                    <span className="flex items-center px-2.5 text-xs text-muted-foreground bg-white/5 border-l select-none">@{FROM_DOMAIN}</span>
                  </div>
                  <datalist id="invoice-from-ideas">
                    {identityLocal && <option value={identityLocal} />}
                    {FROM_IDEAS.map((idea) => <option key={idea} value={idea} />)}
                  </datalist>
                  <p className="text-[11px] text-muted-foreground">Only the part before the @ is yours — the domain stays the verified one, so every send signs properly. Replies route to your account email.</p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Subject" />
                    <Button type="button" variant="outline" size="sm" onClick={draftWithGemini} disabled={drafting} className="shrink-0 gap-1.5">
                      {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-brand" />}
                      Gemini
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Tap Gemini for a first draft of the message — then edit it like your own.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Message</label>
                  <Textarea rows={10} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={listedClient} onChange={(e) => setListedClient(e.target.checked)} className="mt-0.5 accent-yellow-400" />
                  <span>Listed client — log this send on their CRM record automatically ('Email "{emailSubject.trim() || sendInv.number}" sent to {emailTo.trim() || 'them'}' lands on their timeline; if nobody matches, they're added as a new client).</span>
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    {attachBusy ? (
                      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building {kindOf(sendInv) === 'QUOTE' ? 'quote' : 'invoice'} PDF…</span>
                    ) : emailAttach ? (
                      <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs min-w-0">
                        <FileText className="h-3.5 w-3.5 text-brand shrink-0" />
                        <span className="truncate">{emailAttach.filename}</span>
                        <span className="text-muted-foreground shrink-0">{(emailAttach.sizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                        <button onClick={() => setEmailAttach(null)} aria-label="Remove PDF" className="text-muted-foreground hover:text-foreground shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => buildInvoicePdf(sendInv)} className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline">
                        <Paperclip className="h-3.5 w-3.5" /> Attach the PDF
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" onClick={() => { setSendInv(null); setGeminiDraftId(null) }}>Cancel</Button>
                    <Button onClick={sendInvoiceEmail} disabled={sending || attachBusy} className="gap-2">
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
                    </Button>
                  </div>
                </div>
                {spendQuote && (
                  <p className="text-[11px] text-muted-foreground">
                    {spendQuote.mode === 'ALLOWANCE'
                      ? `${spendQuote.allowanceRemaining} included send${spendQuote.allowanceRemaining === 1 ? '' : 's'} left this cycle.`
                      : spendQuote.mode === 'AIRTIME'
                        ? `${rands(spendQuote.priceCents)} airtime per send · wallet ${rands(spendQuote.balanceCents)}. A failed send never costs a cent.`
                        : 'This send needs airtime — load credits in the Wallet.'}
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function InvoicePrint({ invoice, profile, bankFallback, onDone }: { invoice: Invoice; profile: ProjectFull | null; bankFallback: BankDetails | null; onDone: () => void }) {
  // Print law v2, no :has() dependency: announce on body while the sheet is
  // mounted so browsers WITHOUT :has() still get sheet only printing. The class
  // leaves with the sheet, so ordinary printing is untouched.
  useEffect(() => {
    document.body.classList.add('invoice-printing')
    return () => document.body.classList.remove('invoice-printing')
  }, [])
  // Portal to document.body so the sheet is a DIRECT child of body: the print law
  // in globals.css (body:has(#invoice-print-root) > *:not(#invoice-print-root))
  // then hides the ENTIRE app tree on print. Tutorial, toasts, tours and any
  // future chrome physically cannot reach the paper. Only the invoice prints.
  return createPortal(
    <div id="invoice-print-root" className="fixed inset-0 z-[60] bg-black/70 overflow-auto p-4 print:static print:bg-white print:text-black print:p-0 print:z-auto">
      <InvoiceSheet invoice={invoice} profile={profile} bankFallback={bankFallback} />
      <div className="max-w-[820px] mx-auto flex justify-end gap-2 py-3 print:hidden">
        <Button variant="outline" onClick={onDone}>Close</Button>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save PDF</Button>
      </div>
    </div>,
    document.body
  )
}

/** The printable sheet itself — shared by the print modal and the emailed-PDF
 *  capture, so the paper and the attachment can never drift apart. */
function InvoiceSheet({ invoice, profile, bankFallback }: { invoice: Invoice; profile: ProjectFull | null; bankFallback: BankDetails | null }) {
  const items = itemsOf(invoice)
  const vat = invoice.total - invoice.subtotal
  const isQuote = kindOf(invoice) === 'QUOTE'
  // Prefer the snapshot saved on the invoice; fall back to current settings for older invoices.
  const bankBlock = invoice.bankDetails?.trim()
    ? invoice.bankDetails.trim()
    : bankFallback
      ? bankLines(bankFallback).join('\n')
      : ''
  return (
      <div className="max-w-[820px] mx-auto bg-white text-black rounded-lg shadow-2xl print:shadow-none print:rounded-none print:max-w-none invoice-sheet">
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
              <div className="font-display text-3xl">{isQuote ? 'QUOTE' : 'INVOICE'}</div>
              <p className="text-sm font-semibold">{invoice.number}</p>
              <p className="text-xs text-neutral-500">Issued {new Date(invoice.issuedAt).toLocaleDateString('en-ZA')}</p>
              {invoice.dueAt && <p className="text-xs text-neutral-500">{isQuote ? 'Valid until' : 'Due'} {new Date(invoice.dueAt).toLocaleDateString('en-ZA')}</p>}
              <p className={`text-xs font-bold mt-1 ${invoice.status === 'PAID' || invoice.status === 'ACCEPTED' ? 'text-emerald-700' : invoice.status === 'OVERDUE' || invoice.status === 'DECLINED' ? 'text-rose-700' : 'text-neutral-700'}`}>
                {isQuote && invoice.status === 'ACCEPTED' ? 'ACCEPTED' : invoice.status}
              </p>
            </div>
          </div>

          <div className="py-6">
            <p className="text-[10px] uppercase tracking-widest text-neutral-400">{isQuote ? 'Prepared for' : 'Billed to'}</p>
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
          {isQuote && (
            <p className="mt-4 text-xs text-neutral-500">Quote valid until the valid-until date above. Accept to kick off the work — an invoice follows.</p>
          )}
          {invoice.notes && <div className="mt-6 text-xs text-neutral-500 whitespace-pre-line">{invoice.notes}</div>}
          <p className="mt-8 text-center text-[10px] text-neutral-400">
            Powered by Business Hustle · www.businesshustle.co.za
          </p>
        </div>
      </div>
  )
}
