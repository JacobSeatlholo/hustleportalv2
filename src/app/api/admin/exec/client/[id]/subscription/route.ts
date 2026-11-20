import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { getPlan, grantPlanRevealCredits } from '@/lib/plans'
import { ensureWallet } from '@/lib/wallet'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/admin/exec/client/[id]/subscription — put a member on a plan by
// hand (the team comp / cash-collected-offline door). Body:
//   { plan: 'HUSTLER' | 'BOSS', cycle?: 'MONTHLY' | 'ANNUAL',
//     months?: 1..24 (how long the grant runs, default 1), note?: string }
//
// The row looks exactly like what a Yoco receipt writes: status ACTIVE,
// startedAt now, renewsAt now + the cycle's days (35 monthly / 370 annual,
// the same grace math the webhook uses) × the months granted, provider
// MANUAL and an exec-comp reference — so the exec desk, planState and every
// gate read it as the paying member it declares. The plan's reveal allowance
// pours into the wallet the same way the webhook pours it for a paid sub.
//
// Two deliberate differences from the paid lane, both honest:
//  - NO rewardOnSubscribe: that R50 belongs to a real paid conversion, and
//    no money moved here. A comp never pays a referral bonus.
//  - NO checkout / PENDING row: the team's decision IS the payment here,
//    the same law as the manual wallet top-up door next door.
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const body = await req.json().catch(() => ({}))
  const plan = getPlan(String(body?.plan || ''))
  if (!plan) return NextResponse.json({ error: 'Unknown plan. HUSTLER or BOSS.' }, { status: 400 })
  const cycle = String(body?.cycle || 'MONTHLY').toUpperCase() === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY'
  const months = Math.max(1, Math.min(24, Math.round(Number(body?.months) || 1)))
  const note = typeof body?.note === 'string' && body.note.trim()
    ? body.note.trim().slice(0, 300)
    : `Plan granted by the Business Hustle team (${cycle.toLowerCase()}, ${months} month${months > 1 ? 's' : ''}).`

  const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const amountCents = cycle === 'ANNUAL' ? plan.annualCents : plan.priceCents
  const renewDays = (cycle === 'ANNUAL' ? 370 : 35) * months
  const reference = `exec-comp-${Date.now().toString(36).toUpperCase()}`

  const sub = await db.subscription.upsert({
    where: { userId: id },
    create: {
      userId: id,
      plan: plan.id,
      billingCycle: cycle,
      amountCents,
      status: 'ACTIVE',
      provider: 'MANUAL',
      reference,
      startedAt: new Date(),
      renewsAt: new Date(Date.now() + renewDays * 24 * 60 * 60 * 1000),
    },
    update: {
      plan: plan.id,
      billingCycle: cycle,
      amountCents,
      status: 'ACTIVE',
      provider: 'MANUAL',
      reference,
      startedAt: new Date(),
      renewsAt: new Date(Date.now() + renewDays * 24 * 60 * 60 * 1000),
      pausedUntil: null,
    },
  })

  // The plan's reveal allowance lands in the wallet, exactly as it does when
  // the webhook activates a paid sub — the member opens the plan with the
  // same working balance a card payment would have granted.
  await grantPlanRevealCredits(id, plan).catch(() => {})
  const wallet = await ensureWallet(id)

  return NextResponse.json({
    ok: true,
    subscription: { id: sub.id, plan: sub.plan, status: sub.status, cycle: sub.billingCycle, renewsAt: sub.renewsAt, provider: sub.provider, reference: sub.reference },
    wallet: { balance: wallet.balance },
    message: `${target.name} is on ${plan.name} (${cycle.toLowerCase()}, renews ${sub.renewsAt?.toISOString().slice(0, 10)}) — reveal allowance credited, wallet at R${(wallet.balance / 100).toFixed(2)}.`,
  })
}
