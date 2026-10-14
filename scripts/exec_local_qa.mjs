// Executive Dashboard local QA — full positive path against a local dev server
// running on the seeded SQLite DB. Run: DATABASE_URL="file:/home/z/my-project/db/custom.db" node scripts/exec_local_qa.mjs
import { PrismaClient } from '@prisma/client'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}${extra ? ` :: ${extra}` : ''}`) }
  else { failed++; console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`) }
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    let json = null
    try { json = await res.json() } catch { /* empty */ }
    const setCookie = res.headers.get('set-cookie')
    return { status: res.status, json, setCookie }
  } finally { clearTimeout(t) }
}

function cookieOf(res) {
  const raw = res.setCookie || ''
  return raw.split(';')[0] || null
}

async function register(name, business, city) {
  const email = `${name}_${Date.now()}@hustleqa.local`.toLowerCase().replace(/\s+/g, '')
  const res = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'hustle123', name, businessName: business, city, industry: 'Retail' } })
  if (res.status !== 200) throw new Error(`register failed for ${email}: ${res.status} ${JSON.stringify(res.json)}`)
  return { email, cookie: cookieOf(res) }
}
async function login(email, password = 'hustle123') {
  return call('/api/auth', { method: 'POST', body: { action: 'login', email, password } })
}

async function main() {
  console.log('== Executive Dashboard local QA ==')

  // 1. Clean slate for QA emails, then register the master account with the exact exec email
  const ceoEmail = `ceo@businesshustle.co.za`
  await db.user.deleteMany({ where: { email: { contains: '@hustleqa.local' } } })
  await db.user.deleteMany({ where: { email: ceoEmail } })
  const ceoRes = await call('/api/auth', { method: 'POST', body: { action: 'register', email: ceoEmail, password: 'hustle123', name: 'Business Owner', businessName: 'Business Hustle', city: 'Johannesburg' } })
  check('CEO registers with exact exec email', ceoRes.status === 200, `status ${ceoRes.status}`)
  let ceoCookie = cookieOf(ceoRes)

  // 2. Self-heal on register: role ADMIN + platformAdmin true
  const me1 = await call('/api/auth/me', { cookie: ceoCookie })
  check('me returns ADMIN role after register (self-heal)', me1.json?.user?.role === 'ADMIN', `role=${me1.json?.user?.role}`)

  // Self-heal on login too: demote then login
  await db.user.update({ where: { email: ceoEmail }, data: { role: 'MEMBER', platformAdmin: false } })
  const ceoLogin = await login(ceoEmail)
  check('CEO login 200', ceoLogin.status === 200)
  ceoCookie = cookieOf(ceoLogin)
  const me2 = await call('/api/auth/me', { cookie: ceoCookie })
  check('self-heal on login restores ADMIN', me2.json?.user?.role === 'ADMIN', `role=${me2.json?.user?.role}`)
  const ceoId = me2.json.user.id

  // 3. Register 3 clients
  const a = await register('Ayanda Dlamini', 'Ayanda Fresh Produce', 'Soweto')
  const b = await register('Bongani Khumalo', 'Khumalo Brands', 'Johannesburg')
  const c = await register('Nomsa Mthembu', 'Mamas Kitchen SA', 'Pretoria')
  // create their default workspaces (auth/me does that)
  for (const x of [a, b, c]) await call('/api/auth/me', { cookie: x.cookie })
  const [aUser, cUser] = await Promise.all([
    db.user.findUnique({ where: { email: a.email } }),
    db.user.findUnique({ where: { email: c.email } }),
  ])

  // 4. Seed subscription + payments for client A (direct DB = deterministic)
  const now = Date.now()
  await db.subscription.upsert({
    where: { userId: aUser.id },
    update: {},
    create: {
      userId: aUser.id, plan: 'HUSTLER', status: 'ACTIVE', billingCycle: 'MONTHLY',
      amountCents: 19900, provider: 'YOCO', reference: 'HPSUB-QA-1',
      startedAt: new Date(now - 5 * 86400000), renewsAt: new Date(now + 30 * 86400000),
    },
  })
  await db.topUp.create({ data: { userId: aUser.id, packageId: 'starter', amountCents: 15000, creditCents: 15000, status: 'PAID', provider: 'YOCO', reference: 'HPTOP-QA-1', providerRef: 'pay_qa_1', createdAt: new Date(now - 3 * 86400000), paidAt: new Date(now - 3 * 86400000) } })
  await db.topUp.create({ data: { userId: aUser.id, packageId: 'growth', amountCents: 45000, creditCents: 50000, status: 'PENDING', provider: 'YOCO', reference: 'HPTOP-QA-2', createdAt: new Date(now - 1 * 86400000) } })

  // 5. Exec feed asserts
  const exec1 = await call('/api/admin/exec', { cookie: ceoCookie })
  check('GET /api/admin/exec 200 for exec', exec1.status === 200, `status ${exec1.status}`)
  const k = exec1.json?.kpis
  check('KPI members = 4', k?.members === 4, `members=${k?.members}`)
  check('KPI new7 = 4', k?.new7 === 4, `new7=${k?.new7}`)
  check('KPI subscribers = 1', k?.subscribers === 1, `subscribers=${k?.subscribers}`)
  check('KPI MRR = 19900', k?.mrrCents === 19900, `mrr=${k?.mrrCents}`)
  check('KPI topups30d = 15000 (only PAID counts)', k?.topups30dCents === 15000, `topups=${k?.topups30dCents}`)
  const rosterA = exec1.json?.roster?.find((r) => r.email === a.email)
  const rosterCeo = exec1.json?.roster?.find((r) => r.email === ceoEmail)
  check('roster: client A paying HUSTLER', rosterA?.subStatus === 'ACTIVE' && rosterA?.plan === 'HUSTLER', JSON.stringify({ s: rosterA?.subStatus, p: rosterA?.plan }))
  check('roster: CEO flagged isAdmin', rosterCeo?.isAdmin === true)
  check('roster: everyone accountStatus ACTIVE', exec1.json.roster.every((r) => r.accountStatus === 'ACTIVE'))

  // 6. Detail for client A
  const detA = await call(`/api/admin/exec/client/${aUser.id}`, { cookie: ceoCookie })
  check('detail 200 for client A', detA.status === 200)
  check('detail: 2 topups (PAID + PENDING)', detA.json?.payments?.topups?.length === 2, `n=${detA.json?.payments?.topups?.length}`)
  check('detail: credit ledger has welcome bonus', (detA.json?.payments?.creditTxs?.length ?? 0) >= 1)
  check('detail: plan block present', detA.json?.client?.subscription?.plan === 'HUSTLER')
  check('detail: default workspace listed', (detA.json?.projects?.length ?? 0) >= 1)

  // 7. Pause client B -> lockout -> restore
  const bUser = await db.user.findUnique({ where: { email: b.email } })
  const bLoginPre = await login(b.email)
  const bCookie = cookieOf(bLoginPre)
  const pause = await call(`/api/admin/exec/client/${bUser.id}`, { method: 'PATCH', cookie: ceoCookie, body: { status: 'SUSPENDED', reason: 'QA pause' } })
  check('PATCH suspend 200', pause.status === 200, JSON.stringify(pause.json))
  const bMeSuspended = await call('/api/auth/me', { cookie: bCookie })
  check('suspended session: me -> 401 (locked out everywhere)', bMeSuspended.status === 401, `status ${bMeSuspended.status}`)
  const bLoginBlocked = await login(b.email)
  check('suspended login -> 403 with friendly copy', bLoginBlocked.status === 403 && /paused/i.test(bLoginBlocked.json?.error || ''), (bLoginBlocked.json?.error || '').slice(0, 60))
  const execWhileSuspended = await call('/api/admin/exec', { cookie: ceoCookie })
  check('KPI suspended = 1 while paused', execWhileSuspended.json?.kpis?.suspended === 1)
  const restore = await call(`/api/admin/exec/client/${bUser.id}`, { method: 'PATCH', cookie: ceoCookie, body: { status: 'ACTIVE' } })
  check('PATCH restore 200', restore.status === 200)
  const bLoginAfter = await login(b.email)
  check('restored login -> 200', bLoginAfter.status === 200)

  // 8. Manual lead injection (single + bulk) into client C
  const leads1 = await call(`/api/admin/exec/client/${cUser.id}/leads`, {
    method: 'POST', cookie: ceoCookie,
    body: {
      source: 'EXPLEE',
      leads: [
        { company: 'Thabo Plumbers', contactName: 'Thabo N.', role: 'Owner', phone: '082 555 1234', email: 'thabo@example.co.za', city: 'Soweto' },
        { company: "Mama's Kitchen", city: 'Johannesburg' },
      ],
    },
  })
  check('inject 2 leads -> created 2', leads1.json?.created === 2, JSON.stringify(leads1.json))
  const leads2 = await call(`/api/admin/exec/client/${cUser.id}/leads`, {
    method: 'POST', cookie: ceoCookie,
    body: {
      source: 'EXPLEE',
      leads: [
        { company: 'thabo plumbers', city: 'Soweto' },
        { company: 'Thabo Plumbers', city: 'Soweto' },
        { company: 'Sipho Auto Repairs', city: 'Soweto' },
      ],
    },
  })
  check('dedup: same company skipped, new one created (1/2)', leads2.json?.created === 1 && leads2.json?.skipped === 2, JSON.stringify(leads2.json))
  const cLogin = await login(c.email)
  const cLeads = await call('/api/leads', { cookie: cookieOf(cLogin) })
  const cL = cLeads.json?.leads ?? []
  check('client C sees 3 leads in their pipeline', cL.length === 3, `n=${cL.length}`)
  check('injected leads tagged EXPLEE stage NEW with project', cL.every((l) => l.source === 'EXPLEE' && l.stage === 'NEW' && !!l.projectId))

  // 9. Detail pipeline shape for client C
  const detC = await call(`/api/admin/exec/client/${cUser.id}`, { cookie: ceoCookie })
  check('detail: client C pipeline stages NEW=3', detC.json?.pipeline?.stages?.NEW === 3, JSON.stringify(detC.json?.pipeline?.stages))

  // 10. Guard rails: exec account cannot be paused
  const pauseCeo = await call(`/api/admin/exec/client/${ceoId}`, { method: 'PATCH', cookie: ceoCookie, body: { status: 'SUSPENDED' } })
  check('exec account pause -> 400', pauseCeo.status === 400, `status ${pauseCeo.status}`)

  // 11. Negative: non-admin session gets 403 on the whole surface
  const outsider = await register('Out Sider', 'Nope Inc', 'Durban')
  const n1 = await call('/api/admin/exec', { cookie: outsider.cookie })
  const n2 = await call(`/api/admin/exec/client/${aUser.id}`, { cookie: outsider.cookie })
  const n3 = await call(`/api/admin/exec/client/${aUser.id}`, { method: 'PATCH', cookie: outsider.cookie, body: { status: 'SUSPENDED' } })
  const n4 = await call(`/api/admin/exec/client/${aUser.id}/leads`, { method: 'POST', cookie: outsider.cookie, body: { leads: [{ company: 'X' }] } })
  check('non-admin exec feed -> 403', n1.status === 403, `status ${n1.status}`)
  check('non-admin detail -> 403', n2.status === 403)
  check('non-admin suspend -> 403', n3.status === 403)
  check('non-admin inject -> 403', n4.status === 403)

  // 12. Unauthed
  const u1 = await call('/api/admin/exec')
  check('unauthed exec feed -> 401', u1.status === 401)

  console.log(`\nRESULT: ${passed}/${passed + failed} PASS${failed ? ` (${failed} FAIL)` : ''}`)
}

main()
  .catch((e) => { console.error('QA_CRASH', e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
