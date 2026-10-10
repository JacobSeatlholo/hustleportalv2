/**
 * Seed a rich demo account for HustlePortal so the product can be explored
 * end-to-end: leads pipeline, team + shared tasks, clients, finance,
 * wallet credits + top-up history, XP.
 *
 * Run: bun scripts/seed_demo.ts
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

const OWNER_EMAIL = 'demo@hustleportal.co.za'
const TEAM_EMAIL = 'team@hustleportal.co.za'
const PASSWORD = 'Hustle123!'

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10)

  // ---------- owner (ADMIN) ----------
  const owner = await db.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { passwordHash: hash, role: 'ADMIN', xp: 340 },
    create: {
      email: OWNER_EMAIL,
      passwordHash: hash,
      name: 'Demo Hustler',
      businessName: 'Hustle Prints & Branding',
      industry: 'Printing & Branding',
      city: 'Johannesburg',
      phone: '082 555 0101',
      role: 'ADMIN',
      xp: 340,
    },
  })

  // ---------- teammate (MEMBER) ----------
  const mate = await db.user.upsert({
    where: { email: TEAM_EMAIL },
    update: { passwordHash: hash },
    create: {
      email: TEAM_EMAIL,
      passwordHash: hash,
      name: 'Thabo Mokoena',
      businessName: 'Hustle Prints & Branding',
      industry: 'Printing & Branding',
      city: 'Soweto',
      role: 'MEMBER',
      xp: 120,
    },
  })

  // ---------- team ----------
  let team = await db.team.findFirst({ where: { ownerId: owner.id } })
  if (!team) {
    team = await db.team.create({ data: { name: 'Hustle Crew', ownerId: owner.id } })
  }
  await db.teamMember.upsert({
    where: { teamId_userId: { teamId: team.id, userId: mate.id } },
    update: {},
    create: { teamId: team.id, userId: mate.id, role: 'MEMBER' },
  })
  await db.teamMember.upsert({
    where: { teamId_userId: { teamId: team.id, userId: owner.id } },
    update: {},
    create: { teamId: team.id, userId: owner.id, role: 'OWNER' },
  })

  // ---------- wallet + credit ledger ----------
  const wallet = await db.wallet.upsert({
    where: { userId: owner.id },
    update: { balance: 75000 },
    create: { userId: owner.id, balance: 75000 },
  })
  await db.creditTx.deleteMany({ where: { userId: owner.id } })
  const ledger: Array<[string, number, string, number]> = [
    // [type, amount, description, balanceAfter]
    ['BONUS', 4500, 'Welcome bonus — 3 free lead reveals', 4500],
    ['TOPUP', 50000, 'Wallet top-up — R500 (Starter)', 54500],
    ['LEAD_REVEAL', -1500, 'Contact unlocked — Siyabonga Logistics', 53000],
    ['LEAD_REVEAL', -1500, 'Contact unlocked — Katlehong Autospare', 51500],
    ['LEAD_REVEAL', -1500, 'Contact unlocked — Midrand Events Co', 50000],
    ['BONUS', 25000, 'Referral bonus — Hustle Points reward', 75000],
  ]
  let i = 6
  for (const [type, amount, description, balanceAfter] of ledger) {
    await db.creditTx.create({
      data: { userId: owner.id, type, amount, description, balanceAfter, createdAt: daysAgo(i--) },
    })
  }

  // ---------- leads pipeline ----------
  await db.lead.deleteMany({ where: { userId: owner.id } })
  const leads: Array<{
    company: string
    contactName?: string
    email?: string
    phone?: string
    website?: string
    industry?: string
    city?: string
    source: string
    stage: string
    value: number
    unlocked: boolean
    score?: number
    externalId?: string
    notes?: string
    ageDays: number
  }> = [
    { company: 'Siyabonga Logistics', contactName: 'Sipho Ndlovu', email: 'sipho@siyabongalog.co.za', phone: '083 555 0142', website: 'siyabongalog.co.za', industry: 'Transport & Logistics', city: 'Durban', source: 'EXPLEE', stage: 'WON', value: 24000, unlocked: true, score: 92, externalId: 'expl_co_9f21', notes: 'Signed for fleet branding + 500 caps.', ageDays: 21 },
    { company: 'Katlehong Autospare', contactName: 'Lerato Dlamini', email: 'lerato@katautospare.co.za', phone: '084 555 0198', industry: 'Auto Parts', city: 'Katlehong', source: 'EXPLEE', stage: 'QUOTE_SENT', value: 8500, unlocked: true, score: 81, externalId: 'expl_co_7c04', notes: 'Quote sent for shop signage, follow up Friday.', ageDays: 12 },
    { company: 'Midrand Events Co', contactName: 'Naledi Khumalo', email: 'naledi@midrandevents.co.za', phone: '081 555 0177', industry: 'Events', city: 'Midrand', source: 'EXPLEE', stage: 'QUALIFIED', value: 15000, unlocked: true, score: 76, externalId: 'expl_co_3a88', notes: 'Needs 2 000 lanyards for conference.', ageDays: 9 },
    { company: 'Bra Nkosi Shisanyama', industry: 'Restaurant', city: 'Soweto', source: 'CSV', stage: 'CONTACTED', value: 4200, unlocked: false, score: 64, notes: 'Imported from marketplace list. Menu boards + aprons.', ageDays: 7 },
    { company: 'Pretoria Mobile Repair', industry: 'Electronics', city: 'Pretoria', source: 'CSV', stage: 'CONTACTED', value: 3000, unlocked: false, score: 58, notes: 'Store cards for 3 branches.', ageDays: 6 },
    { company: 'Umlazi Bakery', contactName: 'Zanele Gumede', industry: 'Food', city: 'Umlazi', source: 'MANUAL', stage: 'NEW', value: 5500, unlocked: false, notes: 'Packaging stickers + delivery bike branding.', ageDays: 4 },
    { company: 'Fourways Fitness Studio', industry: 'Fitness', city: 'Sandton', source: 'EXPLEE', stage: 'NEW', value: 12000, unlocked: false, score: 71, externalId: 'expl_co_5d12', notes: 'Membership cards and towel embroidery.', ageDays: 3 },
    { company: 'Vaal Strike Supplies', industry: 'Mining Services', city: 'Vanderbijlpark', source: 'MANUAL', stage: 'NEW', value: 30000, unlocked: false, notes: 'Big order potential — PPE branding.', ageDays: 2 },
    { company: 'Alex Tech Repairs', industry: 'Electronics', city: 'Johannesburg', source: 'MANUAL', stage: 'LOST', value: 1800, unlocked: false, notes: 'Went with a cheaper supplier. Revisit in 3 months.', ageDays: 30 },
    { company: 'Benoni Flower Studio', contactName: 'Charmaine Botha', industry: 'Retail', city: 'Benoni', source: 'MANUAL', stage: 'WON', value: 6500, unlocked: true, notes: 'Monthly delivery van magnets.', ageDays: 25 },
  ]
  for (const l of leads) {
    await db.lead.create({
      data: {
        userId: owner.id,
        teamId: team.id,
        company: l.company,
        contactName: l.contactName ?? null,
        email: l.unlocked ? (l.email ?? null) : null,
        phone: l.unlocked ? (l.phone ?? null) : null,
        website: l.website ?? null,
        industry: l.industry ?? null,
        city: l.city ?? null,
        country: 'South Africa',
        source: l.source as any,
        stage: l.stage as any,
        value: l.value,
        notes: l.notes ?? null,
        unlocked: l.unlocked,
        score: l.score ?? null,
        externalId: l.externalId ?? null,
        createdAt: daysAgo(l.ageDays),
        updatedAt: daysAgo(Math.max(0, l.ageDays - 1)),
      },
    })
  }

  // ---------- clients ----------
  await db.client.deleteMany({ where: { userId: owner.id } })
  const clients = [
    { name: 'Sipho Ndlovu', company: 'Siyabonga Logistics', email: 'sipho@siyabongalog.co.za', phone: '083 555 0142', monthlyValue: 8000, notes: 'Fleet branding retainer. Pays on the 1st.' },
    { name: 'Charmaine Botha', company: 'Benoni Flower Studio', email: 'charmaine@benoniflowers.co.za', phone: '082 555 0173', monthlyValue: 1500, notes: 'Van magnets refresh every quarter.' },
    { name: 'Wandile Peters', company: 'Wandi Coffee Roasters', email: 'wandile@wandicoffee.co.za', phone: '079 555 0166', monthlyValue: 3200, notes: 'Cup sleeves + shop menu. Loves quick turnarounds.' },
  ]
  for (const c of clients) {
    await db.client.create({ data: { userId: owner.id, ...c } })
  }

  // ---------- tasks (personal + team shared) ----------
  await db.task.deleteMany({ where: { creatorId: { in: [owner.id, mate.id] } } })
  const tasks = [
    { title: 'Send fleet branding invoice to Siyabonga Logistics', status: 'IN_PROGRESS', priority: 'HIGH', team: true, assignee: 'me', due: 1 },
    { title: 'Follow up on Katlehong Autospare signage quote', status: 'TODO', priority: 'HIGH', team: true, assignee: null, due: 2 },
    { title: 'Order vinyl stock for shisanyama menu boards', status: 'TODO', priority: 'MEDIUM', team: false, assignee: null, due: 4 },
    { title: 'Design 2 000 lanyard mockup for Midrand Events', status: 'IN_PROGRESS', priority: 'MEDIUM', team: true, assignee: 'mate', due: 3 },
    { title: 'Post before/after photos of Benoni van magnets', status: 'DONE', priority: 'LOW', team: false, assignee: null, due: null },
    { title: 'Reconcile October income vs expenses', status: 'TODO', priority: 'LOW', team: false, assignee: null, due: 6 },
  ]
  for (const t of tasks) {
    await db.task.create({
      data: {
        title: t.title,
        status: t.status as any,
        priority: t.priority as any,
        isPrivate: !t.team,
        teamId: t.team ? team.id : null,
        creatorId: owner.id,
        assigneeId: t.assignee === 'me' ? owner.id : t.assignee === 'mate' ? mate.id : null,
        dueDate: t.due ? daysAgo(-t.due) : null,
      },
    })
  }
  await db.task.create({
    data: {
      title: 'Book team photoshoot for new business cards',
      status: 'TODO',
      priority: 'MEDIUM',
      isPrivate: false,
      teamId: team.id,
      creatorId: mate.id,
      assigneeId: owner.id,
      dueDate: daysAgo(-5),
    },
  })

  // ---------- finance ----------
  await db.financeEntry.deleteMany({ where: { userId: owner.id } })
  const finance: Array<[string, string, string, number, number]> = [
    // [type, description, category, amount, daysAgo]
    ['INCOME', 'Fleet branding — Siyabonga Logistics', 'Branding', 24000, 20],
    ['INCOME', 'Van magnets — Benoni Flower Studio', 'Branding', 6500, 18],
    ['INCOME', 'Coffee sleeves — Wandi Coffee Roasters', 'Printing', 3200, 12],
    ['INCOME', 'Deposit — Midrand Events lanyards', 'Printing', 5000, 5],
    ['EXPENSE', 'Vinyl roll stock (10 rolls)', 'Materials', 4300, 15],
    ['EXPENSE', 'Delivery fuel', 'Transport', 950, 10],
    ['EXPENSE', 'Printing machine ink', 'Materials', 2100, 8],
    ['EXPENSE', 'Data & airtime', 'Admin', 450, 3],
  ]
  for (const [type, description, category, amount, d] of finance) {
    await db.financeEntry.create({
      data: { userId: owner.id, type: type as any, description, category, amount, occurredAt: daysAgo(d) },
    })
  }

  // ---------- xp events ----------
  await db.xpEvent.deleteMany({ where: { userId: owner.id } })
  const xp: Array<[string, number, string, number]> = [
    ['SIGNUP', 50, 'Joined HustlePortal', 30],
    ['LEAD_ADDED', 10, 'Lead added — Vaal Strike Supplies', 8],
    ['LEAD_REVEALED', 25, 'Unlocked 3 contacts', 7],
    ['TASK_DONE', 15, 'Completed daily tasks', 4],
    ['DAILY_LOGIN', 5, 'Daily login streak', 1],
    ['AI_PLAN', 30, 'Generated an AI business plan', 2],
  ]
  for (const [type, amount, description, d] of xp) {
    await db.xpEvent.create({
      data: { userId: owner.id, type, amount, description, createdAt: daysAgo(d) },
    })
  }

  console.log('Seed complete.')
  console.log('Owner :', OWNER_EMAIL, '/', PASSWORD, '(ADMIN)')
  console.log('Teammate:', TEAM_EMAIL, '/', PASSWORD, '(MEMBER)')
  console.log('Wallet balance:', wallet.balance, 'cents (R' + (wallet.balance / 100).toFixed(2) + ')')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
