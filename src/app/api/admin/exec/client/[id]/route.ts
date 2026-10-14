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
      suspendReason: true, createdAt: true,
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

// GET /api/admin/exec/client/[id] — one client, everything the exec needs on
// the desk: profile, plan, wallet, payment history (top-ups + credit ledger),
// projects, pipeline shape. Exec only.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const user = await loadTarget(id)
  if (!user) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const now = Date.now()
  const [topups, creditTxs, projects, stageGroups, clientsCount, invoices, leadsTotal, poolRows, poolCounts, campaigns] = await Promise.all([
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
      where: { userId: id, mode: { in: ['EXPLEE', 'POOL'] } },
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

// PATCH /api/admin/exec/client/[id] — pause or restore an account.
// Body: { status: 'ACTIVE' | 'SUSPENDED', reason?: string }
// Guard rails: the exec cannot pause themselves or any other admin/exec account.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const body = await req.json().catch(() => ({}))
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
