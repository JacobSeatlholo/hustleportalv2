import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { ensureWallet } from '@/lib/wallet'
import { db } from '@/lib/db'
import { DEFAULT_TOPUP_PACKS } from '@/lib/spend'

// GET /api/wallet, balance + transactions + topup packages
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
  const configured = await getConfigJson<typeof DEFAULT_TOPUP_PACKS>(CONFIG_KEYS.TOPUP_PACKS, [])
  // Preset ladder (Task 206): config wins when set, the in-code decoy ladder
  // (Starter R50 / Hustle R120 +5% / Growth R300 +10%) serves otherwise.
  const packs = configured.length > 0 ? configured : DEFAULT_TOPUP_PACKS
  return NextResponse.json({ wallet, txs, topUps, packs })
}
