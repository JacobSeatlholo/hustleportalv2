// Exec lead pool + credit story local QA — full positive path against a local dev server
// on the embedded Postgres DB. Run: DATABASE_URL="postgresql://postgres@127.0.0.1:54329/hustleportal" node scripts/exec_pool_local_qa.mjs
// Covers: topup → exec notification stamp → auto campaign → bench → add/addAll/dismiss → dedup → walls → deep fields.
import { PrismaClient } from '@prisma/client'

const BASE = 'http://127.0.0.1:3000'
const db = new PrismaClient()

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}${extra ? ` :: ${extra}` : ''}`) }
  else { failed++; console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`) }
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 45000)
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function register(name, business, city, industry = 'Retail') {
  const email = `${name.split(' ')[0].toLowerCase()}_${Date.now()}@hustleqa.local`.replace(/\s+/g, '')
  const res = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'hustle123', name, businessName: business, city, industry } })
  if (res.status !== 200) throw new Error(`register failed for ${email}: ${res.status} ${JSON.stringify(res.json)}`)
  const cookie = cookieOf(res)
  await call('/api/auth/me', { cookie }) // creates the default workspace
  const me = await call('/api/auth/me', { cookie })
  return { email, cookie, id: me.json?.user?.id }
}

async function main() {
  console.log('== Exec lead pool local QA ==')

  // 0. Clean slate
  await db.user.deleteMany({ where: { email: { contains: '@hustleqa.local' } } })
  await db.user.deleteMany({ where: { email: 'ceo@businesshustle.co.za' } })
  await db.leadPool.deleteMany({ where: { company: { startsWith: 'QAPool' } } })
  await db.clientPoolLead.deleteMany({})

  // 1. CEO master account self-heals to exec
  const ceoRes = await call('/api/auth', { method: 'POST', body: { action: 'register', email: 'ceo@businesshustle.co.za', password: 'hustle123', name: 'Business Owner', businessName: 'Business Hustle', city: 'Johannesburg' } })
  check('CEO registers with exact exec email', ceoRes.status === 200)
  const ceoCookie = cookieOf(ceoRes)
  const ceoMe = await call('/api/auth/me', { cookie: ceoCookie })
  check('CEO self-heal on register (ADMIN)', ceoMe.json?.user?.role === 'ADMIN', `role=${ceoMe.json?.user?.role}`)
  const ceoId = ceoMe.json?.user?.id

  // 2. Client A: profile + project so the campaign brief has words to work with
  const a = await register('Ayanda Dlamini', 'Ayanda Beauty Bar', 'Soweto', 'Beauty')
  await db.project.updateMany({
    where: { userId: a.id },
    data: { targetMarket: 'Women 18 to 35 who love braids', offerings: 'Braids, nails and beauty treatments', valueProp: 'Walk in plain, walk out unforgettable' },
  })

  // 3. First manual campaign: pool is empty → honest zero, but the topicFp comes back
  const run1 = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'POST', body: {}, cookie: ceoCookie })
  check('campaign POST 200 (exec)', run1.status === 200, `status ${run1.status}`)
  check('campaign names its mode', ['EXPLEE', 'POOL'].includes(run1.json?.mode), `mode=${run1.json?.mode}`)
  check('campaign returns topicFp', typeof run1.json?.topicFp === 'string' && run1.json.topicFp.length >= 10)
  const topicFp = run1.json.topicFp

  // 4. Seed the shared verified pool with fresh faces + link them to this topic
  const faces = [
    { company: 'QAPool Beauty Den', city: 'Soweto', phone: '082 555 1001', industry: 'Beauty' },
    { company: 'QAPool Nail Studio', city: 'Soweto', phone: '082 555 1002', industry: 'Beauty' },
    { company: 'QAPool Braid House', city: 'Soweto', phone: '082 555 1003', industry: 'Beauty' },
  ]
  for (const f of faces) {
    const row = await db.leadPool.create({
      data: { fingerprint: `${f.company.toLowerCase()}|${f.city.toLowerCase()}`, company: f.company, city: f.city, phone: f.phone, industry: f.industry, source: 'OSM', verifyState: 'active', lastSeenAt: new Date() },
    })
    await db.leadPoolHit.create({ data: { topicFp, poolId: row.id } })
  }
  const run2 = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'POST', body: {}, cookie: ceoCookie })
  check('second campaign serves the pool', run2.json?.mode === 'POOL' && run2.json?.served === 3, `mode=${run2.json?.mode} served=${run2.json?.served}`)
  check('bench received 3 new faces', run2.json?.added === 3, `added=${run2.json?.added}`)

  // 5. Detail carries the pool section
  const detail = await call(`/api/admin/exec/client/${a.id}`, { cookie: ceoCookie })
  check('detail exposes pool counts', detail.json?.pool?.counts?.NEW === 3, JSON.stringify(detail.json?.pool?.counts))
  check('detail carries campaign history', Array.isArray(detail.json?.pool?.campaigns) && detail.json.pool.campaigns.length >= 2)

  // 6. Overview KPIs + roster pool badge
  const exec = await call('/api/admin/exec', { cookie: ceoCookie })
  const aRow = exec.json?.roster?.find((r) => r.id === a.id)
  check('overview KPIs include poolNew', typeof exec.json?.kpis?.poolNew === 'number')
  check('roster row shows pooled count', aRow?.poolCount === 3, `poolCount=${aRow?.poolCount}`)

  // 7. Add two faces to the client's pipeline
  const rows = detail.json.pool.rows.filter((r) => r.status === 'NEW')
  const addRes = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'PATCH', body: { action: 'add', ids: rows.slice(0, 2).map((r) => r.id) }, cookie: ceoCookie })
  check('add two to their pipeline', addRes.json?.added === 2, JSON.stringify(addRes.json))
  const leadsAfterAdd = await db.lead.findMany({ where: { userId: a.id } })
  check('client pipeline has 2 EXPLEE era leads', leadsAfterAdd.length === 2 && leadsAfterAdd.every((l) => l.source === 'POOL' && l.stage === 'NEW'), `n=${leadsAfterAdd.length}`)
  const addedPoolRows = await db.clientPoolLead.findMany({ where: { userId: a.id, status: 'ADDED' } })
  check('bench rows stamped ADDED with leadId', addedPoolRows.length === 2 && addedPoolRows.every((r) => r.leadId))

  // 8. Third campaign: the two added companies are excluded by their pipeline
  // (serveFromPool never serves saved companies), the waiting face refreshes in place.
  const run3 = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'POST', body: {}, cookie: ceoCookie })
  check('rerun adds nothing new', run3.json?.added === 0, `added=${run3.json?.added}`)
  check('rerun refreshes the waiting face', run3.json?.refreshed >= 1, `refreshed=${run3.json?.refreshed}`)

  // 9. addAll takes the last waiting face
  const addAll = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'PATCH', body: { action: 'addAll' }, cookie: ceoCookie })
  check('addAll empties the bench', addAll.json?.added === 1, JSON.stringify(addAll.json?.message))
  const leadsFinal = await db.lead.count({ where: { userId: a.id } })
  check('client pipeline now 3', leadsFinal === 3, `n=${leadsFinal}`)

  // 10. Dismiss path (a fresh waiting row, then set it aside)
  const f4 = await db.leadPool.create({ data: { fingerprint: 'qapool extras|soweto', company: 'QAPool Extras', city: 'Soweto', source: 'OSM', verifyState: 'active', lastSeenAt: new Date() } })
  await db.leadPoolHit.create({ data: { topicFp, poolId: f4.id } })
  const run4 = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'POST', body: {}, cookie: ceoCookie })
  check('fresh face lands on the bench', run4.json?.added === 1, `added=${run4.json?.added}`)
  const waitingRow = await db.clientPoolLead.findFirst({ where: { userId: a.id, status: 'NEW' } })
  const dismiss = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'PATCH', body: { action: 'dismiss', ids: [waitingRow.id] }, cookie: ceoCookie })
  check('dismiss sets the row aside', dismiss.json?.dismissed === 1, JSON.stringify(dismiss.json))

  // 11. The money story: client A loads credit → exec email + auto campaign.
  // Clear recent campaign runs first so the auto guard has nothing to trip on.
  await db.scanRun.deleteMany({ where: { userId: a.id } })
  const topUp = await call('/api/wallet/topup', { method: 'POST', body: { packageId: 'starter' }, cookie: a.cookie })
  check('client loads R500 credit (sandbox)', topUp.status === 200 && topUp.json?.sandbox === true, `status ${topUp.status}`)
  const walletAfter = await db.wallet.findUnique({ where: { userId: a.id } })
  check('wallet credited', walletAfter?.balance >= 50000, `balance=${walletAfter?.balance}`)
  await sleep(6000) // after() runs the notify + campaign post response
  const lastSend = await db.platformConfig.findUnique({ where: { key: 'MAIL_LAST_SYSTEM_SEND' } })
  const send = lastSend ? JSON.parse(lastSend.value) : null
  check('exec credit email addressed to the owner', Boolean(send && send.to === 'ceo@businesshustle.co.za'), send ? `subject="${(send.subject || '').slice(0, 60)}" ok=${send.ok}` : 'no stamp')
  check('credit email names the client', Boolean(send && send.subject && send.subject.includes('Ayanda')), send?.subject || '')
  const autoScan = await db.scanRun.findFirst({ where: { userId: a.id, mode: 'CAMPAIGN', createdAt: { gte: new Date(Date.now() - 60_000) } }, orderBy: { createdAt: 'desc' } })
  check('auto campaign ran on the paid topup', Boolean(autoScan), autoScan ? `mode=${autoScan.mode} leads=${autoScan.leadCount}` : 'none')
  // The campaign must never eat the client's own scan allowance: the newest
  // non campaign run has to be old enough that the 12s cooldown stays clear.
  const lastOwnScan = await db.scanRun.findFirst({ where: { userId: a.id, mode: { not: 'CAMPAIGN' } }, orderBy: { createdAt: 'desc' } })
  check('campaign does not block their own scans', !lastOwnScan || Date.now() - lastOwnScan.createdAt.getTime() > 12_000, lastOwnScan ? `age=${Math.round((Date.now() - lastOwnScan.createdAt.getTime()) / 1000)}s` : 'no own scans')

  // 12. Walls: unauth 401, non-exec 403, bad action 400
  const unauth = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'POST', body: {} })
  check('pool POST unauth 401', unauth.status === 401)
  const b = await register('Bongani Khumalo', 'Khumalo Brands', 'Johannesburg')
  const forbidden1 = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'POST', body: {}, cookie: b.cookie })
  const forbidden2 = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'PATCH', body: { action: 'addAll' }, cookie: b.cookie })
  check('pool POST non-exec 403', forbidden1.status === 403)
  check('pool PATCH non-exec 403', forbidden2.status === 403)
  const badAction = await call(`/api/admin/exec/client/${a.id}/pool`, { method: 'PATCH', body: { action: 'nope' }, cookie: ceoCookie })
  check('bad action 400', badAction.status === 400)

  // 13. Owner topups stay quiet (no self notification)
  await db.platformConfig.deleteMany({ where: { key: 'MAIL_LAST_SYSTEM_SEND' } })
  const ceoTopUp = await call('/api/wallet/topup', { method: 'POST', body: { packageId: 'starter' }, cookie: ceoCookie })
  check('CEO own topup works', ceoTopUp.status === 200)
  await sleep(4000)
  const ceoSend = await db.platformConfig.findUnique({ where: { key: 'MAIL_LAST_SYSTEM_SEND' } })
  const ceoStamp = ceoSend ? JSON.parse(ceoSend.value) : null
  check('no self notification for the owner', !ceoStamp || ceoStamp.to !== 'ceo@businesshustle.co.za', ceoStamp ? `last to=${ceoStamp.to}` : 'no stamp (quiet, correct)')

  console.log(`\nRESULT: ${passed}/${passed + failed} PASS`)
  process.exitCode = failed === 0 ? 0 : 1
}

main()
  .catch((e) => { console.error('QA crashed:', e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
