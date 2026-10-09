import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { addCredits } from '@/lib/wallet'
import { getConfigJson, CONFIG_KEYS } from '@/lib/config'
import { awardXp } from '@/lib/gamification'

// POST /api/wallet/topup — create top-up intent.
// Sandbox mode: confirms instantly. Wire Yoco Checkout API here when keys are provided.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { packageId } = await req.json()
  const packs = await getConfigJson<{ id: string; name: string; amountCents: number; creditCents: number; bonus: number }[]>(
    CONFIG_KEYS.TOPUP_PACKS,
    []
  )
  const pack = packs.find((p) => p.id === packageId)
  if (!pack) return NextResponse.json({ error: 'Unknown package.' }, { status: 400 })

  const reference = `HP-${Date.now().toString(36).toUpperCase()}`
  const topUp = await db.topUp.create({
    data: {
      userId,
      packageId: pack.id,
      amountCents: pack.amountCents,
      creditCents: pack.creditCents,
      status: 'PAID', // sandbox: instant confirmation (Yoco sandbox equivalent)
      provider: 'YOCO',
      reference,
      paidAt: new Date(),
    },
  })
  await addCredits(userId, pack.creditCents, 'TOPUP', `${pack.name} pack top-up (${reference})`)
  if (pack.amountCents >= 150000) await awardXp(userId, 'TOPUP', 40, 'Wallet top-up')
  return NextResponse.json({
    ok: true,
    topUp,
    note: 'Sandbox payment confirmed instantly. Yoco Checkout will be wired with live keys.',
  })
}
