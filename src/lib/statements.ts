import { db } from '@/lib/db'
import { isExecUser } from '@/lib/admin'

// The statements book: Simple Eternity Holdings billing its own clients
// (Kloof Street Online memberships, web work, the boss's manual Canva
// workflow made structural). Deliberately narrow door:
//
//   the master account, exec seats, and members of a team OWNED by the
//   master account. Everybody else never sees this exists.
//
// The book itself belongs to the master account (ownerId), so every gate
// check reduces to "may this person touch the master's statement book".

export const SEH_OWNER_EMAIL = 'ceo@businesshustle.co.za'

export interface StatementGateUser {
  id: string
  email: string
  role: string
  platformAdmin: boolean
}

export async function sehOwnerId(): Promise<string | null> {
  const master = await db.user.findUnique({ where: { email: SEH_OWNER_EMAIL }, select: { id: true } })
  return master?.id ?? null
}

export async function hasStatementAccess(me: StatementGateUser): Promise<boolean> {
  if (isExecUser(me)) return true
  const owner = await sehOwnerId()
  if (!owner) return false
  // The master may own several teams over time; membership in ANY of them
  // counts. findFirst on one arbitrary team would silently lock out members
  // of the others.
  const teams = await db.team.findMany({ where: { ownerId: owner }, select: { id: true } })
  if (teams.length === 0) return false
  const member = await db.teamMember.findFirst({
    where: { userId: me.id, teamId: { in: teams.map((t) => t.id) } },
    select: { id: true },
  })
  return !!member
}

// Signed ledger math. Entries carry signed amounts (+ charge, - payment);
// balanceBfwd carries the opening balance from before this digital book.
export interface EntryLike {
  date: Date
  amount: number
  kind: string
}

export function openingBalance(balanceBfwd: number, entries: EntryLike[], monthStart: Date): number {
  return entries.reduce((acc, e) => (e.date < monthStart ? acc + e.amount : acc), balanceBfwd)
}

export function fmtZAR(n: number): string {
  const abs = Math.abs(n)
  const s = abs.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `R ${s}`
}

// The template prints totals like "R 1850.00" and running balances like
// "1,850.00" (comma thousands, dot decimals) — en-ZA gives exactly that.
export function fmtPlain(n: number): string {
  return Math.abs(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtStamp(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return monthKey
  return `${MONTHS[m - 1]} ${y}`
}
