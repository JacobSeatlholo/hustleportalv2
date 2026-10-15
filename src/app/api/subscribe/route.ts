import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { getPlan, grantPlanRevealCredits, isValidNpoNumber, normalizeNpoNumber, priceWithNpoDiscount } from '@/lib/plans'
import { getYocoSecretKey, getYocoKeyMode, createYocoCheckout, YocoError } from '@/lib/yoco'
import { rewardOnSubscribe } from '@/lib/referral'

const MONTHLY_RENEW_DAYS = 35 // 30-day month + 5-day grace
const ANNUAL_RENEW_DAYS = 370 // 365-day year + 5-day grace

// Instant sandbox activation exists for automated QA probes only. Real
// visitors never get a plan without paying, even while the gateway is being
// connected: they get an honest message instead of free months.
const QA_SANDBOX_DOMAIN = '@hustleqa.example.com'

function requestOrigin(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

// POST /api/subscribe { plan: 'HUSTLER' | 'BOSS', cycle?: 'MONTHLY' | 'ANNUAL', npoNumber?: string }
//  - YOCO_SECRET_KEY set  -> PENDING Subscription + Yoco Checkout redirectUrl.
//  - No key configured    -> sandbox mode: activates instantly (demo environments).
// Annual = 10x the monthly price (2 months free); renewsAt = +370 days.
// Registered nonprofits pass their NPO number and pay 30% less, every cycle.
// The user is NEVER auto-charged: renewal is a fresh checkout, nudged 5 days out.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const account = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  const isQaAccount = Boolean(account?.email?.toLowerCase().endsWith(QA_SANDBOX_DOMAIN))

  const { plan: planId, cycle: rawCycle, npoNumber: rawNpo } = await req.json().catch(() => ({}))
  const plan = getPlan(String(planId || ''))
  if (!plan) return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 })
  const cycle = String(rawCycle).toUpperCase() === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY'

  const npoRaw = String(rawNpo || '').trim()
  if (npoRaw && !isValidNpoNumber(npoRaw)) {
    return NextResponse.json(
      { error: 'That NPO number does not look right. Registered South African nonprofits have 6 digits, like 044-291 or 123456. Leave it empty to subscribe at full price.' },
      { status: 400 }
    )
  }
  const npoNumber = npoRaw ? normalizeNpoNumber(npoRaw) : null
  const baseCents = cycle === 'ANNUAL' ? plan.annualCents : plan.priceCents
  const amountCents = npoNumber ? priceWithNpoDiscount(baseCents) : baseCents

  const reference = `HPSUB-${Date.now().toString(36).toUpperCase()}`
  const secretKey = getYocoSecretKey()

  if (secretKey) {
    const sub = await db.subscription.upsert({
      where: { userId },
      create: { userId, plan: plan.id, billingCycle: cycle, amountCents, status: 'PENDING', provider: 'YOCO', reference, npoNumber },
      update: { plan: plan.id, billingCycle: cycle, amountCents, status: 'PENDING', provider: 'YOCO', reference, npoNumber, startedAt: null, renewsAt: null },
    })
    const origin = requestOrigin(req)
    try {
      const checkout = await createYocoCheckout({
        secretKey,
        amountCents,
        successUrl: `${origin}/?sub=success`,
        cancelUrl: `${origin}/?sub=cancelled`,
        failureUrl: `${origin}/?sub=failed`,
        metadata: { subscriptionId: sub.id, userId, plan: plan.id, cycle, reference, ...(npoNumber ? { npoNumber } : {}) },
        clientReferenceId: reference,
        // One idempotency key per checkout ATTEMPT: the reference is fresh on
        // every subscribe call, while sub.id is stable across upserts (same row,
        // new plan) and Yoco rejects a reused key with a different payload.
        idempotencyKey: reference,
        name: `HustlePortal ${plan.name} — ${cycle === 'ANNUAL' ? 'annual (2 months free)' : 'monthly'}${npoNumber ? ' (nonprofit rate)' : ''}`,
      })
      await db.subscription.update({ where: { id: sub.id }, data: { providerRef: checkout.id } })
      // Yoco's create checkout response carries no mode field: the key text
      // decides (sk_live_ = live). Only a missing key falls back to test.
      return NextResponse.json({ ok: true, mode: checkout.mode ?? getYocoKeyMode() ?? 'test', redirectUrl: checkout.redirectUrl, subscription: sub })
    } catch (e) {
      const status = e instanceof YocoError ? e.status : 500
      const detail = e instanceof Error ? e.message : 'Payment provider error'
      console.error('[subscribe] yoco checkout failed:', detail)
      // Clients get a gentle, honest line; the raw detail lives in the logs
      // and on the exec dashboard for the owner to act on. QA probe accounts
      // may see the raw provider detail so diagnosis never needs log access.
      const msg = status === 502 || status === 504
        ? 'Card payments are momentarily unavailable. Please try again in a moment.'
        : detail
      return NextResponse.json({ error: msg, ...(isQaAccount ? { yocoDetail: detail } : {}) }, { status })
    }
  }

  // Sandbox mode — instant activation, QA probe accounts only (same quota
  // grant as the live webhook). Anyone else gets an honest answer, never a
  // free plan: the gateway is simply still being connected for them.
  if (!isQaAccount) {
    return NextResponse.json(
      { error: 'We are connecting the card gateway right now. Subscriptions open again shortly, and every free feature stays open meanwhile.' },
      { status: 503 },
    )
  }
  const renewsAt = new Date(Date.now() + (cycle === 'ANNUAL' ? ANNUAL_RENEW_DAYS : MONTHLY_RENEW_DAYS) * 24 * 60 * 60 * 1000)
  const sub = await db.subscription.upsert({
    where: { userId },
    create: {
      userId, plan: plan.id, billingCycle: cycle, amountCents, status: 'ACTIVE',
      provider: 'SANDBOX', reference, npoNumber, startedAt: new Date(), renewsAt,
    },
    update: {
      plan: plan.id, billingCycle: cycle, amountCents, status: 'ACTIVE', provider: 'SANDBOX',
      reference, npoNumber, startedAt: new Date(), renewsAt, pausedUntil: null,
    },
  })
  // Same reward + quota paths as the live webhook.
  await rewardOnSubscribe(userId).catch(() => {})
  await grantPlanRevealCredits(userId, plan).catch(() => {})
  return NextResponse.json({
    ok: true,
    sandbox: true,
    subscription: sub,
    note: npoNumber
      ? `Sandbox activation at the nonprofit rate for ${npoNumber}: 30% off, every cycle. Set YOCO_SECRET_KEY to enable live Yoco Checkout.`
      : 'Sandbox activation. Set YOCO_SECRET_KEY to enable live Yoco Checkout.',
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
