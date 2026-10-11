import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { getPlan } from '@/lib/plans'
import { getYocoSecretKey, createYocoCheckout, YocoError } from '@/lib/yoco'
import { rewardOnSubscribe } from '@/lib/referral'

function requestOrigin(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

// POST /api/subscribe { plan: 'HUSTLER' | 'BOSS' } — start a monthly plan.
//  - YOCO_SECRET_KEY set  -> PENDING Subscription + Yoco Checkout redirectUrl.
//  - No key configured    -> sandbox mode: activates instantly (demo environments).
// Renewal model: renewsAt = +35 days (5-day grace); the app nudges renewal 5 days
// before and flips to PAST_DUE after expiry (see GET).
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan: planId } = await req.json().catch(() => ({}))
  const plan = getPlan(String(planId || ''))
  if (!plan) return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 })

  const reference = `HPSUB-${Date.now().toString(36).toUpperCase()}`
  const secretKey = getYocoSecretKey()

  if (secretKey) {
    const sub = await db.subscription.upsert({
      where: { userId },
      create: { userId, plan: plan.id, amountCents: plan.priceCents, status: 'PENDING', provider: 'YOCO', reference },
      update: { plan: plan.id, amountCents: plan.priceCents, status: 'PENDING', provider: 'YOCO', reference, startedAt: null, renewsAt: null },
    })
    const origin = requestOrigin(req)
    try {
      const checkout = await createYocoCheckout({
        secretKey,
        amountCents: plan.priceCents,
        successUrl: `${origin}/?sub=success`,
        cancelUrl: `${origin}/?sub=cancelled`,
        failureUrl: `${origin}/?sub=failed`,
        metadata: { subscriptionId: sub.id, userId, plan: plan.id, reference },
        clientReferenceId: reference,
        idempotencyKey: sub.id,
        name: `HustlePortal ${plan.name} — monthly`,
      })
      await db.subscription.update({ where: { id: sub.id }, data: { providerRef: checkout.id } })
      return NextResponse.json({ ok: true, mode: checkout.mode ?? 'test', redirectUrl: checkout.redirectUrl, subscription: sub })
    } catch (e) {
      const status = e instanceof YocoError ? e.status : 500
      const msg = e instanceof Error ? e.message : 'Payment provider error'
      return NextResponse.json({ error: msg }, { status })
    }
  }

  // Sandbox mode — instant activation for demos.
  const renewsAt = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000)
  const sub = await db.subscription.upsert({
    where: { userId },
    create: {
      userId, plan: plan.id, amountCents: plan.priceCents, status: 'ACTIVE',
      provider: 'SANDBOX', reference, startedAt: new Date(), renewsAt,
    },
    update: {
      plan: plan.id, amountCents: plan.priceCents, status: 'ACTIVE', provider: 'SANDBOX',
      reference, startedAt: new Date(), renewsAt,
    },
  })
  // Same reward path as the live webhook: referrer earns when an invite subscribes.
  await rewardOnSubscribe(userId).catch(() => {})
  return NextResponse.json({
    ok: true,
    sandbox: true,
    subscription: sub,
    note: 'Sandbox activation. Set YOCO_SECRET_KEY to enable live Yoco Checkout.',
  })
}

// GET /api/subscribe — the caller's current plan state (with lazy expiry flip).
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sub = await db.subscription.findUnique({ where: { userId } })
  if (!sub) return NextResponse.json({ subscription: null, plan: 'FREE' })

  // Lazy expiry: PAST_DUE once renewsAt has passed (user can re-subscribe any time).
  let current = sub
  if (sub.status === 'ACTIVE' && sub.renewsAt && sub.renewsAt.getTime() < Date.now()) {
    current = await db.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } })
  }
  return NextResponse.json({ subscription: current, plan: current.status === 'ACTIVE' ? current.plan : 'FREE' })
}
