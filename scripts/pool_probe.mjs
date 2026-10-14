/**
 * Verified Lead Pool probe — proves the freshness, scale and verification
 * promises on PRODUCTION with real scans:
 *
 *   1. Seller A scans a topic (the exact wellness scan from the user's screenshot).
 *      Expect real leads, engine carried, and every lead carrying verification chips.
 *   2. Seller A rescans the same topic 13s later. Expect the pool to serve
 *      (mode POOL) with zero engine calls.
 *   3. Seller A immediately scans again. Expect the gentle cooldown 429.
 *   4. Seller B (brand new user) scans the SAME topic. Expect the pool to serve
 *      instantly for them too — the onboarding scale promise: the first scan
 *      paid, everyone after serves free.
 */
const BASE = 'https://www.hustleportal.online'
let cookie = ''
async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || 75_000),
  })
  const sc = res.headers.get('set-cookie')
  if (sc && !cookie) cookie = sc.split(';')[0]
  return res
}
async function register(name) {
  cookie = ''
  const stamp = Date.now()
  const res = await req('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'register', email: `pool_${stamp}@hustleqa.example.com`, password: `Qa!${stamp}x`, name }),
  })
  return res.status
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let total = 0
function check(name, ok, detail = '') {
  total++
  if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}
function sum(lr) {
  return (lr || []).map((l) => `${l.company}${l.phone ? ` ${l.phone}` : ''}${l.verified ? ` [${l.verified}${l.seenAgo ? `, ${l.seenAgo}` : ''}]` : ''}`)
}

const TOPIC = { definition: 'stressed professionals, walk in massage, floatation etc.', city: 'Cape Town', limit: 5 }

// ---- 1. Seller A: the paying first scan ----
console.log('\n=== 1. seller A first scan (engines pay) ===')
console.log('register A:', await register('Pool Probe A'))
const scan1 = await req('/api/leads/discover', { method: 'POST', body: JSON.stringify({ ...TOPIC, debug: true }) })
const j1 = await scan1.json().catch(() => null)
console.log('status:', scan1.status, '| mode:', j1?.mode, '| source:', j1?.source || '')
console.log('note:', String(j1?.note || '(none)').slice(0, 300))
console.log('leads:')
for (const line of sum(j1?.leads)) console.log('  ', line)
check('A first scan returns real leads', scan1.status === 200 && (j1?.leads?.length || 0) > 0, `mode=${j1?.mode} count=${j1?.leads?.length}`)
check('A first scan leads carry verification chips', (j1?.leads || []).every((l) => l.verified && l.seenAgo), 'verified+seenAgo on every lead')

// ---- 2. Seller A rescans: pool serves ----
await sleep(13_000)
console.log('\n=== 2. seller A rescan after 13s (pool should serve) ===')
const scan2 = await req('/api/leads/discover', { method: 'POST', body: JSON.stringify({ ...TOPIC }) })
const j2 = await scan2.json().catch(() => null)
console.log('status:', scan2.status, '| mode:', j2?.mode)
console.log('note:', String(j2?.note || '(none)').slice(0, 300))
console.log('leads:', sum(j2?.leads).join(' | ').slice(0, 400))
check('A rescan served from the verified pool', scan2.status === 200 && j2?.mode === 'POOL' && (j2?.leads?.length || 0) > 0, `mode=${j2?.mode} count=${j2?.leads?.length}`)
check('pool serve leads carry verification chips', (j2?.leads || []).every((l) => l.verified && l.seenAgo))

// ---- 3. cooldown guard ----
console.log('\n=== 3. immediate third scan (cooldown should land) ===')
const scan3 = await req('/api/leads/discover', { method: 'POST', body: JSON.stringify({ ...TOPIC }) })
const j3 = await scan3.json().catch(() => null)
console.log('status:', scan3.status, '| error:', String(j3?.error || '').slice(0, 160))
check('cooldown 429 with gentle copy', scan3.status === 429 && /catching its breath/i.test(String(j3?.error || '')))

// ---- 4. Seller B, brand new: the onboarding scale promise ----
console.log('\n=== 4. seller B first ever scan on the same topic (pool serves free) ===')
console.log('register B:', await register('Pool Probe B'))
const scan4 = await req('/api/leads/discover', { method: 'POST', body: JSON.stringify({ ...TOPIC }) })
const j4 = await scan4.json().catch(() => null)
console.log('status:', scan4.status, '| mode:', j4?.mode)
console.log('note:', String(j4?.note || '(none)').slice(0, 300))
console.log('leads:', sum(j4?.leads).join(' | ').slice(0, 400))
check('B first scan served from the pool instantly', scan4.status === 200 && j4?.mode === 'POOL' && (j4?.leads?.length || 0) > 0, `mode=${j4?.mode} count=${j4?.leads?.length}`)

console.log(`\nRESULT: ${pass}/${total} PASS`)
