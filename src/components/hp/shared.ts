export interface SessionUser {
  id: string
  email: string
  name: string
  businessName: string | null
  industry: string | null
  city: string | null
  phone: string | null
  role: string
  xp: number
}

export interface LevelInfo {
  level: number
  name: string
  icon: string
  min: number
  progress: number
  next: { level: number; name: string; min: number } | null
}

export interface Challenge {
  key: string
  label: string
  xp: number
  target: number
  count: number
  done: boolean
}

export interface SessionData {
  user: SessionUser
  wallet: { balance: number }
  level: LevelInfo
  challenges: Challenge[]
  team: { id: string; name: string; role: string } | null
  projects: HpProjectRef[]
}

export interface HpProjectRef {
  id: string
  name: string
  isDefault: boolean
  counts: { id: string; leads: number; clients: number; invoices: number }
}

export interface ProjectFull {
  id: string
  name: string
  industry: string | null
  valueProp: string | null
  targetMarket: string | null
  offerings: string | null
  tone: string | null
  website: string | null
  contactEmail: string | null
  contactPhone: string | null
  salesPitch: string | null
  isDefault: boolean
}

export interface Appointment {
  id: string
  title: string
  clientName: string | null
  notes: string | null
  startsAt: string
  endsAt: string | null
  meetLink: string | null
  source: string
  gcalEventId: string | null
  createdAt: string
}

export interface InvoiceItem {
  description: string
  quantity: number
  unitPrice: number
}

export interface Invoice {
  id: string
  number: string
  clientName: string
  clientEmail: string | null
  status: string
  items: InvoiceItem[] | string
  currency: string
  subtotal: number
  taxRate: number
  total: number
  logoUrl: string | null
  bankDetails: string | null
  notes: string | null
  issuedAt: string
  dueAt: string | null
  paidAt: string | null
  createdAt: string
}

export interface EmailLogRow {
  id: string
  toEmail: string
  subject: string
  body: string
  status: string
  error: string | null
  createdAt: string
}

export interface IntegrationSetting {
  key: string
  value: string
  configured: boolean
  updatedAt?: string
}

export interface Lead {
  id: string
  company: string
  contactName: string | null
  role: string | null
  profileUrl: string | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  industry: string | null
  city: string | null
  country: string | null
  source: string
  stage: string
  value: number
  notes: string | null
  unlocked: boolean
  score: number | null
  projectId: string | null
  createdAt: string
}

// One email tied to a contact, as shown on the detail dialog.
export interface LeadEmailLog {
  id: string
  subject: string
  campaign: string | null
  status: string // DRAFT | SENT | FAILED
  openedAt: string | null
  openCount: number
  createdAt: string
}

// Campaign read-out (exec): one row per send, grouped by campaign client side.
export interface CampaignRow {
  id: string
  campaign: string | null
  toEmail: string
  subject: string
  status: string // QUEUED | SENT | FAILED | BOUNCED | SKIPPED | DRAFT
  error: string | null
  openedAt: string | null
  openCount: number
  sentAt: string | null
  createdAt: string
  lead: { id: string; company: string; stage: string } | null
}

export interface CampaignSummary {
  queued: number
  sent: number
  failed: number
  bounced: number
  skipped: number
  opened: number
  total: number
}

export interface CampaignState {
  status: 'PAUSED' | 'ACTIVE' | 'DONE' | 'CANCELLED'
  perHour: number
  from?: string
  provider?: 'RESEND' | 'SES' // the transport lane — free lane by default, SES when its keys are in
  createdAt: string
  startedAt?: string
  completedAt?: string
}

export interface CampaignInfo {
  tag: string
  state: CampaignState | null
  summary: CampaignSummary
}

export interface Task {
  id: string
  title: string
  notes: string | null
  status: string
  priority: string
  dueDate: string | null
  isPrivate: boolean
  teamId: string | null
  leadId?: string | null
  creatorId: string
  assigneeId: string | null
  creator: { id: string; name: string }
  assignee?: { id: string; name: string } | null
  team?: { id: string; name: string } | null
  _count?: { comments: number } // Prisma _count include on the list payload
  _openedAt?: string | null // first time the assigned person opened the record
}

export interface TaskEventRow {
  id: string
  seq: number
  type: string // CREATED | SENT | OPENED | STATUS | COMMENT | EDIT
  actorName: string
  detail: string
  createdAt: string
  hash: string
}

export interface TaskCommentRow {
  id: string
  taskId: string
  userId: string
  body: string
  createdAt: string
  user: { id: string; name: string }
}

export interface CreditTx {
  id: string
  type: string
  amount: number
  description: string
  balanceAfter: number
  createdAt: string
}

export interface TopUpPack {
  id: string
  name: string
  amountCents: number
  creditCents: number
  bonus: number
}

export const STAGES = [
  { key: 'NEW', label: 'New', color: 'bg-brand' },
  { key: 'CONTACTED', label: 'Contacted', color: 'bg-yellow-500' },
  { key: 'QUALIFIED', label: 'Qualified', color: 'bg-orange-500' },
  { key: 'QUOTE_SENT', label: 'Quote Sent', color: 'bg-stone-600' },
  { key: 'WON', label: 'Won', color: 'bg-emerald-600' },
  { key: 'LOST', label: 'Lost', color: 'bg-stone-400' },
] as const

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const

export function rands(cents: number) {
  const r = cents / 100
  return `R${r.toLocaleString('en-ZA', { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}

export function randsPlain(v: number) {
  return `R${v.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export async function api<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // The upgrade contract: a 402 with { upgrade: true } opens the ONE upgrade
    // dialog (mounted once in AppShell) and still throws a friendly Error so
    // the caller's catch block shows the same reason as a toast. No screen
    // needs special code to sell Operator.
    const d = data as { error?: string; upgrade?: boolean; feature?: string; limit?: number }
    if (res.status === 402 && d.upgrade && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('hp:upgrade', {
          detail: { feature: d.feature, limit: d.limit, message: d.error },
        }),
      )
      const err = new Error(d.error || 'This one lives on Operator.')
      const e = err as Error & { status?: number; upgrade?: boolean; feature?: string }
      e.status = 402
      e.upgrade = true
      e.feature = d.feature
      throw e
    }
    const err = new Error(d.error || `Request failed (${res.status})`)
    ;(err as Error & { status?: number; data?: unknown }).status = res.status
    ;(err as Error & { status?: number; data?: unknown }).data = data
    throw err
  }
  return data as T
}
