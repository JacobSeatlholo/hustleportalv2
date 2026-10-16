'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api, rands } from './shared'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Loader2, KeyRound, Users, Target, Coins, Eye, EyeOff, Save, TrendingUp, Crown, Gift,
  Repeat2, Trophy, UserPlus, Wallet, Search, Play, Pause, Plus, RefreshCw, Briefcase,
  Building2, ReceiptText, History, CircleDot, Sparkles, X, Check, CreditCard, ShieldCheck,
  Flame, ExternalLink, HandCoins, CalendarClock, Link2, MessageSquare,
} from 'lucide-react'

// =================== Executive Dashboard ===================
// The business owner's control room: every client, their plan, their money,
// their pipeline. Pause or restore accounts, and load leads into any client's
// pipeline straight from here.

interface Kpis {
  members: number
  qaAccounts: number
  realMembers: number
  new7: number
  new30: number
  subscribers: number
  mrrCents: number
  subsPastDue: number
  subsPaused: number
  subsCanceled: number
  topups30dCents: number
  sandboxTopups30dCents: number
  testMrrCents: number
  walletFloatCents: number
  leadsPlatform: number
  poolNew: number
  poolArrivals24h: number
  suspended: number
  meetingsSet?: number
  meetingsConfirmed?: number
  meetingsAwaiting?: number
}

interface RosterRow {
  id: string
  name: string
  email: string
  businessName: string | null
  city: string | null
  industry: string | null
  joinedAt: string
  accountStatus: string
  suspendedAt: string | null
  isAdmin: boolean
  isQa: boolean
  walletCents: number
  plan: string | null
  subStatus: string
  subCycle: string | null
  subAmountCents: number
  renewsAt: string | null
  npoNumber: string | null
  counts: { leads: number; clients: number; invoices: number; projects: number }
  poolCount: number
  lastActiveAt: string | null
}

interface ExecData {
  kpis: Kpis
  roster: RosterRow[]
  meetings?: MeetingRow[]
  meetingsKpi?: { total: number; confirmed: number; awaiting: number; declined: number }
  payments?: {
    keyMode: 'live' | 'test' | null
    webhookConfigured: boolean
    webhookSource: string
    webhookMode: 'live' | 'test' | null
    recent: {
      id: string
      amountCents: number
      creditCents: number
      provider: string
      reference: string
      paidAt: string | null
      createdAt: string
      clientName: string
      clientBusiness: string | null
    }[]
  }
}

interface MeetingRow {
  id: string
  title: string
  memberName: string
  memberEmail: string
  memberBusiness: string | null
  guestName: string | null
  guestEmail: string
  startsAt: string
  endsAt: string | null
  meetLink: string | null
  location?: string | null
  status: string
  invitedAt: string | null
  confirmedAt: string | null
  createdAt: string
  shareToken?: string | null
  comments?: number
}

interface TopUpRow {
  id: string
  packageId: string
  amountCents: number
  creditCents: number
  status: string
  provider: string
  reference: string
  providerRef: string | null
  createdAt: string
  paidAt: string | null
}

interface TxRow {
  id: string
  type: string
  amount: number
  description: string
  balanceAfter: number
  createdAt: string
}

interface ProjectRow {
  id: string
  name: string
  isDefault: boolean
  industry: string | null
  createdAt: string
  counts: { leads: number; clients: number; invoices: number }
}

interface InvoiceRow {
  id: string
  number: string
  clientName: string
  status: string
  total: number
  issuedAt: string
  paidAt: string | null
}

interface PoolRow {
  id: string
  company: string
  contactName: string | null
  role: string | null
  profileUrl: string | null
  email: string | null
  phone: string | null
  website: string | null
  industry: string | null
  city: string | null
  country: string | null
  source: string
  sourceRef: string | null
  why: string | null
  score: number | null
  status: string
  leadId: string | null
  createdAt: string
  addedAt: string | null
}

interface CampaignRow {
  id: string
  mode: string
  leadCount: number
  fromPool: boolean
  createdAt: string
}

interface ClientDetail {
  client: {
    id: string
    email: string
    name: string
    businessName: string | null
    industry: string | null
    city: string | null
    phone: string | null
    isAdmin: boolean
    accountStatus: string
    suspendedAt: string | null
    suspendReason: string | null
    createdAt: string
    wallet: { balance: number }
    subscription: {
      plan: string
      status: string
      billingCycle: string
      amountCents: number
      provider: string
      reference: string
      npoNumber: string | null
      pausedUntil: string | null
      startedAt: string | null
      renewsAt: string | null
    } | null
    subStatus: string
  }
  payments: { topups: TopUpRow[]; creditTxs: TxRow[] }
  projects: ProjectRow[]
  pipeline: { stages: Record<string, number>; total: number }
  pool: { rows: PoolRow[]; counts: { NEW: number; ADDED: number; DISMISSED: number }; campaigns: CampaignRow[] }
  clientsCount: number
  invoices: InvoiceRow[]
}

function timeAgo(iso?: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  return `${w}w ago`
}

function fmtDate(iso?: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

const PLAN_LABEL: Record<string, string> = { HUSTLER: 'Operator', BOSS: 'Boss' }

function PlanChip({ plan, cycle }: { plan: string | null; cycle: string | null }) {
  if (!plan) return <Badge variant="outline" className="text-[10px] text-muted-foreground">No plan</Badge>
  return (
    <Badge className="bg-brand/15 text-brand border border-brand/30 text-[10px] hover:bg-brand/15">
      {PLAN_LABEL[plan] || plan}{cycle === 'ANNUAL' ? ' · Annual' : ''}
    </Badge>
  )
}

function SubChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: 'Paying', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    PAST_DUE: { label: 'Past due', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    PAUSED: { label: 'Plan paused', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
    CANCELED: { label: 'Canceled', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
    PENDING: { label: 'Checkout open', cls: 'bg-white/10 text-muted-foreground border-white/15' },
    NONE: { label: 'Free', cls: 'bg-white/10 text-muted-foreground border-white/15' },
  }
  const s = map[status] || map.NONE
  return <Badge variant="outline" className={`text-[10px] border ${s.cls}`}>{s.label}</Badge>
}

function AcctChip({ status }: { status: string }) {
  if (status === 'SUSPENDED') {
    return <Badge variant="outline" className="text-[10px] bg-rose-500/15 text-rose-400 border-rose-500/30"><Pause className="h-2.5 w-2.5 mr-1" />Paused</Badge>
  }
  return <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/25"><CircleDot className="h-2.5 w-2.5 mr-1" />Active</Badge>
}

const STAGE_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', QUOTE_SENT: 'Quote sent', WON: 'Won', LOST: 'Lost',
}

// =================== Pause dialog (shared: roster row + drawer) ===================

function PauseDialog({ target, onOpenChange, onDone }: {
  target: RosterRow | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setReason('') }, [target?.id])

  async function confirmPause() {
    if (!target) return
    setBusy(true)
    try {
      await api(`/api/admin/exec/client/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'SUSPENDED', reason: reason.trim() || undefined }),
      })
      toast({ title: `${target.name} is paused`, description: 'They are signed out and cannot sign in until you restore them.' })
      onOpenChange(false)
      onDone()
    } catch (e) {
      toast({ title: 'Could not pause', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={!!target} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pause {target?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They lose access the moment you confirm: every screen locks, sign in is refused with a friendly
            message. Their data, leads and wallet stay exactly as they are. You can restore them in one tap.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pause-reason">Reason (they will see this when support asks)</Label>
          <Textarea id="pause-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Payment conversation open" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep them active</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-rose-600 text-white hover:bg-rose-700"
            onClick={(e) => { e.preventDefault(); confirmPause() }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4 mr-1" />} Pause account
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// =================== Add leads dialog ===================

interface LeadDraft {
  company?: string
  contactName?: string
  role?: string
  email?: string
  phone?: string
  website?: string
  industry?: string
  city?: string
  value?: number
  notes?: string
}

function parseBulk(text: string): LeadDraft[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*[|,;]\s*/)
      const [company, contactName = '', phone = '', email = '', city = ''] = parts
      return {
        company: company?.trim() || undefined,
        contactName: contactName?.trim() || undefined,
        phone: phone?.trim() || undefined,
        email: email?.trim() || undefined,
        city: city?.trim() || undefined,
      }
    })
    .filter((l) => l.company)
}

function AddLeadsDialog({ clientId, clientName, open, onOpenChange, onDone }: {
  clientId: string
  clientName: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [source, setSource] = useState('EXPLEE')
  const [busy, setBusy] = useState(false)
  const [company, setCompany] = useState('')
  const [contactName, setContactName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [city, setCity] = useState('')
  const [industry, setIndustry] = useState('')
  const [value, setValue] = useState('')
  const [bulk, setBulk] = useState('')

  function reset() {
    setCompany(''); setContactName(''); setRole(''); setPhone(''); setEmail(''); setWebsite(''); setCity(''); setIndustry(''); setValue(''); setBulk('')
  }

  async function submit(leads: LeadDraft[]) {
    if (leads.length === 0) {
      toast({ title: 'Nothing to load yet', description: 'Add a company name first.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await api<{ message?: string; created?: number }>(`/api/admin/exec/client/${clientId}/leads`, {
        method: 'POST',
        body: JSON.stringify({ source, leads }),
      })
      toast({ title: 'Leads delivered', description: res.message || `Loaded into ${clientName}'s pipeline.` })
      reset()
      onOpenChange(false)
      onDone()
    } catch (e) {
      toast({ title: 'Could not load leads', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto hp-scroll">
        <DialogHeader>
          <DialogTitle>Load leads into {clientName}&apos;s pipeline</DialogTitle>
          <DialogDescription>
            Paste a lead from your outreach or type one from a call. They land in stage New, in their default workspace,
            the moment you save. Duplicates are skipped automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Where do these come from?</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EXPLEE">Team outreach</SelectItem>
              <SelectItem value="MANUAL">Typed by me</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="single">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="single">One lead</TabsTrigger>
            <TabsTrigger value="bulk">Paste a list</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label>Company *</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Thabo Plumbers" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contact person</Label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Thabo N." />
              </div>
              <div className="space-y-1.5">
                <Label>Their role</Label>
                <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Owner" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 555 1234" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@company.co.za" />
              </div>
              <div className="space-y-1.5">
                <Label>Website</Label>
                <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="company.co.za" />
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Soweto" />
              </div>
              <div className="space-y-1.5">
                <Label>Industry</Label>
                <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Plumbing" />
              </div>
              <div className="space-y-1.5">
                <Label>Deal value (R)</Label>
                <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="2500" />
              </div>
            </div>
            <Button className="w-full" disabled={busy} onClick={() => submit([{
              company, contactName: contactName || undefined, role: role || undefined, phone: phone || undefined,
              email: email || undefined, website: website || undefined, city: city || undefined,
              industry: industry || undefined, value: Number(value) || undefined,
            }])}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Load into pipeline
            </Button>
          </TabsContent>

          <TabsContent value="bulk" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label>One lead per line</Label>
              <Textarea
                rows={7}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={"Company | Contact | Phone | Email | City\nThabo Plumbers | Thabo N. | 082 555 1234 | thabo@example.co.za | Soweto\nMama's Kitchen | Nomsa | 071 222 3344 | | Johannesburg"}
              />
              <p className="text-xs text-muted-foreground">
                Separate with pipes or commas. Company name first, the rest is optional. Extras like website can be
                edited later by the client.
              </p>
            </div>
            <Button className="w-full" disabled={busy} onClick={() => submit(parseBulk(bulk))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Load list into pipeline
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// =================== Lead pool card (the campaign bench) ===================
// Every campaign's results wait here per client. The owner reviews and adds
// the winners to the client's pipeline in one tap. Nothing lands in the
// client's pipeline without that tap.

function PoolCard({ detail, busy, onRun, onAction }: {
  detail: ClientDetail
  busy: boolean
  onRun: (definition: string, city: string) => void
  onAction: (action: 'add' | 'addAll' | 'dismiss', ids: string[]) => void
}) {
  const pool = detail.pool
  const waiting = pool.rows.filter((r) => r.status === 'NEW')
  const addedShown = pool.rows.filter((r) => r.status === 'ADDED').slice(-4).reverse()
  const [open, setOpen] = useState(true)
  const [def, setDef] = useState('')
  const [city, setCity] = useState('')
  const [showInputs, setShowInputs] = useState(false)
  const lastCampaign = pool.campaigns[0]

  return (
    <div className="p-5 py-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-brand" /> Lead pool
          {pool.counts.NEW > 0 && (
            <Badge className="bg-brand text-black hover:bg-brand text-[10px]">{pool.counts.NEW} waiting</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setShowInputs((s) => !s)} className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            search words
          </button>
          <Button size="sm" className="h-7 bg-brand text-black hover:bg-brand/90" disabled={busy} onClick={() => onRun(def, city)}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3 w-3 mr-1" />} Run campaign
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-2">
        Campaigns run for them the moment they load credit. Fresh faces wait here for your review, nothing reaches their pipeline until you add it.
      </p>

      {showInputs && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <Input value={def} onChange={(e) => setDef(e.target.value)} placeholder="Custom search words (their profile fills this)" className="h-8 text-xs" />
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder={`Area (default: ${detail.client.city || 'South Africa'})`} className="h-8 text-xs" />
        </div>
      )}

      {lastCampaign && (
        <div className="text-[10px] text-muted-foreground mb-2">
          Last campaign {timeAgo(lastCampaign.createdAt)} · {lastCampaign.fromPool ? 'Verified pool' : 'Live search'} · {lastCampaign.leadCount} added
          {pool.campaigns.length > 1 ? ` · ${pool.campaigns.length} recent` : ''}
        </div>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
        {open ? 'hide list' : `show list (${waiting.length})`}
      </button>

      {open && (
        <div className="rounded-lg border divide-y max-h-72 overflow-y-auto hp-scroll mt-1.5">
          {waiting.length === 0 && addedShown.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              Empty for now. Run a campaign above, or it fires on its own the next time {detail.client.name.split(' ')[0]} loads credit.
            </div>
          )}
          {waiting.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {r.company}
                  {r.contactName ? <span className="text-muted-foreground font-normal"> · ask for {r.contactName}{r.role ? ` (${r.role})` : ''}</span> : ''}
                </div>
                <div className="text-muted-foreground truncate">
                  {[r.city, r.industry, r.phone, r.email].filter(Boolean).join(' · ') || 'no contact facts yet'}
                </div>
                {r.why && <div className="text-[10px] text-muted-foreground/80 truncate italic">&ldquo;{r.why}&rdquo;</div>}
              </div>
              <Badge variant="outline" className={`text-[9px] shrink-0 ${r.source === 'EXPLEE' ? 'border-brand/40 text-brand' : 'border-emerald-500/40 text-emerald-400'}`}>
                {r.source === 'EXPLEE' ? 'Team verified' : 'Verified pool'}
              </Badge>
              <Button size="sm" variant="outline" className="h-7 shrink-0 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" disabled={busy} onClick={() => onAction('add', [r.id])}>
                <Check className="h-3 w-3 mr-0.5" /> Add
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-rose-400" disabled={busy} onClick={() => onAction('dismiss', [r.id])}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {waiting.length > 1 && (
            <div className="px-3 py-2">
              <Button size="sm" variant="outline" className="w-full h-7 border-brand/40 text-brand hover:bg-brand/10" disabled={busy} onClick={() => onAction('addAll', [])}>
                <Plus className="h-3 w-3 mr-1" /> Add all {waiting.length} to their pipeline
              </Button>
            </div>
          )}
          {addedShown.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-xs opacity-60">
              <div className="min-w-0 flex-1 truncate">{r.company}</div>
              <Badge variant="outline" className="text-[9px] shrink-0 border-emerald-500/30 text-emerald-400">In pipeline</Badge>
            </div>
          ))}
          {pool.counts.DISMISSED > 0 && (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground">{pool.counts.DISMISSED} set aside on past campaigns.</div>
          )}
        </div>
      )}
    </div>
  )
}

// =================== Client drawer ===================

function ClientSheet({ id, onClose, onChanged, onPauseRequest }: {
  id: string | null
  onClose: () => void
  onChanged: () => void
  onPauseRequest: (row: RosterRow) => void
}) {
  const { toast } = useToast()
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [addOpen, setAddOpen] = useState(false)
  const [poolBusy, setPoolBusy] = useState(false)

  async function runCampaign(definition: string, city: string) {
    if (!id) return
    setPoolBusy(true)
    try {
      const r = await api<{ message: string }>(`/api/admin/exec/client/${id}/pool`, {
        method: 'POST',
        body: JSON.stringify({
          ...(definition.trim() ? { definition: definition.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
        }),
      })
      toast({ title: 'Campaign done', description: r.message })
      setTick((t) => t + 1); onChanged()
    } catch (e) {
      toast({ title: 'Campaign did not run', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setPoolBusy(false)
    }
  }

  async function poolAction(action: 'add' | 'addAll' | 'dismiss', ids: string[]) {
    if (!id) return
    setPoolBusy(true)
    try {
      const r = await api<{ message: string }>(`/api/admin/exec/client/${id}/pool`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ids }),
      })
      toast({ title: action === 'dismiss' ? 'Set aside' : 'Into their pipeline', description: r.message })
      setTick((t) => t + 1); onChanged()
    } catch (e) {
      toast({ title: 'Could not update the pool', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setPoolBusy(false)
    }
  }

  useEffect(() => {
    if (!id) return
    let alive = true
    api<ClientDetail>(`/api/admin/exec/client/${id}`)
      .then((d) => { if (alive) { setDetail(d); setLoadedId(id) } })
      .catch((e) => {
        if (alive) toast({ title: 'Could not open client', description: e instanceof Error ? e.message : '', variant: 'destructive' })
      })
    return () => { alive = false }
  }, [id, tick])

  const fresh = detail && loadedId === id ? detail : null
  const c = fresh?.client
  const sub = c?.subscription

  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto hp-scroll p-0">
        {!c ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-16 rounded-xl" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-40 rounded-xl" />
          </div>
        ) : (
          <div className="divide-y">
            {/* Identity */}
            <div className="p-5 pb-4">
              <SheetHeader className="p-0 text-left">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-full bg-brand/15 text-brand flex items-center justify-center text-lg font-bold shrink-0">
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-lg leading-tight">{c.name}{c.businessName ? <span className="text-muted-foreground font-normal"> · {c.businessName}</span> : null}</SheetTitle>
                    <SheetDescription className="text-xs">{c.email}{c.city ? ` · ${c.city}` : ''}{c.industry ? ` · ${c.industry}` : ''}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <AcctChip status={c.accountStatus} />
                <PlanChip plan={c.subscription?.plan ?? null} cycle={c.subscription?.billingCycle ?? null} />
                <SubChip status={c.subStatus} />
                {c.isAdmin && <Badge className="bg-sidebar text-white hover:bg-sidebar text-[10px]">exec</Badge>}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Joined {fmtDate(c.createdAt)} · {c.accountStatus === 'SUSPENDED' ? 'Access paused' : 'Access active'}
              </div>
              {c.accountStatus === 'SUSPENDED' && (
                <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300">
                  Paused {c.suspendedAt ? timeAgo(c.suspendedAt) : ''}{c.suspendReason ? ` · ${c.suspendReason}` : ''}
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                {!c.isAdmin && (
                  c.accountStatus === 'SUSPENDED' ? (
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={false}
                      onClick={async () => {
                        try {
                          await api(`/api/admin/exec/client/${c.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) })
                          toast({ title: `${c.name} is back on`, description: 'They can sign in again right now. Nothing was lost.' })
                          setTick((t) => t + 1); onChanged()
                        } catch (e) {
                          toast({ title: 'Could not restore', description: e instanceof Error ? e.message : '', variant: 'destructive' })
                        }
                      }}>
                      <Play className="h-4 w-4 mr-1" /> Restore access
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                      onClick={() => onPauseRequest({
                        id: c.id, name: c.name, email: c.email, businessName: c.businessName, city: c.city,
                        industry: c.industry, joinedAt: c.createdAt, accountStatus: c.accountStatus,
                        suspendedAt: c.suspendedAt, isAdmin: c.isAdmin, isQa: Boolean(c.email?.toLowerCase().endsWith('@hustleqa.example.com')), walletCents: c.wallet?.balance ?? 0,
                        plan: c.subscription?.plan ?? null, subStatus: c.subStatus, subCycle: c.subscription?.billingCycle ?? null,
                        subAmountCents: c.subscription?.amountCents ?? 0, renewsAt: c.subscription?.renewsAt ?? null,
                        npoNumber: c.subscription?.npoNumber ?? null,
                        counts: { leads: detail?.pipeline.total ?? 0, clients: detail?.clientsCount ?? 0, invoices: detail?.invoices.length ?? 0, projects: detail?.projects.length ?? 0 },
                        poolCount: detail?.pool.counts.NEW ?? 0,
                        lastActiveAt: null,
                      })}>
                      <Pause className="h-4 w-4 mr-1" /> Pause account
                    </Button>
                  )
                )}
                <Button size="sm" className="bg-brand text-black hover:bg-brand/90" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Add leads
                </Button>
              </div>
            </div>

            {/* Plan */}
            {sub && (
              <div className="p-5 py-4">
                <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-brand" /> Plan</div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-medium">{PLAN_LABEL[sub.plan] || sub.plan}</span>
                  <span className="text-muted-foreground">{rands(sub.amountCents)}{sub.billingCycle === 'ANNUAL' ? ' / year' : ' / month'}</span>
                  {sub.renewsAt && <span className="text-muted-foreground">Renews {fmtDate(sub.renewsAt)}</span>}
                  {sub.npoNumber && <Badge variant="outline" className="text-[10px] border-brand/40 text-brand">NPO {sub.npoNumber}</Badge>}
                </div>
              </div>
            )}

            {/* Money */}
            <div className="p-5 py-4 space-y-3">
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><History className="h-3.5 w-3.5 text-brand" /> Money</div>
              <div className="flex flex-wrap gap-3">
                <div className="rounded-lg border bg-card px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Wallet</div>
                  <div className="font-display text-lg">{rands(c.wallet?.balance ?? 0)}</div>
                </div>
                <div className="rounded-lg border bg-card px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" /> Pipeline</div>
                  <div className="font-display text-lg">{detail?.pipeline.total ?? 0} leads</div>
                </div>
                <div className="rounded-lg border bg-card px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1"><Briefcase className="h-3 w-3" /> Workspaces</div>
                  <div className="font-display text-lg">{detail?.projects.length ?? 0}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Top ups (wallet purchases)</div>
                <div className="rounded-lg border divide-y max-h-48 overflow-y-auto hp-scroll">
                  {(detail?.payments.topups.length ?? 0) === 0 && (
                    <div className="px-3 py-2.5 text-xs text-muted-foreground">No top ups yet.</div>
                  )}
                  {detail?.payments.topups.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <Badge variant="outline" className={`text-[9px] ${t.status === 'PAID' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : t.status === 'FAILED' ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'}`}>{t.status}</Badge>
                      <Badge variant="outline" className={`text-[9px] shrink-0 ${t.provider === 'YOCO' ? 'border-brand/40 text-brand' : 'border-white/15 text-muted-foreground'}`}>{t.provider === 'YOCO' ? 'Yoco' : 'Sandbox'}</Badge>
                      <span className="font-medium w-20">{rands(t.amountCents)}</span>
                      <span className="text-muted-foreground flex-1 truncate">{t.reference}{t.providerRef ? ` · ${t.providerRef}` : ''}</span>
                      <span className="text-muted-foreground">{timeAgo(t.paidAt || t.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Credit ledger</div>
                <div className="rounded-lg border divide-y max-h-48 overflow-y-auto hp-scroll">
                  {(detail?.payments.creditTxs.length ?? 0) === 0 && (
                    <div className="px-3 py-2.5 text-xs text-muted-foreground">No credit movements yet.</div>
                  )}
                  {detail?.payments.creditTxs.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <span className={`font-medium w-20 ${t.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{t.amount < 0 ? '' : '+'}{rands(Math.abs(t.amount))}</span>
                      <span className="text-muted-foreground flex-1 truncate">{t.description}</span>
                      <span className="text-muted-foreground">{timeAgo(t.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Workspaces */}
            <div className="p-5 py-4">
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-brand" /> Workspaces</div>
              <div className="rounded-lg border divide-y">
                {(detail?.projects.length ?? 0) === 0 && <div className="px-3 py-2.5 text-xs text-muted-foreground">No workspaces yet.</div>}
                {detail?.projects.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="flex-1 truncate">{p.name}</span>
                    <Badge variant="outline" className="text-[9px]">{p.counts.leads} leads</Badge>
                    <Badge variant="outline" className="text-[9px]">{p.counts.clients} clients</Badge>
                    <Badge variant="outline" className="text-[9px]">{p.counts.invoices} invoices</Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Pipeline shape */}
            <div className="p-5 py-4">
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-brand" /> Pipeline stages</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(STAGE_LABEL).map(([k, label]) => (
                  <Badge key={k} variant="outline" className="text-[10px]">{label} · {detail?.pipeline.stages?.[k] ?? 0}</Badge>
                ))}
              </div>
            </div>

            {/* Lead pool: the campaign bench */}
            {fresh && (
              <PoolCard detail={fresh} busy={poolBusy} onRun={runCampaign} onAction={poolAction} />
            )}

            {/* Invoices */}
            <div className="p-5 py-4">
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><ReceiptText className="h-3.5 w-3.5 text-brand" /> Recent invoices</div>
              <div className="rounded-lg border divide-y max-h-48 overflow-y-auto hp-scroll">
                {(detail?.invoices.length ?? 0) === 0 && <div className="px-3 py-2.5 text-xs text-muted-foreground">No invoices yet.</div>}
                {detail?.invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="font-medium">{inv.number}</span>
                    <span className="text-muted-foreground flex-1 truncate">{inv.clientName}</span>
                    <Badge variant="outline" className="text-[9px]">{inv.status}</Badge>
                    <span className="font-medium">{rands(Math.round(inv.total * 100))}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {c && (
          <AddLeadsDialog
            clientId={c.id}
            clientName={c.name}
            open={addOpen}
            onOpenChange={setAddOpen}
            onDone={() => { setTick((t) => t + 1); onChanged() }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

// =================== Revenue mission (kept) ===================

interface GrowthData {
  mrr: { cents: number; targetCents: number; percent: number }
  members: { total: number; newThisMonth: number; subscribers: number; byPlan: { HUSTLER: number; BOSS: number } }
  subscriptions: { active: number; pastDue: number; canceled: number }
  referrals: { total: number; subscribed: number; viaReferralActive: number }
  topups: { last30DaysCents: number }
  leaderboard: { name: string; businessName: string | null; invites: number; subscribed: number }[]
}

function GrowthSection() {
  const [data, setData] = useState<GrowthData | null>(null)
  useEffect(() => {
    api<GrowthData>('/api/admin/growth').then(setData).catch(() => setData(null))
  }, [])
  if (!data) return null
  const remain = Math.max(0, data.mrr.targetCents - data.mrr.cents)
  return (
    <Card className="border-brand/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-brand" /> Revenue &amp; Growth — R45,000/mo mission
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="font-display text-3xl">{rands(data.mrr.cents)}<span className="text-sm text-muted-foreground font-sans"> MRR</span></div>
            <div className="text-xs text-muted-foreground">{rands(remain)} to go · {data.mrr.percent}%</div>
          </div>
          <div className="h-3 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${data.mrr.percent}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Operator ×{data.members.byPlan.HUSTLER}</span>
            <span>Boss ×{data.members.byPlan.BOSS}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniStat icon={<Users className="h-3.5 w-3.5" />} label="Members" value={String(data.members.total)} sub={`+${data.members.newThisMonth} this month`} />
          <MiniStat icon={<Crown className="h-3.5 w-3.5" />} label="Subscribers" value={String(data.subscriptions.active)} sub={`${data.subscriptions.pastDue} past due · ${data.subscriptions.canceled} canceled`} />
          <MiniStat icon={<Gift className="h-3.5 w-3.5" />} label="Referrals" value={String(data.referrals.total)} sub={`${data.referrals.subscribed} subscribed`} />
          <MiniStat icon={<Repeat2 className="h-3.5 w-3.5" />} label="Top-ups 30d" value={rands(data.topups.last30DaysCents)} sub="one-off credit sales" />
        </div>

        {data.leaderboard.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5 text-brand" /> Top recruiters — the growth engine</div>
            <div className="rounded-lg border divide-y">
              {data.leaderboard.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-5 text-center font-display text-brand">{i + 1}</span>
                  <span className="flex-1 truncate">{r.name}{r.businessName ? ` · ${r.businessName}` : ''}</span>
                  <Badge variant="outline" className="text-[10px]">{r.invites} invited</Badge>
                  <Badge variant="outline" className="text-[10px] border-brand/40 text-brand">{r.subscribed} subscribed</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {data.referrals.viaReferralActive} of {data.subscriptions.active} active subscribers arrived via referral —
          referred members are your stickiest. Keep the invite loop warm.
        </p>
      </CardContent>
    </Card>
  )
}

function MiniStat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{icon}{label}</div>
      <div className="font-display text-lg mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

// =================== Hot leads card (live from Explee) ===================
// The businesshustle campaigns talk to prospects around the clock. When one
// replies with real interest, Explee marks it hot and this card mirrors it
// here, no tab switching. Read why they are hot, then answer from the
// Explee inbox where the full conversation lives.

interface HotLeadRow {
  personId: string
  campaignId: number
  campaignName?: string
  name?: string
  email?: string
  jobTitle?: string
  companyName?: string
  companyDomain?: string
  linkedinUrl?: string
  phone?: string
  whyHot?: string
  becameHotAt?: string
}

interface HotLeadsData {
  total: number
  hasMore: boolean
  campaigns: { id: number; name: string; status: string }[]
  leads: HotLeadRow[]
  engine: 'LIVE' | 'NONE'
  fetchedAt?: string
  note?: string | null
  cached?: boolean
}

function HotLeadsCard() {
  const [data, setData] = useState<HotLeadsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [campaignSel, setCampaignSel] = useState('ALL')

  async function load(sel = campaignSel) {
    setLoading(true)
    try {
      const qs = sel === 'ALL' ? '' : `?campaignId=${sel}`
      setData(await api<HotLeadsData>(`/api/admin/exec/hotleads${qs}`))
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function onCampaignChange(v: string) {
    setCampaignSel(v)
    setShowAll(false)
    load(v)
  }

  const leads = data?.leads ?? []
  const shown = showAll ? leads : leads.slice(0, 6)
  const focused = campaignSel !== 'ALL' ? data?.campaigns.find((c) => String(c.id) === campaignSel) : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <Flame className="h-4 w-4 text-brand" /> Hot leads
            {data?.engine === 'LIVE' && (
              <Badge className="bg-brand text-black hover:bg-brand text-[10px]">
                {data.total} {focused ? `in ${focused.name}` : 'waiting for you'}
              </Badge>
            )}
            {data?.fetchedAt && (
              <span className="text-[10px] text-muted-foreground font-normal">updated {timeAgo(data.fetchedAt)}</span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            {data && data.campaigns.length > 0 && (
              <Select value={campaignSel} onValueChange={onCampaignChange}>
                <SelectTrigger className="h-8 w-36 sm:w-44 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All campaigns</SelectItem>
                  {data.campaigns.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!data && loading && (
          <div className="px-4 py-4 space-y-2">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        )}
        {data && data.engine === 'NONE' && (
          <div className="px-4 py-4 text-sm text-muted-foreground">
            {data.note || 'Explee has no answers right now.'} Campaigns keep working either way: the moment a reply warms up it lands here.
          </div>
        )}
        {data && data.engine === 'LIVE' && leads.length === 0 && (
          <div className="px-4 py-4 text-sm text-muted-foreground">
            No hot leads yet. Your campaigns keep reaching out, and the moment a prospect replies with interest they show up here first.
          </div>
        )}
        {leads.length > 0 && (
          <div className="divide-y">
            {shown.map((l) => (
              <div key={l.personId} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold shrink-0">
                    {(l.name || l.email || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {l.name || l.email || 'Unnamed prospect'}
                      {l.companyName ? <span className="text-muted-foreground font-normal"> · {l.companyName}</span> : ''}
                      {l.jobTitle ? <span className="text-muted-foreground font-normal"> · {l.jobTitle}</span> : ''}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {l.email}{l.phone ? ` · ${l.phone}` : ''}{l.companyDomain ? ` · ${l.companyDomain}` : ''}
                    </div>
                  </div>
                  <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                    {l.campaignName && (
                      <Badge variant="outline" className="text-[9px] border-brand/30 text-brand">{l.campaignName}</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">hot {timeAgo(l.becameHotAt)}</span>
                  </div>
                </div>
                {l.whyHot && (
                  <p className="mt-2 ml-11 text-xs text-muted-foreground border-l-2 border-brand/30 pl-2 line-clamp-2">
                    &ldquo;{l.whyHot}&rdquo;
                  </p>
                )}
              </div>
            ))}
            {!showAll && leads.length > shown.length && (
              <button type="button" onClick={() => setShowAll(true)} className="w-full px-4 py-2.5 text-xs text-brand hover:bg-brand/5 text-left">
                Show all {leads.length} hot leads
              </button>
            )}
            <div className="px-4 py-2.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>Answer from your Explee inbox to keep each conversation warm.</span>
              <a href="https://explee.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline shrink-0">
                Open Explee <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// =================== Payments card (the money, live) ===================
// The owner's at a glance answer to one question: is real card money flowing
// and does every rand land safely? Gateway mode, webhook state, and the latest
// settled payments, straight from the ledger.

// =================== Meetings: the business cases you set ===================
// The owner facilitates a meeting between a member and an outside guest. The
// member confirms with one tap from the invite email; on confirmation both
// parties get the final details and the KPI counts it. The member's account is
// created on the spot when they are not on the platform yet.

const SAST_WHEN = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

function MeetingStatusChip({ status }: { status: string }) {
  if (status === 'CONFIRMED')
    return <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-400">Confirmed</Badge>
  if (status === 'DECLINED')
    return <Badge variant="outline" className="text-[9px] border-zinc-500/40 text-zinc-400">Declined</Badge>
  return <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-400">Awaiting confirmation</Badge>
}

const EMPTY_MEETING_FORM = {
  memberName: '',
  memberEmail: '',
  memberBusiness: '',
  memberPhone: '',
  memberCity: 'Cape Town',
  memberIndustry: '',
  guestName: '',
  guestEmail: '',
  date: '',
  time: '',
  durationMin: '60',
  location: '',
  notes: '',
}

function MeetingsCard({ meetings, onChanged }: { meetings: MeetingRow[] | null; onChanged: () => void }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_MEETING_FORM })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const rows = meetings || []
  const confirmed = rows.filter((m) => m.status === 'CONFIRMED').length
  const awaiting = rows.filter((m) => m.status === 'PROPOSED').length

  // One tap: the meeting page link lands on the clipboard, ready to paste
  // straight into WhatsApp. The toast repeats the URL in case the clipboard
  // is locked down, so the link is always easy to get and send on.
  async function copyShareLink(m: MeetingRow) {
    if (!m.shareToken) return
    const url = `${window.location.origin}/m/${m.shareToken}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'Link copied — paste it on', description: url })
    } catch {
      toast({ title: 'Your meeting link', description: url })
    }
  }

  async function submit() {
    if (!form.memberName.trim() || !form.memberEmail.trim() || !form.guestEmail.trim() || !form.date || !form.time) {
      toast({ title: 'A few details are missing', description: 'Member name, member email, guest email, date and time are required.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      // South Africa stays on UTC+2 all year, so the offset is fixed and safe.
      const startsAt = new Date(`${form.date}T${form.time}:00+02:00`).toISOString()
      const r = await api<{ accountCreated: boolean; inviteSent: boolean; inviteError: string | null; welcomeError: string | null }>(
        '/api/meetings',
        {
          method: 'POST',
          body: JSON.stringify({
            memberName: form.memberName,
            memberEmail: form.memberEmail,
            memberBusiness: form.memberBusiness || undefined,
            memberPhone: form.memberPhone || undefined,
            memberCity: form.memberCity || undefined,
            memberIndustry: form.memberIndustry || undefined,
            guestName: form.guestName || undefined,
            guestEmail: form.guestEmail,
            startsAt,
            durationMin: Number(form.durationMin) || 60,
            location: form.location || undefined,
            notes: form.notes || undefined,
          }),
        },
      )
      if (r.inviteSent) {
        toast({
          title: r.accountCreated ? 'Meeting set, account created' : 'Meeting set',
          description: r.accountCreated
            ? 'The welcome email (with the Google Calendar steps) and the invite with a one tap confirm are on their way to the member.'
            : 'The invite email with a one tap confirm is on its way to the member. It shows here as awaiting until they confirm.',
        })
      } else {
        toast({ title: 'Meeting saved, but the email failed', description: r.inviteError || 'Send it again from Meetings once mail is back.', variant: 'destructive' })
      }
      setOpen(false)
      setForm({ ...EMPTY_MEETING_FORM })
      onChanged()
    } catch (e) {
      toast({ title: 'Could not set the meeting', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const field = 'space-y-1.5'
  const inputCls = 'h-9'

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-brand" /> Meetings
            {rows.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal">
                {confirmed} confirmed · {awaiting} awaiting
              </span>
            )}
          </CardTitle>
          <Button size="sm" className="bg-brand text-black hover:bg-brand h-8 shrink-0" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Set a meeting
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {!meetings && (
            <div className="px-4 py-4 space-y-2">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          )}
          {meetings && rows.length === 0 && (
            <div className="px-4 py-5 text-sm text-muted-foreground">
              No meetings yet. Tap "Set a meeting": if the member is not on the platform yet, their account and welcome email go out in the same step, and the invite carries a one tap confirm.
            </div>
          )}
          {rows.map((m) => (
            <div key={m.id} className="flex items-start gap-3 px-4 py-3">
              <div className="h-9 w-9 rounded-full bg-brand/15 text-brand flex items-center justify-center text-sm font-bold shrink-0">
                {m.memberName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {m.memberName}
                  {m.memberBusiness ? <span className="text-muted-foreground font-normal"> · {m.memberBusiness}</span> : ''}
                  <span className="text-muted-foreground font-normal"> × {m.guestName || m.guestEmail}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">{m.title}</div>
                <div className="text-xs mt-0.5">{SAST_WHEN(m.startsAt)} SAST</div>
                {m.location ? (
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">In person · {m.location}</div>
                ) : (
                  <div className="text-xs text-muted-foreground mt-0.5">Online</div>
                )}
                {!!m.comments && m.comments > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> {m.comments} note{m.comments === 1 ? '' : 's'} from the shared page
                  </div>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <MeetingStatusChip status={m.status} />
                <span className="text-[10px] text-muted-foreground">
                  {m.status === 'CONFIRMED' && m.confirmedAt
                    ? `confirmed ${timeAgo(m.confirmedAt)}`
                    : m.invitedAt
                      ? `invited ${timeAgo(m.invitedAt)}`
                      : ''}
                </span>
                {m.shareToken && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px] gap-1"
                    onClick={() => copyShareLink(m)}
                  >
                    <Link2 className="h-3 w-3" /> Copy link
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set a meeting</DialogTitle>
            <DialogDescription>
              If the member is not on the platform yet, their account is created and a welcome email (password link plus Google Calendar steps) goes out with the invite. They confirm the time with one tap, then both parties get the final details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className={field}>
                <Label>Member name *</Label>
                <Input className={inputCls} value={form.memberName} onChange={set('memberName')} placeholder="Zola" />
              </div>
              <div className={field}>
                <Label>Member email *</Label>
                <Input className={inputCls} type="email" value={form.memberEmail} onChange={set('memberEmail')} placeholder="zola@example.co.za" />
              </div>
              <div className={field}>
                <Label>Member business</Label>
                <Input className={inputCls} value={form.memberBusiness} onChange={set('memberBusiness')} placeholder="Just Hearing" />
              </div>
              <div className={field}>
                <Label>Member phone</Label>
                <Input className={inputCls} value={form.memberPhone} onChange={set('memberPhone')} placeholder="079 995 9658" />
              </div>
              <div className={field}>
                <Label>Member city</Label>
                <Input className={inputCls} value={form.memberCity} onChange={set('memberCity')} />
              </div>
              <div className={field}>
                <Label>Member industry</Label>
                <Input className={inputCls} value={form.memberIndustry} onChange={set('memberIndustry')} placeholder="Audiology" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className={field}>
                <Label>Guest name</Label>
                <Input className={inputCls} value={form.guestName} onChange={set('guestName')} placeholder="Ian" />
              </div>
              <div className={field}>
                <Label>Guest email *</Label>
                <Input className={inputCls} type="email" value={form.guestEmail} onChange={set('guestEmail')} placeholder="guest@gmail.com" />
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className={field}>
                <Label>Date *</Label>
                <Input className={inputCls} type="date" value={form.date} onChange={set('date')} />
              </div>
              <div className={field}>
                <Label>Time (SAST) *</Label>
                <Input className={inputCls} type="time" value={form.time} onChange={set('time')} />
              </div>
              <div className={field}>
                <Label>Duration</Label>
                <Select value={form.durationMin} onValueChange={(v) => setForm((f) => ({ ...f, durationMin: v }))}>
                  <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="45">45 minutes</SelectItem>
                    <SelectItem value="60">60 minutes</SelectItem>
                    <SelectItem value="90">90 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className={field}>
              <Label>Location (optional)</Label>
              <Input className={inputCls} value={form.location} onChange={set('location')} placeholder="Medispa, 99 Kloof Street. Leave empty for an online meeting." />
            </div>
            <div className={field}>
              <Label>Notes for both parties (optional)</Label>
              <Textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="What the meeting is about." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button className="bg-brand text-black hover:bg-brand" onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CalendarClock className="h-4 w-4 mr-1" />}
              Set the meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function PaymentsCard({ payments, onChanged }: { payments: NonNullable<ExecData['payments']> | null; onChanged: () => void }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  if (!payments) return null

  async function registerWebhook() {
    setBusy(true)
    try {
      await api('/api/webhooks/yoco/register', { method: 'POST', body: JSON.stringify({}) })
      toast({ title: 'Webhook registered', description: 'Yoco now tells HustlePortal the moment a payment lands, and wallets credit themselves.' })
      onChanged()
    } catch (e) {
      toast({ title: 'Could not register the webhook', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const modeBadge = payments.keyMode === 'live' ? (
    <Badge className="bg-brand text-black hover:bg-brand text-[10px]">Yoco live</Badge>
  ) : payments.keyMode === 'test' ? (
    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">Yoco test</Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">Not connected</Badge>
  )

  const modeNote = payments.keyMode === 'live'
    ? 'Card payments run on your live Yoco account. Clients pay real rands and wallets credit the moment Yoco confirms.'
    : payments.keyMode === 'test'
      ? 'Checkout runs on test keys right now. Swap in your live key on Vercel to take real money.'
      : 'Add your Yoco secret key on Vercel, then redeploy, to take card payments.'

  // The webhook only confirms payments for the key world it was registered in.
  // A secret saved in the wrong key shape, or a webhook left in test mode,
  // would swallow real payments silently, so the dashboard says so plainly.
  const webhookReady = payments.webhookConfigured && payments.keyMode !== null && payments.webhookMode === payments.keyMode
  const webhookStale = payments.webhookConfigured && payments.keyMode !== null && payments.webhookMode !== payments.keyMode

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-brand" /> Payments
          {modeBadge}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{modeNote}</p>

        {payments.keyMode && (
          webhookReady ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-emerald-400">Webhook registered for {payments.keyMode} mode</div>
                <div className="text-muted-foreground">Every payment confirms itself: wallets credit and plans activate the moment Yoco says paid.</div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium text-amber-400">
                  {webhookStale
                    ? `The webhook was registered for ${payments.webhookMode || 'another'} mode`
                    : 'Register the webhook to finish the setup'}
                </div>
                <div className="text-muted-foreground">One tap points Yoco at this deployment, so {payments.keyMode} payments credit wallets automatically instead of waiting unclaimed.</div>
              </div>
              <Button size="sm" className="h-7 bg-brand text-black hover:bg-brand/90 shrink-0" disabled={busy} onClick={registerWebhook}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3 w-3 mr-1" />} Register
              </Button>
            </div>
          )
        )}

        <div>
          <div className="text-xs text-muted-foreground mb-1.5">Latest payments</div>
          <div className="rounded-lg border divide-y max-h-56 overflow-y-auto hp-scroll">
            {payments.recent.length === 0 && (
              <div className="px-3 py-2.5 text-xs text-muted-foreground">No card payments yet. The moment a client loads credit, it lands here.</div>
            )}
            {payments.recent.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <Badge variant="outline" className={`text-[9px] shrink-0 ${t.provider === 'YOCO' ? 'border-brand/40 text-brand' : 'border-white/15 text-muted-foreground'}`}>
                  {t.provider === 'YOCO' ? 'Yoco' : 'Sandbox'}
                </Badge>
                <span className="font-medium w-20">{rands(t.amountCents)}</span>
                <span className="flex-1 truncate">
                  {t.clientName}{t.clientBusiness ? <span className="text-muted-foreground"> · {t.clientBusiness}</span> : ''}
                  <span className="text-muted-foreground"> · {t.reference}</span>
                </span>
                <span className="text-muted-foreground shrink-0">{timeAgo(t.paidAt || t.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// =================== Verified pool card (the owner's hand pick) ===================
// The shared verified pool: real companies the outreach reached and the
// scans confirmed. Pick a member, pick contacts, one tap lands them in that
// member's pipeline, stage New, at no cost to them. Labels follow the
// outreach projects so the owner always knows which door a face came from.

interface PoolBrowseRow {
  id: string
  company: string
  contactName?: string
  role?: string
  email?: string
  phone?: string
  website?: string
  city?: string
  industry?: string
  poolTag?: string
  why?: string
  verifyScore: number
  confirmCount: number
  served: number
  seenAt?: string
}

function VerifiedPoolCard({ roster }: { roster: RosterRow[] }) {
  const { toast } = useToast()
  const [memberId, setMemberId] = useState('')
  const [rows, setRows] = useState<PoolBrowseRow[] | null>(null)
  const [facets, setFacets] = useState<{ tag: string; count: number }[]>([])
  const [total, setTotal] = useState(0)
  const [tag, setTag] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [feeding, setFeeding] = useState(false)

  async function browse(nextTag: string = tag, nextQ: string = q) {
    setBusy(true)
    try {
      const params = new URLSearchParams()
      if (nextTag) params.set('tag', nextTag)
      if (nextQ.trim()) params.set('q', nextQ.trim())
      const d = await api<{ total: number; facets: { tag: string; count: number }[]; rows: PoolBrowseRow[] }>(
        `/api/admin/exec/pool/assign?${params.toString()}`
      )
      setRows(d.rows)
      setFacets(d.facets)
      setTotal(d.total)
      setPicked(new Set())
    } catch (e) {
      toast({ title: 'Could not load the pool', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    browse('', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function feedNow() {
    setFeeding(true)
    try {
      const d = await api<{ message?: string }>('/api/admin/exec/pool/explee-ingest', {
        method: 'POST',
        body: JSON.stringify({ maxPings: 12 }),
      })
      toast({ title: 'Pool fed', description: d.message })
      await browse()
    } catch (e) {
      toast({ title: 'The feed did not land', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setFeeding(false)
    }
  }

  async function handOver() {
    if (!memberId || picked.size === 0) return
    setBusy(true)
    try {
      const d = await api<{ message?: string }>('/api/admin/exec/pool/assign', {
        method: 'POST',
        body: JSON.stringify({ userId: memberId, poolIds: [...picked] }),
      })
      toast({ title: 'Handed over', description: d.message })
      await browse()
    } catch (e) {
      toast({ title: 'Could not hand over', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const member = roster.find((r) => r.id === memberId)
  const members = roster.filter((r) => !r.isQa)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <HandCoins className="h-4 w-4 text-brand" /> Verified pool
          {total > 0 && <Badge className="bg-brand text-black hover:bg-brand text-[10px]">{total} contacts</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Real contacts our outreach reached and the scans confirmed. Pick a member, pick contacts, and they land in that
          pipeline, stage New, free for them. Each one carries its own verification so the member can check it and pitch.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={memberId} onValueChange={setMemberId}>
            <SelectTrigger className="sm:w-[260px] h-9"><SelectValue placeholder="Pick a member" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}{m.businessName ? ` · ${m.businessName}` : ''} · {m.counts.leads} leads
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') browse(tag, q) }}
              placeholder="Search company, city, industry or contact"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <Button size="sm" variant="outline" className="h-9 shrink-0" disabled={busy} onClick={() => browse(tag, q)}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1" />} Search
          </Button>
          <Button size="sm" variant="outline" className="h-9 shrink-0 border-brand/40 text-brand hover:bg-brand/10" disabled={feeding} onClick={feedNow}>
            {feeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />} Pull new contacts
          </Button>
        </div>

        {facets.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => { setTag(''); browse('', q) }}
              className={`text-[10px] px-2 py-1 rounded-full border ${tag === '' ? 'border-brand/60 text-brand bg-brand/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              All
            </button>
            {facets.map((f) => (
              <button
                key={f.tag || 'untagged'}
                type="button"
                onClick={() => { setTag(f.tag || 'untagged'); browse(f.tag || 'untagged', q) }}
                className={`text-[10px] px-2 py-1 rounded-full border ${tag === f.tag ? 'border-brand/60 text-brand bg-brand/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {f.tag || 'Untagged'} · {f.count}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-lg border divide-y max-h-80 overflow-y-auto hp-scroll">
          {(rows ?? []).length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground">
              Nothing here yet. Tap Pull new contacts to bring in the newest verified faces, or clear the search.
            </div>
          )}
          {(rows ?? []).map((r) => (
            <label key={r.id} className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-muted/40">
              <Checkbox
                checked={picked.has(r.id)}
                onCheckedChange={(c) => {
                  setPicked((prev) => {
                    const next = new Set(prev)
                    if (c) next.add(r.id)
                    else next.delete(r.id)
                    return next
                  })
                }}
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {r.company}
                  {r.contactName ? <span className="text-muted-foreground font-normal"> · ask for {r.contactName}{r.role ? ` (${r.role})` : ''}</span> : ''}
                </div>
                <div className="text-muted-foreground truncate">
                  {[r.city, r.industry, r.phone, r.email].filter(Boolean).join(' · ') || 'no contact facts yet'}
                </div>
                {r.why && <div className="text-[10px] text-muted-foreground/80 truncate italic">&ldquo;{r.why}&rdquo;</div>}
              </div>
              <Badge variant="outline" className="text-[9px] shrink-0 border-emerald-500/40 text-emerald-400">
                {r.verifyScore >= 80 ? 'Website live' : r.confirmCount >= 2 ? 'Confirmed' : 'Verified'}
              </Badge>
              {r.poolTag && (
                <Badge variant="outline" className="text-[9px] shrink-0 border-brand/40 text-brand">{r.poolTag}</Badge>
              )}
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            {picked.size > 0 ? `${picked.size} picked` : 'Nothing picked yet'}
            {member ? ` · for ${member.name}` : ' · pick a member first'}
          </span>
          <Button
            size="sm"
            className="h-8 bg-brand text-black hover:bg-brand/90"
            disabled={busy || !memberId || picked.size === 0}
            onClick={handOver}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            Add {picked.size || ''} {picked.size === 1 ? 'contact' : 'contacts'} to {member ? `${member.name.split(' ')[0]}'s` : 'their'} pipeline
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// =================== Executive Dashboard (main) ===================

interface AdminData {
  config: {
    expleeKeySet: boolean
    expleeKeyMasked: string
    leadPrice: number
    packs: { id: string; name: string; amountCents: number; creditCents: number; bonus: number }[]
  }
  stats: { userCount: number; leadCount: number; topupTotal: number }
  users: { id: string; name: string; email: string; businessName: string | null; role: string; xp: number; createdAt: string; wallet: { balance: number } | null }[]
}

function KpiCard({ icon, label, value, sub, hot }: { icon: React.ReactNode; label: string; value: string; sub?: string; hot?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card p-4 ${hot ? 'border-brand/50' : ''}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{icon}{label}</div>
      <div className={`font-display text-2xl mt-1 ${hot ? 'text-brand' : ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}

export default function AdminView() {
  const { toast } = useToast()
  const [exec, setExec] = useState<ExecData | null>(null)
  const [data, setData] = useState<AdminData | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('ALL')
  const [openId, setOpenId] = useState<string | null>(null)
  const [pauseTarget, setPauseTarget] = useState<RosterRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // Automated QA probe accounts stay out of sight by default: the owner's lens
  // is the real business. One tap brings them back for auditing.
  const [showQa, setShowQa] = useState(false)

  // lead economy config (kept from the classic admin panel)
  const [apiKey, setApiKey] = useState('')
  const [leadPrice, setLeadPrice] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api<ExecData>('/api/admin/exec').then(setExec).catch(() => setExec(null))
  }, [tick])

  // Email deep link: the credit notification points straight at the client's desk.
  useEffect(() => {
    const cid = new URLSearchParams(window.location.search).get('client')
    if (cid) setOpenId(cid)
  }, [])

  async function loadConfig() {
    try {
      const d = await api<AdminData>('/api/admin/config')
      setData(d)
      setLeadPrice(String(d.config.leadPrice / 100))
    } catch (e) {
      toast({ title: 'Admin load failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  async function save() {
    setSaving(true)
    try {
      await api('/api/admin/config', {
        method: 'POST',
        body: JSON.stringify({
          ...(apiKey.trim() ? { expleeApiKey: apiKey.trim() } : {}),
          leadPrice: Math.round(parseFloat(leadPrice) * 100) || 1500,
        }),
      })
      toast({ title: 'Settings saved' })
      setApiKey('')
      await loadConfig()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function restore(row: RosterRow) {
    setBusyId(row.id)
    try {
      await api(`/api/admin/exec/client/${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) })
      toast({ title: `${row.name} is back on`, description: 'They can sign in again right now. Nothing was lost.' })
      setTick((t) => t + 1)
    } catch (e) {
      toast({ title: 'Could not restore', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const roster = exec?.roster ?? []
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return roster.filter((u) => {
      if (!showQa && u.isQa) return false
      if (filter === 'PAUSED' && u.accountStatus !== 'SUSPENDED') return false
      if (filter === 'PAYING' && u.subStatus !== 'ACTIVE') return false
      if (filter === 'NOPLAN' && u.plan) return false
      if (!needle) return true
      return [u.name, u.email, u.businessName, u.city, u.industry]
        .some((f) => (f || '').toLowerCase().includes(needle))
    })
  }, [roster, q, filter, showQa])

  const k = exec?.kpis
  const spotlight = roster.filter((u) => !u.isQa).slice(0, 8)

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Executive Dashboard</h1>
          <p className="text-sm text-muted-foreground">Every client, their money, their pipeline. You are in control.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setTick((t) => t + 1)} className="shrink-0">
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* KPIs */}
      {!k ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <KpiCard hot icon={<UserPlus className="h-3 w-3" />} label="New signups 7d" value={String(k.new7)} sub={`+${k.new30} in 30 days`} />
          <KpiCard icon={<Users className="h-3 w-3" />} label="Clients" value={String(k.realMembers)} sub={`${k.suspended > 0 ? `${k.suspended} paused` : 'all active'}${k.qaAccounts > 0 ? ` · ${k.qaAccounts} QA` : ''}`} />
          <KpiCard icon={<Crown className="h-3 w-3" />} label="MRR" value={rands(k.mrrCents)} sub={`${k.subscribers} paying · ${k.subsPastDue} past due${k.testMrrCents > 0 ? ` · ${rands(k.testMrrCents)} in test plans` : ''}`} />
          <KpiCard icon={<Coins className="h-3 w-3" />} label="Top ups 30d" value={rands(k.topups30dCents)} sub={`live card money${k.sandboxTopups30dCents > 0 ? ` · ${rands(k.sandboxTopups30dCents)} in tests` : ''}`} />
          <KpiCard icon={<Wallet className="h-3 w-3" />} label="Wallet float" value={rands(k.walletFloatCents)} sub="client credit on hand" />
          <KpiCard icon={<Target className="h-3 w-3" />} label="Leads" value={String(k.leadsPlatform)} sub={`across all pipelines · ${k.poolNew} in pools${k.poolArrivals24h > 0 ? ` · +${k.poolArrivals24h} today` : ''}`} />
          <KpiCard icon={<CalendarClock className="h-3 w-3" />} label="Meetings set" value={String(k.meetingsSet ?? 0)} sub={`${k.meetingsConfirmed ?? 0} confirmed · ${k.meetingsAwaiting ?? 0} awaiting`} />
        </div>
      )}

      {/* Meetings: the business cases you set, with the one tap confirm state */}
      <MeetingsCard meetings={exec?.meetings ?? null} onChanged={() => setTick((t) => t + 1)} />

      {/* Payments: gateway mode, webhook state, latest settled money */}
      <PaymentsCard payments={exec?.payments ?? null} onChanged={() => setTick((t) => t + 1)} />

      {/* Hot leads: live replies from the Explee campaigns */}
      <HotLeadsCard />

      {/* Verified pool: the owner's hand pick, straight into any member's pipeline */}
      <VerifiedPoolCard roster={roster} />

      {/* Newest members spotlight */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-brand" /> Newest members
            {k && k.new7 > 0 && <Badge className="bg-brand text-black hover:bg-brand text-[10px]">{k.new7} this week</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {spotlight.length === 0 && (
              <div className="px-4 py-4 text-sm text-muted-foreground">No signups yet. Share your referral code to change that.</div>
            )}
            {spotlight.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="h-9 w-9 rounded-full bg-brand/15 text-brand flex items-center justify-center text-sm font-bold shrink-0">
                  {u.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {u.name}{u.businessName ? <span className="text-muted-foreground font-normal"> · {u.businessName}</span> : ''}
                    {u.isAdmin && <Badge className="bg-sidebar text-white hover:bg-sidebar text-[9px] ml-1.5">exec</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}{u.city ? ` · ${u.city}` : ''}</div>
                </div>
                <div className="hidden md:flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1">{rands(u.walletCents)} · {u.counts.leads} leads</span>
                  <PlanChip plan={u.plan} cycle={u.subCycle} />
                  <SubChip status={u.subStatus} />
                  <AcctChip status={u.accountStatus} />
                </div>
                <span className="text-xs text-muted-foreground w-16 text-right shrink-0">{timeAgo(u.joinedAt)}</span>
                <Button variant="outline" size="sm" onClick={() => setOpenId(u.id)} className="shrink-0">Open</Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Client roster */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-brand" /> All clients
              <span className="text-xs text-muted-foreground font-normal">{filtered.length} of {roster.length}</span>
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, business, city" className="pl-8 h-9 sm:w-56" />
              </div>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="h-9 sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Everyone</SelectItem>
                  <SelectItem value="PAYING">Paying subscribers</SelectItem>
                  <SelectItem value="NOPLAN">No plan yet</SelectItem>
                  <SelectItem value="PAUSED">Paused accounts</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className={showQa ? 'h-9 border-brand/40 text-brand' : 'h-9 text-muted-foreground'}
                onClick={() => setShowQa((v) => !v)}
              >
                {showQa ? 'QA shown' : 'Show QA'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y max-h-[60vh] overflow-y-auto hp-scroll">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">No clients match. Clear the search or pick another filter.</div>
            )}
            {filtered.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="h-9 w-9 rounded-full bg-brand/15 text-brand flex items-center justify-center text-sm font-bold shrink-0">
                  {u.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-[2] basis-40">
                  <div className="text-sm font-medium truncate">
                    {u.name}{u.businessName ? <span className="text-muted-foreground font-normal"> · {u.businessName}</span> : ''}
                    {u.isAdmin && <Badge className="bg-sidebar text-white hover:bg-sidebar text-[9px] ml-1.5">exec</Badge>}
                    {u.isQa && <Badge variant="outline" className="text-[9px] ml-1.5 border-muted-foreground/30 text-muted-foreground">QA</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 basis-48">
                  <PlanChip plan={u.plan} cycle={u.subCycle} />
                  <SubChip status={u.subStatus} />
                  <AcctChip status={u.accountStatus} />
                </div>
                <div className="text-xs text-muted-foreground basis-36">
                  <span className="font-medium text-foreground">{rands(u.walletCents)}</span> wallet · {u.counts.leads} leads
                  {u.poolCount > 0 && <span className="text-brand font-medium"> · {u.poolCount} pooled</span>}
                  <div>joined {timeAgo(u.joinedAt)} · last seen {timeAgo(u.lastActiveAt)}</div>
                </div>
                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  {u.accountStatus === 'SUSPENDED' ? (
                    <Button variant="outline" size="sm" className="h-8 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" disabled={busyId === u.id} onClick={() => restore(u)}>
                      {busyId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />} Restore
                    </Button>
                  ) : (
                    !u.isAdmin && (
                      <Button variant="outline" size="sm" className="h-8" onClick={() => setPauseTarget(u)}>
                        <Pause className="h-3.5 w-3.5" />
                      </Button>
                    )
                  )}
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setOpenId(u.id)}>Open</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <ClientSheet
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => setTick((t) => t + 1)}
        onPauseRequest={(row) => setPauseTarget(row)}
      />
      <PauseDialog
        target={pauseTarget}
        onOpenChange={(o) => { if (!o) setPauseTarget(null) }}
        onDone={() => { setPauseTarget(null); setTick((t) => t + 1) }}
      />

      <GrowthSection />

      {/* Stats */}
      {data && (
        <div className="grid sm:grid-cols-3 gap-3">
          <StatCard icon={<Users className="h-4 w-4" />} label="Users" value={String(data.stats.userCount)} />
          <StatCard icon={<Target className="h-4 w-4" />} label="Leads in platform" value={String(data.stats.leadCount)} />
          <StatCard icon={<Coins className="h-4 w-4" />} label="Top ups processed" value={rands(data.stats.topupTotal)} />
        </div>
      )}

      {/* Config */}
      {data && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Lead economy &amp; integrations</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Explee API key</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={data.config.expleeKeySet ? data.config.expleeKeyMasked : 'Paste key from explee.com → API Keys'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {data.config.expleeKeySet
                  ? 'Key configured — lead discovery and client campaigns search live Explee data.'
                  : 'No key yet — client campaigns serve fresh faces from your own verified pool instead. Get yours at explee.com (API Keys in account settings).'}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Lead reveal price (R)</Label>
                <Input type="number" value={leadPrice} onChange={(e) => setLeadPrice(e.target.value)} />
                <p className="text-xs text-muted-foreground">What clients pay in credits to unlock contact details. Your margin over Explee cost lives here.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Discovery engine</Label>
                <div className="rounded-lg border bg-card px-3 py-2 text-sm flex items-center gap-2 min-h-9">
                  {data.config.expleeKeySet ? (
                    <>
                      <Badge className="bg-brand text-black hover:bg-brand text-[10px]">Live</Badge>
                      <span className="text-xs text-muted-foreground">Explee finds fresh faces for every campaign.</span>
                    </>
                  ) : (
                    <>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Fallback</Badge>
                      <span className="text-xs text-muted-foreground">Campaigns serve verified pool faces until an Explee key is saved.</span>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">The engine picks itself from your keys. Payments and lead search both run live.</p>
              </div>
            </div>

            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save settings
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded-lg bg-brand/15 p-2 text-brand">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="font-display text-2xl">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}
