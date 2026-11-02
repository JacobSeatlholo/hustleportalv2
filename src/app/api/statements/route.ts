import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { hasStatementAccess, sehOwnerId } from '@/lib/statements'

// The statements book API — SEH internal only (master account, exec seats,
// and members of the master's own team; see hasStatementAccess).
//
// GET  → every account with its entries and the computed running balances.
//        First gated load of an empty book seeds the Body Vision account
//        straight from the boss's Canva statement archive: opening balance
//        R 550.00 carried from the Apr - Aug 2026 statement, the October
//        membership charge and the R 150.00 payment he collected on 21/10.
// POST → { refNo, clientName, address?, email?, website?, phone?,
//          recipientVat?, recipientReg?, balanceBfwd? } create an account.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

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
    // Bootstrap from the boss's paper archive: one account, the ledger he
    // gave in the template PDF (Apr - Aug 2026 statement closed at R 550.00;
    // October brings the R 700 kloofstreet.online membership and the R 150
    // payment collected on the 21st). Idempotent: only runs on an empty book.
    await db.statementAccount.create({
      data: {
        ownerId: owner,
        refNo: 'BVS-0999-06',
        clientName: 'Kim Tucker | Bodyvision Studio',
        address: '2nd Floor, Lifestyle Centre',
        email: 'kim@tuckermail.co.za',
        website: 'Bodyvision.online',
        phone: '+27 82 457 2118',
        recipientReg: 'K____/____/__',
        balanceBfwd: 550,
        entries: {
          create: [
            { date: new Date('2026-10-01T00:00:00'), product: 'Membership', remarks: 'kloofstreet.online - October 2026', quantity: '1', amount: 700, kind: 'CHARGE' },
            { date: new Date('2026-10-21T00:00:00'), product: null, remarks: 'Payment Received, Thank You', quantity: null, amount: -150, kind: 'PAYMENT' },
          ],
        },
      },
    })
    seeded = true
  }

  const accounts = await db.statementAccount.findMany({
    where: { ownerId: owner },
    orderBy: { createdAt: 'asc' },
    include: { entries: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] } },
  })

  return NextResponse.json({
    accounts: accounts.map((a) => {
      const signed = a.entries.reduce((acc, e) => acc + e.amount, a.balanceBfwd)
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
