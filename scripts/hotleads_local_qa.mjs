// Hot leads exec card local QA — a mock Explee speaks the real OpenAPI shapes,
// the real route runs on the embedded Postgres dev server. Covers: walls (401/403),
// honest NONE without a key, live mapping (campaign join, why hot, email fallback),
// the 60s class cache, and the fresh error branch when Explee rejects the key.
//
// Run order:
//   1) bash scripts/bootstrap_db.sh && node scripts/db_admin.mjs createdb
//   2) DATABASE_URL="postgresql://postgres@127.0.0.1:54329/hustleportal" \
//        EXPLEE_BASE="http://127.0.0.1:9911" EXEC_HOTLEADS_TTL_MS=1200 npx next dev -p 3100
//   3) node scripts/hotleads_local_qa.mjs
import http from 'node:http'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.HP_BASE || 'http://127.0.0.1:3100'
const MOCK_PORT = 9911
const MOCK_KEY = 'extest_key_123456'
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
  return (res.setCookie || '').split(';')[0] || null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function register(name, business, forceEmail) {
  const email = forceEmail || `${name.split(' ')[0].toLowerCase()}_${Date.now()}_${Math.floor(Math.random() * 9999)}@hustleqa.local`.replace(/\s+/g, '')
  const res = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'hustle123', name, businessName: business, city: 'Johannesburg' } })
  if (res.status !== 200) throw new Error(`register failed for ${email}: ${res.status} ${JSON.stringify(res.json)}`)
  return { email, cookie: cookieOf(res) }
}

// ---- Mock Explee: exactly the OpenAPI contract shapes ----
let failHotLeads = false
const hotPayload = {
  leads: [
    {
      person_id: '1c0371a7-0535-4bf4-904c-57c9d8c5138d',
      campaign_id: 101,
      name: 'Ghian du Toit',
      email: 'ghian@fruitly.co.za',
      job_title: 'Owner',
      company_name: 'FruitFly Africa',
      company_domain: 'fruitfly.co.za',
      phone: '+27 82 000 0000',
      country: 'ZA',
      note: null,
      why_hot: 'Asked for the free sample and shared their farm volume numbers.',
      became_hot_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
    },
    {
      person_id: 'b22c9f10-2222-3333-4444-555566667777',
      campaign_id: 101,
      name: null,
      email: 'jonny.ishak@dackskiftarna.se',
      why_hot: 'Wants pricing for two crews before month end.',
      became_hot_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
    },
    {
      person_id: 'c3d4e5f6-aaaa-bbbb-cccc-ddddeeeeffff',
      campaign_id: 102,
      name: 'Carl Clarke',
      email: 'carl.disco@gmail.com',
      company_name: 'Clarke Franchise Group',
      why_hot: null,
      became_hot_at: null,
    },
  ],
  total: 3,
  has_more: false,
  next_offset: null,
}

const mock = http.createServer((req, res) => {
  const url = req.url || ''
  if (url.startsWith('/__fail')) { failHotLeads = true; res.writeHead(200); return res.end('ok') }
  if (url.startsWith('/__ok')) { failHotLeads = false; res.writeHead(200); return res.end('ok') }
  if (req.headers['x-api-key'] !== MOCK_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ detail: 'Invalid or missing API key.' }))
  }
  if (url.startsWith('/public/api/v1/autogtm/campaigns')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({
      campaigns: [
        { id: 101, project_id: 42345, name: 'Trade contractors', status: 'active' },
        { id: 102, project_id: 42345, name: 'Franchise operators', status: 'active' },
      ],
      total: 2,
    }))
  }
  if (url.startsWith('/public/api/v1/autogtm/hot-leads')) {
    res.writeHead(failHotLeads ? 401 : 200, { 'Content-Type': 'application/json' })
    return res.end(failHotLeads ? JSON.stringify({ detail: 'Invalid or missing API key.' }) : JSON.stringify(hotPayload))
  }
  res.writeHead(404)
  res.end('nope')
})

async function main() {
  console.log('== Hot leads exec card local QA ==')
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r))
  console.log(`   mock Explee on 127.0.0.1:${MOCK_PORT}`)

  // 0. Clean slate: QA users + the saved Explee key row (so the NONE branch is honest)
  await db.user.deleteMany({ where: { email: { contains: '@hustleqa.local' } } })
  await db.user.deleteMany({ where: { email: 'ceo@businesshustle.co.za' } })
  await db.platformConfig.deleteMany({ where: { key: 'explee_api_key' } })

  // 1. Wall: anon 401
  const anon = await call('/api/admin/exec/hotleads')
  check('anon 401', anon.status === 401, `status ${anon.status}`)

  // 2. CEO master account first (exact exec email, flags self heal), then a
  // plain outsider for the 403 wall. CEO registers first so the outsider is
  // never the platform's first user (first user boots as admin locally).
  const ceo = await register('Business Owner', 'Business Hustle', 'ceo@businesshustle.co.za')
  const ceoMe = await call('/api/auth/me', { cookie: ceo.cookie })
  check('CEO self heal on register (ADMIN)', ceoMe.json?.user?.role === 'ADMIN', `role=${ceoMe.json?.user?.role}`)
  const outsider = await register('Bongani Khumalo', 'Khumalo Brands')
  const outsiderMe = await call('/api/auth/me', { cookie: outsider.cookie })
  const forbidden = await call('/api/admin/exec/hotleads', { cookie: outsider.cookie })
  check('outsider stays a plain client', outsiderMe.json?.user?.role !== 'ADMIN' && !outsiderMe.json?.user?.platformAdmin, `role=${outsiderMe.json?.user?.role}`)
  check('non exec 403', forbidden.status === 403, `status ${forbidden.status}`)

  // 3. No key yet: honest NONE, never fake data
  const none = await call('/api/admin/exec/hotleads', { cookie: ceo.cookie })
  check('no key: engine NONE', none.status === 200 && none.json?.engine === 'NONE', `engine=${none.json?.engine}`)
  check('no key: honest note', typeof none.json?.note === 'string' && /key/i.test(none.json.note || ''), `note=${none.json?.note}`)
  check('no key: zero leads, no fabricated rows', none.json?.total === 0 && Array.isArray(none.json?.leads) && none.json.leads.length === 0)

  // 4. Save the key through the real product path (Exec Dashboard settings)
  const saveRes = await call('/api/admin/config', { method: 'POST', body: { expleeApiKey: MOCK_KEY, leadPrice: 15 }, cookie: ceo.cookie })
  check('settings save accepts the key', saveRes.status === 200, `status ${saveRes.status}`)

  // 5. LIVE pull: real mapping from the mock contract
  const live = await call('/api/admin/exec/hotleads', { cookie: ceo.cookie })
  check('live pull: engine LIVE', live.status === 200 && live.json?.engine === 'LIVE', `engine=${live.json?.engine}`)
  check('total mirrors Explee', live.json?.total === 3, `total=${live.json?.total}`)
  check('campaign names joined', Array.isArray(live.json?.campaigns) && live.json.campaigns.length === 2 && live.json.campaigns.some((c) => c.name === 'Trade contractors'), `campaigns=${live.json?.campaigns?.length}`)
  const first = live.json?.leads?.[0]
  check('campaign join on the lead row', first?.campaignName === 'Trade contractors', `campaignName=${first?.campaignName}`)
  check('why hot verbatim', typeof first?.whyHot === 'string' && first.whyHot.includes('sample'), `whyHot=${(first?.whyHot || '').slice(0, 40)}`)
  check('became hot timestamp parsed', typeof first?.becameHotAt === 'string' && !Number.isNaN(Date.parse(first.becameHotAt)), `becameHotAt=${first?.becameHotAt}`)
  const unnamed = live.json?.leads?.find((l) => l.personId.startsWith('b2'))
  check('unnamed lead keeps email as identity', Boolean(unnamed?.email) && !unnamed?.name, `email=${unnamed?.email}`)
  const noWhy = live.json?.leads?.find((l) => l.personId.startsWith('c3'))
  check('lead without why hot still listed', Boolean(noWhy) && noWhy?.whyHot === undefined && noWhy?.campaignName === 'Franchise operators', `campaignName=${noWhy?.campaignName}`)

  // 6. Cache: second call inside the TTL is served warm
  const cached = await call('/api/admin/exec/hotleads', { cookie: ceo.cookie })
  check('second call served from cache', cached.json?.cached === true && cached.json?.engine === 'LIVE', `cached=${cached.json?.cached}`)

  // 7. Explee rejects the key: fresh honest error once the TTL passes
  await fetch(`http://127.0.0.1:${MOCK_PORT}/__fail`)
  await sleep(1500)
  const rejected = await call('/api/admin/exec/hotleads', { cookie: ceo.cookie })
  check('rejected key: fresh NONE, never stale gold', rejected.json?.engine === 'NONE' && rejected.json?.cached !== true, `engine=${rejected.json?.engine} cached=${rejected.json?.cached}`)
  check('rejected key: honest note', /rejected/i.test(rejected.json?.note || ''), `note=${rejected.json?.note}`)

  // 8. Healed: the moment Explee accepts again, hot leads flow with no cache of the failure
  await fetch(`http://127.0.0.1:${MOCK_PORT}/__ok`)
  const healed = await call('/api/admin/exec/hotleads', { cookie: ceo.cookie })
  check('healed: LIVE again immediately', healed.json?.engine === 'LIVE' && healed.json?.total === 3, `engine=${healed.json?.engine} total=${healed.json?.total}`)

  console.log(`\nRESULT: ${passed}/${passed + failed} PASS`)
  process.exitCode = failed === 0 ? 0 : 1
}

main()
  .catch((e) => { console.error('QA crashed:', e); process.exitCode = 1 })
  .finally(async () => {
    mock.close()
    await db.$disconnect()
  })
