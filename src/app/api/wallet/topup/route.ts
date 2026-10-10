import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { addCredits } from '@/lib/wallet'
import { getConfigJson, CONFIG_KEYS } from '@/lib/config'
import { awardXp } from '@/lib/gamification'
import { getYocoSecretKey, createYocoCheckout, YocoError } from '@/lib/yoco'

function requestOrigin(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

// POST /api/wallet/topup — start a wallet top-up.
//  - YOCO_SECRET_KEY set  -> creates a PENDING TopUp + real Yoco Checkout, returns redirectUrl.
//  - No key configured    -> sandbox mode: confirms instantly (demo environments).
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
  if (pack.amountCents < 200) return NextResponse.json({ error: 'Yoco minimum payment is R2.00.' }, { status: 400 })

  const reference = `HP-${Date.now().toString(36).toUpperCase()}`

  const secretKey = getYocoSecretKey()
  if (secretKey) {
    const topUp = await db.topUp.create({
      data: {
        userId,
        packageId: pack.id,
        amountCents: pack.amountCents,
        creditCents: pack.creditCents,
        status: 'PENDING',
        provider: 'YOCO',
        reference,
      },
    })
    const origin = requestOrigin(req)
    try {
      const checkout = await createYocoCheckout({
        secretKey,
        amountCents: pack.amountCents,
        successUrl: `${origin}/?topup=success`,
        cancelUrl: `${origin}/?topup=cancelled`,
        failureUrl: `${origin}/?topup=failed`,
        metadata: { topUpId: topUp.id, userId, packageId: pack.id, reference },
        clientReferenceId: reference,
        idempotencyKey: topUp.id,
        name: `${pack.name} credit pack`,
      })
      await db.topUp.update({ where: { id: topUp.id }, data: { providerRef: checkout.id } })
      return NextResponse.json({ ok: true, mode: checkout.mode ?? 'test', redirectUrl: checkout.redirectUrl, topUp })
    } catch (e) {
      await db.topUp.update({ where: { id: topUp.id }, data: { status: 'FAILED' } })
      const status = e instanceof YocoError ? e.status : 500
      const msg = e instanceof Error ? e.message : 'Payment provider error'
      return NextResponse.json({ error: msg }, { status })
    }
  }

  // Sandbox mode (no YOCO_SECRET_KEY configured) — instant confirmation for demos.
  const topUp = await db.topUp.create({
    data: {
      userId,
      packageId: pack.id,
      amountCents: pack.amountCents,
      creditCents: pack.creditCents,
      status: 'PAID',
      provider: 'SANDBOX',
      reference,
      paidAt: new Date(),
    },
  })
  await addCredits(userId, pack.creditCents, 'TOPUP', `${pack.name} pack top-up (${reference})`)
  if (pack.amountCents >= 150000) await awardXp(userId, 'TOPUP', 40, 'Wallet top-up')
  return NextResponse.json({
    ok: true,
    sandbox: true,
    topUp,
    note: 'Sandbox payment confirmed instantly. Set YOCO_SECRET_KEY to enable live Yoco Checkout.',
  })
}
