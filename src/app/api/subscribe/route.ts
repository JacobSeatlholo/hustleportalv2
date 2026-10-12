import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { getPlan, grantPlanRevealCredits } from '@/lib/plans'
import { getYocoSecretKey, createYocoCheckout, YocoError } from '@/lib/yoco'
import { rewardOnSubscribe } from '@/lib/referral'

const MONTHLY_RENEW_DAYS = 35 // 30-day month + 5-day grace
const ANNUAL_RENEW_DAYS = 370 // 365-day year + 5-day grace

function requestOrigin(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

// POST /api/subscribe { plan: 'HUSTLER' | 'BOSS', cycle?: 'MONTHLY' | 'ANNUAL' }
//  - YOCO_SECRET_KEY set  -> PENDING Subscription + Yoco Checkout redirectUrl.
//  - No key configured    -> sandbox mode: activates instantly (demo environments).
// Annual = 10x the monthly price (2 months free); renewsAt = +370 days.
// The user is NEVER auto-charged: renewal is a fresh checkout, nudged 5 days out.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan: planId, cycle: rawCycle } = await req.json().catch(() => ({}))
  const plan = getPlan(String(planId || ''))
  if (!plan) return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 })
  const cycle = String(rawCycle).toUpperCase() === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY'
  const amountCents = cycle === 'ANNUAL' ? plan.annualCents : plan.priceCents

  const reference = `HPSUB-${Date.now().toString(36).toUpperCase()}`
  const secretKey = getYocoSecretKey()

  if (secretKey) {
    const sub = await db.subscription.upsert({
      where: { userId },
      create: { userId, plan: plan.id, billingCycle: cycle, amountCents, status: 'PENDING', provider: 'YOCO', reference },
      update: { plan: plan.id, billingCycle: cycle, amountCents, status: 'PENDING', provider: 'YOCO', reference, startedAt: null, renewsAt: null },
    })
    const origin = requestOrigin(req)
    try {
      const checkout = await createYocoCheckout({
        secretKey,
        amountCents,
        successUrl: `${origin}/?sub=success`,
        cancelUrl: `${origin}/?sub=cancelled`,
        failureUrl: `${origin}/?sub=failed`,
        metadata: { subscriptionId: sub.id, userId, plan: plan.id, cycle, reference },
        clientReferenceId: reference,
        idempotencyKey: sub.id,
        name: `HustlePortal ${plan.name} — ${cycle === 'ANNUAL' ? 'annual (2 months free)' : 'monthly'}`,
      })
      await db.subscription.update({ where: { id: sub.id }, data: { providerRef: checkout.id } })
      return NextResponse.json({ ok: true, mode: checkout.mode ?? 'test', redirectUrl: checkout.redirectUrl, subscription: sub })
    } catch (e) {
      const status = e instanceof YocoError ? e.status : 500
      const msg = e instanceof Error ? e.message : 'Payment provider error'
      return NextResponse.json({ error: msg }, { status })
    }
  }

  // Sandbox mode — instant activation for demos (same quota grant as the live webhook).
  const renewsAt = new Date(Date.now() + (cycle === 'ANNUAL' ? ANNUAL_RENEW_DAYS : MONTHLY_RENEW_DAYS) * 24 * 60 * 60 * 1000)
  const sub = await db.subscription.upsert({
    where: { userId },
    create: {
      userId, plan: plan.id, billingCycle: cycle, amountCents, status: 'ACTIVE',
      provider: 'SANDBOX', reference, startedAt: new Date(), renewsAt,
    },
    update: {
      plan: plan.id, billingCycle: cycle, amountCents, status: 'ACTIVE', provider: 'SANDBOX',
      reference, startedAt: new Date(), renewsAt, pausedUntil: null,
    },
  })
  // Same reward + quota paths as the live webhook.
  await rewardOnSubscribe(userId).catch(() => {})
  await grantPlanRevealCredits(userId, plan).catch(() => {})
  return NextResponse.json({
    ok: true,
    sandbox: true,
    subscription: sub,
    note: 'Sandbox activation. Set YOCO_SECRET_KEY to enable live Yoco Checkout.',
  })
}

// GET /api/subscribe — the caller's current plan state (with lazy expiry + auto-resume).
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let sub = await db.subscription.findUnique({ where: { userId } })
  if (!sub) return NextResponse.json({ subscription: null, plan: 'FREE' })

  // Lazy pause end: PAUSED past pausedUntil auto-resumes — renewsAt shifts by the
  // frozen duration (30 days) so zero paid days are lost.
  if (sub.status === 'PAUSED' && sub.pausedUntil && sub.pausedUntil.getTime() <= Date.now()) {
    const shiftMs = 30 * 24 * 60 * 60 * 1000
    sub = await db.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        pausedUntil: null,
        ...(sub.renewsAt ? { renewsAt: new Date(sub.renewsAt.getTime() + shiftMs) } : {}),
      },
    })
  }

  // Lazy expiry: PAST_DUE once renewsAt has passed (user can re-subscribe any time).
  if (sub.status === 'ACTIVE' && sub.renewsAt && sub.renewsAt.getTime() < Date.now()) {
    sub = await db.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } })
  }
  return NextResponse.json({
    subscription: sub,
    plan: sub.status === 'ACTIVE' || sub.status === 'PAUSED' ? sub.plan : 'FREE',
  })
}
