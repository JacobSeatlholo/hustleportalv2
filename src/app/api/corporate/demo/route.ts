import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { strategistForDashboardKey } from '@/lib/corporateKeys'

export const maxDuration = 60

// ============ PARTNER DASHBOARD DEMO DATA (owner, Task 221 round 4) ============
// The boss demonstrates Kelo's dashboard to him: dummy accounts on the floor,
// referrals attributed to the boss's own test account (the referrer who "made"
// them), reveal and top-up figures behind the KPIs, tags, the network table.
// Seeded rows are 100% identifiable:
//   - demo users: email endsWith @demo.hustleportal.internal (never real people)
//   - demo referrer rewards: CreditTx description startsWith '[demo]'
// Reset deletes exactly those rows and restores the referrer's wallet, so the
// demo never contaminates a real ledger.
//
// GATE: the dashboard key. The slug is DERIVED from the key, never from the
// body — a caller can only ever seed the floor the key belongs to. The demo
// controls render only when the dashboard URL carries &demo=1, which stays
// out of the URL Kelo is given: he sees a fully populated dashboard, the boss
// holds the reset.

const DEMO_DOMAIN = '@demo.hustleportal.internal'
const DEMO_TX_MARK = '[demo]'
const DAY = 24 * 60 * 60 * 1000
const REVEAL_CENTS = 11000 // the flat managed rate

interface DemoDef {
  name: string
  business: string
  daysAgo: number
  reveals: number
  revealSpanDays: number
  lastRevealDaysAgo: number
  topups: number[]
  emails: number
}

// Realistic SA corporate floors, figures that read like a live funnel:
// 32 reveals total (R1600 share to the strategist), four tags exercised
// (NEW, ACTIVATED, PAYING, IDLE), one account on the close-now list.
const DEMO_DEFS: DemoDef[] = [
  { name: 'Thabo Khoza', business: 'Khoza Cross-Border Transport', daysAgo: 49, reveals: 14, revealSpanDays: 42, lastRevealDaysAgo: 3, topups: [60000, 60000], emails: 118 },
  { name: 'Naledi Mokoena', business: 'Naledi Facilities & Cleaning', daysAgo: 38, reveals: 9, revealSpanDays: 30, lastRevealDaysAgo: 6, topups: [50000], emails: 74 },
  { name: 'Riaan van Wyk', business: 'Van Wyk Security Services', daysAgo: 34, reveals: 6, revealSpanDays: 10, lastRevealDaysAgo: 24, topups: [33000], emails: 41 },
  { name: 'Ayesha Patel', business: 'Patel Corporate Catering', daysAgo: 15, reveals: 3, revealSpanDays: 8, lastRevealDaysAgo: 2, topups: [], emails: 12 },
  { name: 'Sibusiso Nkosi', business: 'Nkosi Building Contractors', daysAgo: 9, reveals: 0, revealSpanDays: 0, lastRevealDaysAgo: 0, topups: [], emails: 0 },
  { name: 'Lerato Molefe', business: 'Molefe IT Support', daysAgo: 4, reveals: 0, revealSpanDays: 0, lastRevealDaysAgo: 0, topups: [], emails: 0 },
]

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { key?: string; action?: string; referrerEmail?: string } | null
  if (!body || typeof body.key !== 'string' || !['seed', 'reset'].includes(String(body.action))) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  // Key IS the authorization AND the slug: derive, never trust the client.
  const hit = strategistForDashboardKey(body.key)
  if (!hit) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const slug = hit.slug
  const gate = rateLimit(`corporate-demo:${slug}`, 10, 60 * 60 * 1000)
  if (!gate.ok) return NextResponse.json(tooMany(gate.retryAfterSec), { status: 429 })

  if (body.action === 'reset') return resetDemo(slug)
  return seedDemo(slug, body.referrerEmail)
}

async function seedDemo(slug: string, referrerEmail?: string) {
  const existing = await db.user.count({ where: { email: { endsWith: DEMO_DOMAIN } } })
  if (existing > 0) {
    return NextResponse.json({ ok: false, error: 'Demo data is already loaded. Reset it first.', already: true })
  }

  // The referrer the demo attributions ride on: the boss's test account.
  // Explicit email wins (must belong to THIS floor), else the floor's oldest
  // non-demo account — with one test account on a fresh floor that is him.
  let referrer = referrerEmail
    ? await db.user.findFirst({ where: { email: referrerEmail.toLowerCase().trim(), corporatePartner: slug }, select: { id: true, name: true, email: true } })
    : await db.user.findFirst({
        where: { corporatePartner: slug, email: { not: { endsWith: DEMO_DOMAIN } } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true },
      })
  if (!referrer) return NextResponse.json({ ok: false, error: 'No floor account to attribute the demo referrals to yet.' }, { status: 400 })

  const now = Date.now()
  const created: { id: string; def: DemoDef; openedAt: Date }[] = []
  for (const def of DEMO_DEFS) {
    const openedAt = new Date(now - def.daysAgo * DAY)
    const u = await db.user.create({
      data: {
        email: `demo-${slug}-${created.length + 1}${DEMO_DOMAIN}`,
        passwordHash: 'demo-account-no-login',
        name: def.name,
        businessName: def.business,
        industry: 'Corporate services',
        city: 'Johannesburg',
        pricingTier: 'PREMIUM_DFY',
        corporatePartner: slug,
        createdAt: openedAt,
        updatedAt: openedAt,
      },
    })
    created.push({ id: u.id, def, openedAt })
  }

  // Wallets + top-ups + the reveal ledger, with a plausible running balance.
  for (const c of created) {
    const { def } = c
    let balance = 55000 // the exact-five welcome credit every floor account opens with
    await db.wallet.create({ data: { userId: c.id, balance, updatedAt: c.openedAt } })
    await db.creditTx.create({
      data: { userId: c.id, type: 'BONUS', amount: 55000, description: DEMO_TX_MARK + ' Welcome bonus, R550 starting credit (corporate account)', balanceAfter: balance, createdAt: c.openedAt },
    })
    const topupTotal = def.topups.reduce((n, v) => n + v, 0)
    for (let i = 0; i < def.topups.length; i++) {
      const at = new Date(c.openedAt.getTime() + ((i + 1) * 6 + 2) * DAY)
      balance += def.topups[i]
      await db.topUp.create({
        data: {
          userId: c.id, packageId: 'demo-dfy-topup', amountCents: def.topups[i], creditCents: def.topups[i],
          status: 'PAID', provider: 'YOCO', reference: `DEMO-${slug.toUpperCase()}-${c.def.name.split(' ')[0]}-${i + 1}`,
          createdAt: at, paidAt: at,
        },
      })
      await db.creditTx.create({
        data: { userId: c.id, type: 'TOPUP', amount: def.topups[i], description: DEMO_TX_MARK + ' Wallet top-up (demo)', balanceAfter: balance, createdAt: at },
      })
    }
    for (let r = 0; r < def.reveals; r++) {
      const at = new Date(
        now - (def.lastRevealDaysAgo * DAY) - ((def.revealSpanDays - (r * def.revealSpanDays) / Math.max(def.reveals, 1)) * DAY)
      )
      balance -= REVEAL_CENTS
      await db.creditTx.create({
        data: { userId: c.id, type: 'LEAD_REVEAL', amount: -REVEAL_CENTS, description: DEMO_TX_MARK + ' Managed lead reveal, verified business', balanceAfter: balance, createdAt: at },
      })
    }
    if (def.emails > 0) {
      const rows = Array.from({ length: def.emails }, (_, i) => ({
        userId: c.id,
        toEmail: `procurement${i + 1}@example.co.za`,
        subject: 'Verified business introduction (managed batch)',
        body: '',
        status: 'SENT',
        provider: 'GMAIL',
        direction: 'OUT',
        createdAt: new Date(c.openedAt.getTime() + ((i * def.revealSpanDays * DAY) / Math.max(def.emails, 1) + DAY)),
      }))
      await db.emailLog.createMany({ data: rows })
    }
  }

  // Referral rows: every demo account was "introduced" by the referrer.
  const bonusCents = created.reduce((n, c) => n + c.def.reveals * 2500 + 1000, 0)
  for (const c of created) {
    await db.referral.create({
      data: {
        referrerId: referrer.id,
        invitedUserId: c.id,
        invitedEmail: `demo-${slug}-${DEMO_DEFS.indexOf(c.def) + 1}${DEMO_DOMAIN}`,
        status: 'SIGNED_UP',
        rewardCents: 1000,
        createdAt: c.openedAt,
      },
    })
  }

  // The referrer's own earnings trail, exactly the split law: R10 on each
  // join, R25 of every managed lead their introductions reveal.
  let referrerBalanceRow = await db.wallet.findUnique({ where: { userId: referrer.id } })
  if (!referrerBalanceRow) referrerBalanceRow = await db.wallet.create({ data: { userId: referrer.id, balance: 0 } })
  let rb = referrerBalanceRow.balance
  for (const c of created) {
    rb += 1000
    await db.creditTx.create({
      data: { userId: referrer.id, type: 'BONUS', amount: 1000, description: `${DEMO_TX_MARK} Referral reward, ${c.def.business} joined`, balanceAfter: rb, createdAt: c.openedAt },
    })
    for (let r = 0; r < c.def.reveals; r++) {
      const at = new Date(now - (c.def.lastRevealDaysAgo * DAY) - ((c.def.revealSpanDays - (r * c.def.revealSpanDays) / Math.max(c.def.reveals, 1)) * DAY))
      rb += 2500
      await db.creditTx.create({
        data: { userId: referrer.id, type: 'BONUS', amount: 2500, description: `${DEMO_TX_MARK} Referral reward, R25 member share on a managed lead (${c.def.business})`, balanceAfter: rb, createdAt: at },
      })
    }
  }
  await db.wallet.update({ where: { userId: referrer.id }, data: { balance: rb } })

  return NextResponse.json({
    ok: true,
    seeded: created.length,
    referrer: { name: referrer.name, email: referrer.email },
    // What Kelo's dashboard will now read: 32 reveals → R1600 share accrual,
    // the network table shows the referrer with 6 introductions, 4 activated.
    reveals: created.reduce((n, c) => n + c.def.reveals, 0),
    referrerBonusCents: bonusCents,
  })
}

async function resetDemo(slug: string) {
  const demoUsers = await db.user.findMany({ where: { email: { endsWith: DEMO_DOMAIN } }, select: { id: true } })
  const ids = demoUsers.map((u) => u.id)

  // The referrer's demo rewards: find the referrer and sum the trail FIRST —
  // the wallet restore must hit exactly that one account, nothing else.
  const firstDemoTx = await db.creditTx.findFirst({ where: { description: { startsWith: DEMO_TX_MARK } }, select: { userId: true } })
  const referrerId = firstDemoTx?.userId
  const bonus = await db.creditTx.aggregate({ where: { description: { startsWith: DEMO_TX_MARK } }, _sum: { amount: true } })

  await db.referral.deleteMany({ where: { OR: [{ invitedUserId: { in: ids } }, { referrerId: { in: ids } }] } })
  await db.creditTx.deleteMany({ where: { OR: [{ userId: { in: ids } }, { description: { startsWith: DEMO_TX_MARK } }] } })
  await db.topUp.deleteMany({ where: { userId: { in: ids } } })
  await db.emailLog.deleteMany({ where: { userId: { in: ids } } })
  await db.wallet.deleteMany({ where: { userId: { in: ids } } })
  const removed = await db.user.deleteMany({ where: { id: { in: ids } } })

  let restoredCents = 0
  if (referrerId && bonus._sum.amount) {
    restoredCents = bonus._sum.amount
    // Restore the referrer's wallet to what it was before the demo.
    await db.wallet.update({ where: { userId: referrerId }, data: { balance: { decrement: restoredCents } } })
    // Never leave a negative balance behind, whatever the ledger said.
    await db.wallet.updateMany({ where: { userId: referrerId, balance: { lt: 0 } }, data: { balance: 0 } })
  }

  return NextResponse.json({ ok: true, removed: removed.count, restoredCents })
}
