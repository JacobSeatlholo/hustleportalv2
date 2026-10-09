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
}

export interface Lead {
  id: string
  company: string
  contactName: string | null
  email: string | null
  phone: string | null
  website: string | null
  industry: string | null
  city: string | null
  country: string | null
  source: string
  stage: string
  value: number
  notes: string | null
  unlocked: boolean
  score: number | null
  createdAt: string
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
  creatorId: string
  assigneeId: string | null
  creator: { id: string; name: string }
  assignee?: { id: string; name: string } | null
  team?: { id: string; name: string } | null
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
  { key: 'NEW', label: 'New', color: 'bg-amber-400' },
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
    const err = new Error((data as { error?: string }).error || `Request failed (${res.status})`)
    ;(err as Error & { status?: number; data?: unknown }).status = res.status
    ;(err as Error & { status?: number; data?: unknown }).data = data
    throw err
  }
  return data as T
}
