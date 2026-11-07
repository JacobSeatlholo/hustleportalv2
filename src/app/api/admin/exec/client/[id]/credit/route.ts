import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { addCredits, ensureWallet } from '@/lib/wallet'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/admin/exec/client/[id]/credit — a manual wallet top-up by the
// team, for the client. Body: { amountCents: number, note?: string }
//
// The books stay honest end to end: a real TopUp row (provider MANUAL,
// status PAID) lands next to the Yoco receipts, and the credit ledger
// carries the same cents with a plain description. The member's wallet view
// and the exec desk both read the same two rows, so nobody ever has to
// trust a number that is not written down twice.
//
// Deliberate difference from the Yoco lane: NO auto campaign fires here.
// The team credits a wallet on purpose, usually because a campaign is
// already being run by hand — the boss's words, not an engine guess.
// The ledger write joins the balance increment in one transaction inside
// addCredits, so a credit can never exist without its books.
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const body = await req.json().catch(() => ({}))
  const amountCents = Math.round(Number(body?.amountCents))
  if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > 500000) {
    return NextResponse.json({ error: 'amountCents must be between R1 and R5 000.' }, { status: 400 })
  }
  const note = typeof body?.note === 'string' && body.note.trim()
    ? body.note.trim().slice(0, 300)
    : 'Manual top-up by the Business Hustle team.'

  const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const topUp = await db.topUp.create({
    data: {
      userId: id,
      packageId: 'MANUAL',
      amountCents,
      creditCents: amountCents,
      status: 'PAID',
      provider: 'MANUAL',
      reference: `exec-manual-${Date.now()}`,
      paidAt: new Date(),
    },
  })

  const { wallet, tx } = await addCredits(id, amountCents, 'TOPUP', note)

  return NextResponse.json({
    ok: true,
    topUp: { id: topUp.id, amountCents: topUp.amountCents, provider: topUp.provider, reference: topUp.reference },
    ledger: { id: tx.id, balanceAfter: tx.balanceAfter },
    wallet: { balance: wallet.balance },
    message: `R${(amountCents / 100).toFixed(2)} loaded onto ${target.name}'s wallet. Ledger row written, books balance.`,
  })
}
