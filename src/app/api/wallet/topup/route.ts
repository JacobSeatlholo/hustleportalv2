import { NextRequest, NextResponse, after } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { addCredits } from '@/lib/wallet'
import { getConfigJson, CONFIG_KEYS } from '@/lib/config'
import { awardXp } from '@/lib/gamification'
import { getYocoSecretKey, getYocoKeyMode, createYocoCheckout, YocoError } from '@/lib/yoco'

function requestOrigin(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

// Instant sandbox top ups exist for automated QA probes only. Real visitors
// never get wallet credit without paying, even while the gateway is being
// connected: they get an honest message instead of free credit.
const QA_SANDBOX_DOMAIN = '@hustleqa.example.com'

// POST /api/wallet/topup, start a wallet top-up.
//  - YOCO_SECRET_KEY set  -> creates a PENDING TopUp + real Yoco Checkout, returns redirectUrl.
//  - No key configured    -> sandbox mode: confirms instantly (demo environments).
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const account = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  const isQaAccount = Boolean(account?.email?.toLowerCase().endsWith(QA_SANDBOX_DOMAIN))
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
      // Same mode rule as subscribe: Yoco omits mode on checkout creation,
      // the key text decides. Never scare the owner with a fake 'test'.
      return NextResponse.json({ ok: true, mode: checkout.mode ?? getYocoKeyMode() ?? 'test', redirectUrl: checkout.redirectUrl, topUp })
    } catch (e) {
      await db.topUp.update({ where: { id: topUp.id }, data: { status: 'FAILED' } })
      const status = e instanceof YocoError ? e.status : 500
      const detail = e instanceof Error ? e.message : 'Payment provider error'
      console.error('[topup] yoco checkout failed:', detail)
      // Clients get a gentle, honest line; the raw detail lives in the logs
      // and on the exec dashboard for the owner to act on. QA probe accounts
      // may see the raw provider detail so diagnosis never needs log access.
      const msg = status === 502 || status === 504
        ? 'Card payments are momentarily unavailable. Please try again in a moment.'
        : detail
      return NextResponse.json({ error: msg, ...(isQaAccount ? { yocoDetail: detail } : {}) }, { status })
    }
  }

  // Sandbox mode (no YOCO_SECRET_KEY configured), instant confirmation, QA
  // probe accounts only. Anyone else gets an honest answer, never free credit.
  if (!isQaAccount) {
    return NextResponse.json(
      { error: 'We are connecting the card gateway right now. Wallet top ups open again shortly.' },
      { status: 503 },
    )
  }
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
  // Sandbox payments carry the same credit story as live ones: owner email + campaign.
  after(async () => {
    const { onPaidTopUp } = await import('@/lib/execnotify')
    await onPaidTopUp(topUp.id)
  })
  return NextResponse.json({
    ok: true,
    sandbox: true,
    topUp,
    note: 'Sandbox payment confirmed instantly. Set YOCO_SECRET_KEY to enable live Yoco Checkout.',
  })
}
