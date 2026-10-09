import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { ensureWallet } from '@/lib/wallet'
import { db } from '@/lib/db'

// GET /api/wallet — balance + transactions + topup packages
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const wallet = await ensureWallet(userId)
  const txs = await db.creditTx.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  const topUps = await db.topUp.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const { getConfigJson, CONFIG_KEYS } = await import('@/lib/config')
  const packs = await getConfigJson(CONFIG_KEYS.TOPUP_PACKS, [])
  return NextResponse.json({ wallet, txs, topUps, packs })
}
