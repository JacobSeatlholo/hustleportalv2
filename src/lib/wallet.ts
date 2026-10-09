import { db } from '@/lib/db'

export async function ensureWallet(userId: string) {
  const existing = await db.wallet.findUnique({ where: { userId } })
  if (existing) return existing
  return db.wallet.create({ data: { userId, balance: 0 } })
}

/** Spend credits. Returns null if insufficient balance. */
export async function spendCredits(userId: string, amountCents: number, description: string) {
  const wallet = await ensureWallet(userId)
  if (wallet.balance < amountCents) return null
  const balance = wallet.balance - amountCents
  const [walletUpdated, tx] = await db.$transaction([
    db.wallet.update({ where: { userId }, data: { balance } }),
    db.creditTx.create({
      data: { userId, type: 'LEAD_REVEAL', amount: -amountCents, description, balanceAfter: balance },
    }),
  ])
  return { wallet: walletUpdated, tx }
}

export async function addCredits(
  userId: string,
  amountCents: number,
  type: 'TOPUP' | 'BONUS' | 'ADJUSTMENT',
  description: string
) {
  const wallet = await ensureWallet(userId)
  const balance = wallet.balance + amountCents
  const [walletUpdated, tx] = await db.$transaction([
    db.wallet.update({ where: { userId }, data: { balance } }),
    db.creditTx.create({
      data: { userId, type, amount: amountCents, description, balanceAfter: balance },
    }),
  ])
  return { wallet: walletUpdated, tx }
}

export function formatRands(cents: number) {
  const r = cents / 100
  return `R${r.toLocaleString('en-ZA', { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}
