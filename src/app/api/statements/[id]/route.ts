import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { hasStatementAccess, sehOwnerId } from '@/lib/statements'

// Per-account statement ledger.
//
// GET            → the account with entries (ascending) and running balances.
// POST           → add an entry { date, product?, remarks, quantity?, amount,
//                  kind? } — amount is signed: + charge, - payment received.
// DELETE ?entry= → remove one entry by id (typos happen; money lines must be
//                  fixable by the person who typed them).

async function gate() {
  const userId = await getUserId()
  if (!userId) return { err: 401 as const }
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, platformAdmin: true },
  })
  if (!me) return { err: 401 as const }
  if (!(await hasStatementAccess(me))) return { err: 403 as const }
  return { me }
}

async function loadAccount(id: string, ownerId: string) {
  return db.statementAccount.findFirst({
    where: { id, ownerId },
    include: { entries: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] } },
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate()
  if ('err' in g) return NextResponse.json({ error: g.err === 401 ? 'Unauthorized' : 'Forbidden' }, { status: g.err })
  const owner = await sehOwnerId()
  if (!owner) return NextResponse.json({ error: 'No book owner.' }, { status: 400 })
  const { id } = await params
  const account = await loadAccount(id, owner)
  if (!account) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
  return NextResponse.json({
    account: {
      id: account.id,
      refNo: account.refNo,
      clientName: account.clientName,
      address: account.address,
      email: account.email,
      website: account.website,
      phone: account.phone,
      recipientVat: account.recipientVat,
      recipientReg: account.recipientReg,
      balanceBfwd: account.balanceBfwd,
      entries: account.entries.map((e) => ({
        id: e.id,
        date: e.date,
        product: e.product,
        remarks: e.remarks,
        quantity: e.quantity,
        amount: e.amount,
        kind: e.kind,
      })),
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate()
  if ('err' in g) return NextResponse.json({ error: g.err === 401 ? 'Unauthorized' : 'Forbidden' }, { status: g.err })
  const owner = await sehOwnerId()
  if (!owner) return NextResponse.json({ error: 'No book owner.' }, { status: 400 })
  const { id } = await params
  const account = await db.statementAccount.findFirst({ where: { id, ownerId: owner }, select: { id: true } })
  if (!account) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const remarks = String(body?.remarks || '').trim().slice(0, 300)
  if (!remarks) return NextResponse.json({ error: 'A remark is required (what is this line for?).' }, { status: 400 })
  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: 'Give the amount: positive to bill, negative for a payment received.' }, { status: 400 })
  }
  const dateRaw = new Date(String(body?.date || ''))
  if (Number.isNaN(dateRaw.getTime())) {
    return NextResponse.json({ error: 'A valid date is required (dd/mm/yyyy).' }, { status: 400 })
  }

  const kindRaw = String(body?.kind || (amount > 0 ? 'CHARGE' : 'PAYMENT')).toUpperCase()
  // WAIVED = on the book for the record (prints struck through, moves no money).
  const kind = ['BFWD', 'CHARGE', 'PAYMENT', 'WAIVED'].includes(kindRaw) ? kindRaw : amount > 0 ? 'CHARGE' : 'PAYMENT'

  const entry = await db.statementEntry.create({
    data: {
      accountId: account.id,
      date: dateRaw,
      product: String(body?.product || '').trim().slice(0, 60) || null,
      remarks,
      quantity: String(body?.quantity || '').trim().slice(0, 24) || null,
      amount: Math.round(amount * 100) / 100,
      kind,
    },
  })
  return NextResponse.json({ ok: true, id: entry.id })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate()
  if ('err' in g) return NextResponse.json({ error: g.err === 401 ? 'Unauthorized' : 'Forbidden' }, { status: g.err })
  const owner = await sehOwnerId()
  if (!owner) return NextResponse.json({ error: 'No book owner.' }, { status: 400 })
  const { id } = await params
  const account = await db.statementAccount.findFirst({ where: { id, ownerId: owner }, select: { id: true } })
  if (!account) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
  const entryId = new URL(req.url).searchParams.get('entry')
  if (!entryId) return NextResponse.json({ error: 'Which entry? Pass ?entry=<id>.' }, { status: 400 })
  const entry = await db.statementEntry.findFirst({ where: { id: entryId, accountId: account.id }, select: { id: true } })
  if (!entry) return NextResponse.json({ error: 'Entry not found on this account.' }, { status: 404 })
  await db.statementEntry.delete({ where: { id: entry.id } })
  return NextResponse.json({ ok: true })
}
