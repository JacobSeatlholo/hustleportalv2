import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { hasStatementAccess, sehOwnerId } from '@/lib/statements'

// The statements book API — SEH internal only (master account, exec seats,
// and members of the master's own team; see hasStatementAccess).
//
// GET  → every account with its entries and the computed running balances.
//        Also keeps the book faithful to the boss's paper archive:
//        1. an empty book is seeded with the Body Vision account exactly as
//           the last statement sent to Kim prints it (the Apr - Aug 2026
//           statement, closed at R 550.00) plus the R 150.00 payment he
//           collected on 21/10 → R 400.00;
//        2. a book still carrying the OLD bootstrap shape (B/f 550 + two
//           October placeholder lines) is repaired into that same archive
//           ledger. Signature-gated and idempotent: if any line was added or
//           edited by hand since, nothing is touched.
// POST → { refNo, clientName, address?, email?, website?, phone?,
//          recipientVat?, recipientReg?, balanceBfwd? } create an account.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// The archive ledger — line for line off the last statement sent to Kim
// (BVS-0999-06, created 03/09/2026), plus the recent payment. The waived
// content-creation fee stays on the book for the record with kind WAIVED: it
// prints struck through and moves no money — every balance sum skips it.
const ARCHIVE_LEDGER = [
  { date: '2026-04-25', product: 'INV-0999-06', remarks: 'Balance B/f', quantity: null as string | null, amount: 1850, kind: 'BFWD' },
  { date: '2026-05-01', product: null, remarks: 'Invoice revised:\nWebsite Development added\n- bodyvision.online', quantity: null, amount: 4500, kind: 'CHARGE' },
  { date: '2026-05-06', product: null, remarks: 'Content creation: Waive Approved by CEO.', quantity: '4.2 hours', amount: 1550, kind: 'WAIVED' },
  { date: '2026-05-30', product: null, remarks: 'Payment Received, Thank You', quantity: null, amount: -3000, kind: 'PAYMENT' },
  { date: '2026-06-27', product: null, remarks: 'Cash Payment Received, Thank You', quantity: null, amount: -1000, kind: 'PAYMENT' },
  { date: '2026-07-21', product: null, remarks: 'Cash Payment Received, Thank You', quantity: null, amount: -800, kind: 'PAYMENT' },
  { date: '2026-08-31', product: null, remarks: 'Cash Payment Received, Thank You', quantity: null, amount: -1000, kind: 'PAYMENT' },
  { date: '2026-10-21', product: null, remarks: 'Payment Received, Thank You', quantity: null, amount: -150, kind: 'PAYMENT' },
]

// For nested creates (no accountId); createMany callers add accountId.
function archiveEntryData() {
  return ARCHIVE_LEDGER.map((e) => ({ ...e, date: new Date(`${e.date}T00:00:00`) }))
}
function archiveEntries(accountId: string) {
  return archiveEntryData().map((e) => ({ ...e, accountId }))
}

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

export async function GET() {
  const g = await gate()
  if ('err' in g) return NextResponse.json({ error: g.err === 401 ? 'Unauthorized' : 'Forbidden' }, { status: g.err })

  const owner = await sehOwnerId()
  if (!owner) return NextResponse.json({ accounts: [], seeded: false, noOwner: true })

  let seeded = false
  const count = await db.statementAccount.count({ where: { ownerId: owner } })
  if (count === 0) {
    // Bootstrap from the boss's paper archive: one account, the ledger the
    // last statement to Kim actually printed (closed at R 550.00) plus the
    // R 150.00 payment collected on 21/10 → R 400.00. Idempotent: only runs
    // on an empty book.
    await db.statementAccount.create({
      data: {
        ownerId: owner,
        refNo: 'BVS-0999-06',
        clientName: 'Kim Tucker | Bodyvision Studio',
        address: '2nd Floor, Lifestyle Centre',
        email: 'kim@tuckermail.co.za',
        website: 'Bodyvision.online',
        phone: '+27 82 457 2118',
        recipientReg: 'K__/___/___',
        balanceBfwd: 0,
        entries: { create: archiveEntryData() },
      },
    })
    seeded = true
  }

  // Repair door: the first bootstrap carried B/f 550 + two October placeholder
  // lines (the R 700 membership charge among them) before the archive arrived.
  // If that EXACT signature is still on the book — nothing added or edited by
  // hand since — swap it for the archive ledger. The R 700 line goes with it:
  // the archive statements bill project fees and payments, no membership
  // lines. If she does owe October's membership, the boss adds it back by
  // hand and the balance reads R 1,100.00 again.
  const stale = await db.statementAccount.findFirst({
    where: { ownerId: owner, refNo: 'BVS-0999-06', balanceBfwd: 550 },
    include: { entries: true },
  })
  if (stale) {
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const staleSignature =
      stale.entries.length === 2 &&
      stale.entries.some((e) => iso(e.date) === '2026-10-01' && e.amount === 700 && e.kind === 'CHARGE' && e.remarks === 'kloofstreet.online - October 2026') &&
      stale.entries.some((e) => iso(e.date) === '2026-10-21' && e.amount === -150 && e.kind === 'PAYMENT' && e.remarks === 'Payment Received, Thank You')
    if (staleSignature) {
      await db.statementEntry.deleteMany({ where: { accountId: stale.id } })
      await db.statementAccount.update({ where: { id: stale.id }, data: { balanceBfwd: 0, recipientReg: 'K__/___/___' } })
      await db.statementEntry.createMany({ data: archiveEntries(stale.id) })
      seeded = true
    }
  }

  const accounts = await db.statementAccount.findMany({
    where: { ownerId: owner },
    orderBy: { createdAt: 'asc' },
    include: { entries: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] } },
  })

  return NextResponse.json({
    accounts: accounts.map((a) => {
      // WAIVED lines are on the book for the record only — they move no money.
      const signed = a.entries.reduce((acc, e) => acc + (e.kind === 'WAIVED' ? 0 : e.amount), a.balanceBfwd)
      return {
        id: a.id,
        refNo: a.refNo,
        clientName: a.clientName,
        address: a.address,
        email: a.email,
        website: a.website,
        phone: a.phone,
        recipientVat: a.recipientVat,
        recipientReg: a.recipientReg,
        balanceBfwd: a.balanceBfwd,
        balance: Math.round(signed * 100) / 100,
        entries: a.entries.map((e) => ({
          id: e.id,
          date: e.date,
          product: e.product,
          remarks: e.remarks,
          quantity: e.quantity,
          amount: e.amount,
          kind: e.kind,
        })),
      }
    }),
    seeded,
  })
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('err' in g) return NextResponse.json({ error: g.err === 401 ? 'Unauthorized' : 'Forbidden' }, { status: g.err })

  const owner = await sehOwnerId()
  if (!owner) return NextResponse.json({ error: 'The master account does not exist yet.' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const refNo = String(body?.refNo || '').trim().toUpperCase().slice(0, 24)
  const clientName = String(body?.clientName || '').trim().slice(0, 120)
  if (!refNo) return NextResponse.json({ error: 'An account ref number is required (e.g. BVS-0999-06).' }, { status: 400 })
  if (!clientName) return NextResponse.json({ error: 'The client name is required.' }, { status: 400 })

  const exists = await db.statementAccount.findUnique({ where: { refNo } })
  if (exists) return NextResponse.json({ error: `Account ref ${refNo} already exists.` }, { status: 409 })

  const balanceBfwd = Number(body?.balanceBfwd)
  const created = await db.statementAccount.create({
    data: {
      ownerId: owner,
      refNo,
      clientName,
      address: String(body?.address || '').trim().slice(0, 200) || null,
      email: EMAIL_RE.test(String(body?.email || '').trim().toLowerCase()) ? String(body.email).trim().toLowerCase() : null,
      website: String(body?.website || '').trim().slice(0, 120) || null,
      phone: String(body?.phone || '').trim().slice(0, 40) || null,
      recipientVat: String(body?.recipientVat || '').trim().slice(0, 32) || null,
      recipientReg: String(body?.recipientReg || '').trim().slice(0, 32) || null,
      balanceBfwd: Number.isFinite(balanceBfwd) ? Math.round(balanceBfwd * 100) / 100 : 0,
    },
  })
  return NextResponse.json({ ok: true, id: created.id, refNo: created.refNo })
}
