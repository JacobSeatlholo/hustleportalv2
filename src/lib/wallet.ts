import { db } from '@/lib/db'

export async function ensureWallet(userId: string) {
  // Upsert, not find-then-create: two concurrent first-touches (e.g. welcome
  // bonus racing the wallet view) would both pass the null check and one would
  // die on the unique constraint. Upsert takes the native ON CONFLICT path —
  // the loser just gets the winner's row.
  return db.wallet.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  })
}

/** Spend credits. Returns null if insufficient balance.
 *
 * One interactive transaction: the balance gate, the decrement, the ledger row.
 * The conditional UPDATE stays the double-spend guard (two concurrent reveals
 * can never both spend the same cents), and the ledger line now commits or
 * rolls back WITH the debit — a crash mid-reveal can no longer leave money
 * spent with nothing on the books. Lock order (wallet row, then creditTx
 * insert) matches addCredits, so the two paths cannot deadlock each other.
 *
 * `type` labels the ledger line: LEAD_REVEAL (the original till) or
 * FEATURE_SPEND (airtime metered feature actions — emails today, more
 * tomorrow; see src/lib/spend.ts for the ONE price list). */
export async function spendCredits(
  userId: string,
  amountCents: number,
  description: string,
  type: 'LEAD_REVEAL' | 'FEATURE_SPEND' = 'LEAD_REVEAL'
) {
  await ensureWallet(userId)
  return db.$transaction(async (tx) => {
    const claim = await tx.wallet.updateMany({
      where: { userId, balance: { gte: amountCents } },
      data: { balance: { decrement: amountCents } },
    })
    if (claim.count === 0) return null
    const wallet = await tx.wallet.findUnique({ where: { userId } })
    const record = await tx.creditTx.create({
      data: { userId, type, amount: -amountCents, description, balanceAfter: wallet?.balance ?? 0 },
    })
    return { wallet, tx: record }
  })
}

/** Credit the wallet. Returns the updated wallet and ledger row.
 *
 * Atomic increment, never read-then-write: a stale `balance + amount` landing
 * after a concurrent spend would silently resurrect spent cents (lost update).
 * The ledger row joins the same transaction, so balanceAfter is read from the
 * row the increment actually produced, not from a guess. */
export async function addCredits(
  userId: string,
  amountCents: number,
  type: 'TOPUP' | 'BONUS' | 'ADJUSTMENT',
  description: string
) {
  await ensureWallet(userId)
  return db.$transaction(async (tx) => {
    const wallet = await tx.wallet.update({
      where: { userId },
      data: { balance: { increment: amountCents } },
    })
    const record = await tx.creditTx.create({
      data: { userId, type, amount: amountCents, description, balanceAfter: wallet.balance },
    })
    return { wallet, tx: record }
  })
}

export function formatRands(cents: number) {
  const r = cents / 100
  return `R${r.toLocaleString('en-ZA', { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}
