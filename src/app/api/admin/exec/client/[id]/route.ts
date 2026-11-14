import { NextRequest, NextResponse } from 'next/server'
import { isExecUser, requireExec } from '@/lib/admin'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

async function loadTarget(id: string) {
  return db.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, businessName: true, industry: true, city: true,
      phone: true, role: true, platformAdmin: true, accountStatus: true, suspendedAt: true,
      suspendReason: true, createdAt: true, refCode: true,
      wallet: { select: { balance: true } },
      subscription: {
        select: {
          plan: true, status: true, billingCycle: true, amountCents: true, provider: true,
          reference: true, npoNumber: true, pausedUntil: true, startedAt: true, renewsAt: true,
        },
      },
    },
  })
}

// GET /api/admin/exec/client/[id], one client, everything the exec needs on
// the desk: profile, plan, wallet, payment history (top-ups + credit ledger),
// projects, pipeline shape. Exec only.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const user = await loadTarget(id)
  if (!user) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const now = Date.now()
  const [topups, creditTxs, projects, stageGroups, pipelineRows, clientsCount, invoices, leadsTotal, poolRows, poolCounts, campaigns] = await Promise.all([
    db.topUp.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, packageId: true, amountCents: true, creditCents: true, status: true, provider: true, reference: true, providerRef: true, createdAt: true, paidAt: true },
    }),
    db.creditTx.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, type: true, amount: true, description: true, balanceAfter: true, createdAt: true },
    }),
    db.project.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, isDefault: true, industry: true, createdAt: true, _count: { select: { leads: true, clients: true, invoices: true } } },
    }),
    db.lead.groupBy({ by: ['stage'], where: { userId: id }, _count: { _all: true } }),
    // The client's actual lead rows: the exec sees the names, not just the
    // stage counts (dedup checks across clients, quality reads, the boss's
    // "is this pipeline real" question). Read only, newest first.
    db.lead.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, company: true, contactName: true, city: true, industry: true, stage: true, score: true, source: true, notes: true, createdAt: true },
    }),
    db.client.count({ where: { userId: id } }),
    db.invoice.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, number: true, clientName: true, status: true, total: true, issuedAt: true, paidAt: true },
    }),
    db.lead.count({ where: { userId: id } }),
    // The client's lead pool bench: waiting first (oldest first so nothing rots
    // at the back), then the most recent adds for context. desc on status puts
    // NEW before ADDED alphabetically.
    db.clientPoolLead.findMany({
      where: { userId: id, status: { in: ['NEW', 'ADDED'] } },
      orderBy: [{ status: 'desc' }, { createdAt: 'asc' }],
      take: 120,
    }),
    db.clientPoolLead.groupBy({ by: ['status'], where: { userId: id }, _count: { _all: true } }),
    db.scanRun.findMany({
      where: { userId: id, mode: 'CAMPAIGN' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, mode: true, leadCount: true, fromPool: true, createdAt: true },
    }),
  ])

  const sub = user.subscription
  const subLive = sub && sub.status === 'ACTIVE' && (!sub.renewsAt || sub.renewsAt.getTime() >= now)
  const poolMap = Object.fromEntries(poolCounts.map((g) => [g.status, g._count._all]))

  return NextResponse.json({
    client: {
      ...user,
      isAdmin: user.role === 'ADMIN' || user.platformAdmin,
      subStatus: sub ? (subLive ? 'ACTIVE' : sub.status === 'ACTIVE' ? 'PAST_DUE' : sub.status) : 'NONE',
    },
    payments: {
      topups,
      creditTxs,
    },
    projects: projects.map((p) => ({ ...p, counts: p._count })),
    pipeline: {
      stages: Object.fromEntries(stageGroups.map((g) => [g.stage, g._count._all])),
      total: leadsTotal,
      rows: pipelineRows,
    },
    pool: {
      rows: poolRows,
      counts: { NEW: poolMap.NEW ?? 0, ADDED: poolMap.ADDED ?? 0, DISMISSED: poolMap.DISMISSED ?? 0 },
      campaigns,
    },
    clientsCount,
    invoices,
  })
}

// PATCH /api/admin/exec/client/[id], pause or restore an account, or set the
// member's personal referral code.
// Body: { status: 'ACTIVE' | 'SUSPENDED', reason?: string } | { refCode: string } | { pricingTier: 'SELF_SERVE' | 'PREMIUM_DFY' }
// Guard rails: the exec cannot pause themselves or any other admin/exec account.
// Referral codes: 4 to 16 letters and numbers, stored uppercase (attribution
// uppercases at signup anyway), unique across members, exec seats excluded.
// Replacing a code retires the old printed links on purpose, rewards already
// attributed never move.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const body = await req.json().catch(() => ({}))

  // Referral code path: the exec sets a memorable personal code for a member.
  if (typeof body?.refCode === 'string') {
    const code = body.refCode.trim().toUpperCase()
    if (!/^[A-Z0-9]{4,16}$/.test(code)) {
      return NextResponse.json({ error: 'Referral code must be 4 to 16 letters or numbers.' }, { status: 400 })
    }
    const target = await loadTarget(id)
    if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    if (isExecUser(target)) {
      return NextResponse.json({ error: 'Exec seats do not carry referral codes.' }, { status: 400 })
    }
    const clash = await db.user.findUnique({ where: { refCode: code }, select: { id: true } })
    if (clash && clash.id !== id) {
      return NextResponse.json({ error: 'That referral code is already taken.' }, { status: 409 })
    }
    const updated = await db.user.update({
      where: { id },
      data: { refCode: code },
      select: { id: true, refCode: true },
    })
    return NextResponse.json({
      ok: true,
      client: updated,
      note: target.refCode && target.refCode !== code
        ? 'Old link retired. Links shared with the previous code stop attributing.'
        : 'Referral code set.',
    })
  }

  // Pricing tier path: the exec moves an account between the self-serve
  // ladder (R18 list, R15 at Operator+) and the B2B done-for-you rate (R108
  // flat, the rate the strategist agreement prices Stream B on). Exec seats
  // never carry a tier.
  if (typeof body?.pricingTier === 'string') {
    const tier = body.pricingTier
    if (tier !== 'SELF_SERVE' && tier !== 'PREMIUM_DFY') {
      return NextResponse.json({ error: 'pricingTier must be SELF_SERVE or PREMIUM_DFY.' }, { status: 400 })
    }
    const target = await loadTarget(id)
    if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    if (isExecUser(target)) {
      return NextResponse.json({ error: 'Exec seats do not carry pricing tiers.' }, { status: 400 })
    }
    const updated = await db.user.update({
      where: { id },
      data: { pricingTier: tier },
      select: { id: true, pricingTier: true },
    })
    return NextResponse.json({
      ok: true,
      client: updated,
      note: tier === 'PREMIUM_DFY'
        ? 'Account moved to the done-for-you rate (R108 per lead reveal).'
        : 'Account back on the self-serve ladder (R18 list, R15 at Operator+).',
    })
  }

  const status = body?.status
  if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
    return NextResponse.json({ error: 'Status must be ACTIVE or SUSPENDED.' }, { status: 400 })
  }

  const target = await loadTarget(id)
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  if (isExecUser(target)) {
    return NextResponse.json({ error: 'Admin and executive accounts cannot be paused.' }, { status: 400 })
  }

  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 300) : null
  const updated = await db.user.update({
    where: { id },
    data:
      status === 'SUSPENDED'
        ? { accountStatus: 'SUSPENDED', suspendedAt: new Date(), suspendReason: reason }
        : { accountStatus: 'ACTIVE', suspendedAt: null, suspendReason: null },
    select: { id: true, accountStatus: true, suspendedAt: true, suspendReason: true },
  })

  return NextResponse.json({ ok: true, client: updated })
}
