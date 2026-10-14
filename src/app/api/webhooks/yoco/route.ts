import { NextRequest, NextResponse, after } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { addCredits } from '@/lib/wallet'
import { awardXp } from '@/lib/gamification'
import { verifyYocoWebhook, getYocoWebhookSecret, getYocoSecretKeyStatus, type YocoWebhookEvent } from '@/lib/yoco'
import { rewardOnSubscribe } from '@/lib/referral'
import { getPlan, grantPlanRevealCredits } from '@/lib/plans'

/** GET /api/webhooks/yoco — config status (authenticated). */
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const secret = await getYocoWebhookSecret()
  return NextResponse.json({
    ok: true,
    configured: Boolean(secret),
    source: process.env.YOCO_WEBHOOK_SECRET ? 'env' : secret ? 'config' : 'none',
    secretKey: getYocoSecretKeyStatus(),
  })
}

/**
 * POST /api/webhooks/yoco — receives Yoco Checkout API payment notifications.
 * Event shape: { id, type: 'payment.succeeded'|'payment.failed', payload: { amount, id, mode, metadata, ... } }
 * Must respond 2xx within 15s. Verification per Standard Webhooks scheme.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text()

  const secret = await getYocoWebhookSecret()
  if (!secret) {
    // Reject unsigned processing entirely — a missing secret must never allow fake top-ups.
    return NextResponse.json({ error: 'Webhook not configured (no signing secret).' }, { status: 503 })
  }

  const verdict = verifyYocoWebhook(raw, req.headers, secret)
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: verdict.status })
  }

  let event: YocoWebhookEvent
  try {
    event = JSON.parse(raw) as YocoWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payment = event.payload ?? {}

  if (event.type === 'payment.succeeded') {
    // ---- Subscription activation (metadata.subscriptionId) ----
    if (payment.metadata?.subscriptionId) {
      const sub = await db.subscription.findUnique({ where: { id: String(payment.metadata.subscriptionId) } })
      if (sub) {
        // Idempotent claim: only transition PENDING -> ACTIVE once.
        const renewDays = sub.billingCycle === 'ANNUAL' ? 370 : 35
        const claim = await db.subscription.updateMany({
          where: { id: sub.id, status: 'PENDING' },
          data: { status: 'ACTIVE', startedAt: new Date(), pausedUntil: null, renewsAt: new Date(Date.now() + renewDays * 24 * 60 * 60 * 1000) },
        })
        if (claim.count > 0) {
          await rewardOnSubscribe(sub.userId).catch(() => {}) // R50 to whoever invited this user
          // Deliver the plan's promised lead reveals for this paid month/year.
          const plan = getPlan(sub.plan)
          if (plan) await grantPlanRevealCredits(sub.userId, plan).catch(() => {})
        }
        return NextResponse.json({ ok: true, activated: claim.count > 0, subscriptionId: sub.id })
      }
      return NextResponse.json({ ok: true, matched: false })
    }

    // ---- Wallet top-up (existing flow) ----
    // Match the TopUp: metadata.topUpId (primary) -> providerRef (Yoco payment id) -> amount+PENDING fallback.
    let topUp = payment.metadata?.topUpId
      ? await db.topUp.findUnique({ where: { id: payment.metadata.topUpId } })
      : null
    if (!topUp && payment.id) topUp = await db.topUp.findFirst({ where: { providerRef: payment.id } })
    if (!topUp && payment.amount)
      topUp = await db.topUp.findFirst({
        where: { provider: 'YOCO', status: 'PENDING', amountCents: payment.amount },
        orderBy: { createdAt: 'desc' },
      })

    if (!topUp) {
      // Acknowledge so Yoco stops retrying; nothing to reconcile.
      return NextResponse.json({ ok: true, matched: false })
    }
    // Idempotency: credit exactly once, even if Yoco redelivers.
    const claim = await db.topUp.updateMany({
      where: { id: topUp.id, status: { not: 'PAID' } },
      data: { status: 'PAID', paidAt: new Date() },
    })
    if (claim.count === 0) return NextResponse.json({ ok: true, idempotent: true })

    await addCredits(topUp.userId, topUp.creditCents, 'TOPUP', `Wallet top-up (${topUp.reference})`)
    if (topUp.amountCents >= 150000) await awardXp(topUp.userId, 'TOPUP', 40, 'Wallet top-up')
    // The owner's credit story runs after the response: exec email + auto campaign.
    after(async () => {
      const { onPaidTopUp } = await import('@/lib/execnotify')
      await onPaidTopUp(topUp.id)
    })
    return NextResponse.json({ ok: true, credited: topUp.creditCents, reference: topUp.reference })
  }

  if (event.type === 'payment.failed') {
    let topUp = payment.metadata?.topUpId
      ? await db.topUp.findUnique({ where: { id: payment.metadata.topUpId } })
      : null
    if (!topUp && payment.id) topUp = await db.topUp.findFirst({ where: { providerRef: payment.id } })
    if (topUp) {
      await db.topUp.updateMany({
        where: { id: topUp.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      })
    }
    return NextResponse.json({ ok: true })
  }

  // Unknown event type — acknowledge.
  return NextResponse.json({ ok: true, ignored: event.type })
}
