import { db } from '@/lib/db'
import { sehOwnerId } from '@/lib/statements'

// Statement sync — the bridge that makes the statement book FOLLOW the records.
//
// The boss's law (his words, his choices):
//   "Auto + manual lock" — new invoices/payments land on the statement
//   automatically, but lines already on the book are only ever touched by him.
//
// How it stays honest:
//   * Only the MASTER's own invoices sync (exec seats act inside their own
//     books; nobody's paperwork writes into the boss's client statements by
//     accident).
//   * Only accounts with autoSync switched ON are match targets. Kim Tucker
//     has TWO accounts (main + Kloof Street membership) — the toggle is what
//     tells the sync which one receives the invoices.
//   * A matched account must be UNIQUE. Two autoSync accounts matching the
//     same client name = skip with a note, never guess with money.
//   * Synced lines carry sourceRef = "invoice:<id>" / "invoice:<id>:pay".
//     Re-syncing UPSERTS by that ref: an edited invoice updates its line, it
//     never duplicates. Manual lines (sourceRef null) are never touched.
//   * The moment the boss edits a synced line by hand, the route clears its
//     sourceRef — his correction wins and the line stops following the record.
//   * Invoices that predate the sync (created before 2026-11-05) are NEVER
//     auto-booked: their figures may already sit on the book by hand, and a
//     doubled charge on a client statement is a lie we refuse to print.

interface InvoiceLike {
  id: string
  userId: string
  kind: string
  status: string
  clientName: string
  number: string
  total: number
  items: string
  issuedAt: Date
  paidAt: Date | null
  createdAt: Date
}

const SYNC_FROM = new Date('2026-11-05T00:00:00.000Z')
const BOOKABLE = ['SENT', 'OVERDUE', 'PAID']

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function firstItemDescription(items: string): string | null {
  try {
    const parsed = JSON.parse(items || '[]')
    if (!Array.isArray(parsed)) return null
    const first = parsed.find((i) => i && String(i.description || '').trim())
    return first ? String(first.description).trim().slice(0, 60) : null
  } catch {
    return null
  }
}

async function matchAccount(ownerId: string, clientName: string) {
  const candidates = await db.statementAccount.findMany({
    where: { ownerId, autoSync: true },
    select: { id: true, refNo: true, clientName: true },
  })
  const target = norm(clientName)
  if (!target) return { kind: 'NONE' as const }
  const hits = candidates.filter((a) => {
    const n = norm(a.clientName)
    return n === target || n.includes(target) || target.includes(n)
  })
  if (hits.length === 1) return { kind: 'ONE' as const, account: hits[0] }
  if (hits.length > 1) return { kind: 'AMBIGUOUS' as const }
  return { kind: 'NONE' as const }
}

async function upsertLine(
  accountId: string,
  sourceRef: string,
  data: { date: Date; product: string | null; remarks: string; quantity: string | null; amount: number; kind: string },
) {
  await db.statementEntry.upsert({
    where: { accountId_sourceRef: { accountId, sourceRef } },
    create: { accountId, sourceRef, ...data },
    update: {
      date: data.date,
      product: data.product,
      remarks: data.remarks,
      quantity: data.quantity,
      amount: data.amount,
      kind: data.kind,
    },
  })
}

/**
 * Sync one invoice into the statement book. Never throws — a statement hiccup
 * must never fail the invoice action. Returns a human note for the toast, or
 * null for silence (most invoices simply don't belong on a statement).
 */
export async function syncInvoiceToStatement(invoice: InvoiceLike): Promise<string | null> {
  try {
    if (invoice.kind !== 'INVOICE') return null
    const owner = await sehOwnerId()
    if (!owner || invoice.userId !== owner) return null
    if (!BOOKABLE.includes(invoice.status)) return null

    if (invoice.createdAt < SYNC_FROM) {
      return `Invoice ${invoice.number} predates statement sync — add it to the statement by hand if it belongs there.`
    }

    const m = await matchAccount(owner, invoice.clientName)
    if (m.kind === 'AMBIGUOUS') {
      return `Statement sync skipped: more than one auto-sync account matches "${invoice.clientName}". Open the one you want and switch the other off.`
    }
    if (m.kind === 'NONE') return null
    const accountId = m.account.id
    const refNo = m.account.refNo
    const refs = [`invoice:${invoice.id}`, `invoice:${invoice.id}:pay`]

    // Client renamed → the sync may now match a DIFFERENT account. Move means
    // move: clear this invoice's synced lines off any other account first, so
    // the book never carries the same invoice twice.
    await db.statementEntry.deleteMany({
      where: { sourceRef: { in: refs }, account: { ownerId: owner }, accountId: { not: accountId } },
    })

    await upsertLine(accountId, refs[0], {
      date: invoice.issuedAt,
      product: firstItemDescription(invoice.items),
      remarks: `Invoice ${invoice.number}`,
      quantity: '1',
      amount: Math.round(invoice.total * 100) / 100,
      kind: 'CHARGE',
    })

    let payNote = ''
    if (invoice.status === 'PAID') {
      await upsertLine(accountId, `invoice:${invoice.id}:pay`, {
        date: invoice.paidAt || new Date(),
        product: null,
        remarks: `Payment received, thank you (${invoice.number})`,
        quantity: null,
        amount: -(Math.round(invoice.total * 100) / 100),
        kind: 'PAYMENT',
      })
      payNote = ' and its payment line'
    }
    return `Booked on statement ${refNo}${payNote} — it follows this invoice automatically.`
  } catch (e) {
    console.error('[statementSync] skipped:', e instanceof Error ? e.message : e)
    return null
  }
}

/** Remove every synced line an invoice owned. Never throws. */
export async function desyncInvoice(userId: string, invoiceId: string): Promise<void> {
  try {
    const owner = await sehOwnerId()
    if (!owner || userId !== owner) return
    await db.statementEntry.deleteMany({
      where: { sourceRef: { in: [`invoice:${invoiceId}`, `invoice:${invoiceId}:pay`] }, account: { ownerId: owner } },
    })
  } catch (e) {
    console.error('[statementSync] desync skipped:', e instanceof Error ? e.message : e)
  }
}
