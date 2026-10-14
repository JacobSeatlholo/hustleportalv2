// Exec lead pool production probe — verifies the Task 48 surfaces live on
// https://www.hustleportal.online. Non-destructive: a fresh QA client loads
// R500 sandbox credit (which fires the real owner notification + auto campaign
// by design — the owner will see it in his inbox as live proof), walls are
// checked with that same non-exec session. Run: node scripts/exec_pool_prod_probe.mjs
const BASE = 'https://www.hustleportal.online'

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}${extra ? ` :: ${extra}` : ''}`) }
  else { failed++; console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`) }
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 60000)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (HustlePortal-QA)',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    let json = null
    try { json = await res.json() } catch { /* empty */ }
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') }
  } finally { clearTimeout(t) }
}

const cookieOf = (res) => (res.setCookie || '').split(';')[0] || null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('== Exec lead pool production probe ==')

  // 1. New route live + unauth wall
  const unauth = await call('/api/admin/exec/client/probe/pool', { method: 'POST', body: {} })
  check('pool route live, unauth 401', unauth.status === 401, `status ${unauth.status}`)

  // 2. Fresh QA client
  const email = `poolprobe_${Date.now()}@hustleqa.example.com`.toLowerCase()
  const reg = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'hustle123', name: 'Pool Probe', businessName: 'Probe Brands', city: 'Soweto', industry: 'Retail' } })
  check('QA client registers', reg.status === 200, `status ${reg.status}`)
  const cookie = cookieOf(reg)
  const me = await call('/api/auth/me', { cookie })
  const userId = me.json?.user?.id
  check('session healthy with user id', Boolean(userId))

  // 3. Non-exec walls on every exec surface (old + new)
  const wall1 = await call('/api/admin/exec', { cookie })
  const wall2 = await call(`/api/admin/exec/client/${userId}`, { cookie })
  const wall3 = await call(`/api/admin/exec/client/${userId}/pool`, { method: 'POST', body: {}, cookie })
  const wall4 = await call(`/api/admin/exec/client/${userId}/pool`, { method: 'PATCH', body: { action: 'addAll' }, cookie })
  check('exec overview wall 403', wall1.status === 403, `status ${wall1.status}`)
  check('client detail wall 403', wall2.status === 403, `status ${wall2.status}`)
  check('pool run wall 403', wall3.status === 403, `status ${wall3.status}`)
  check('pool patch wall 403', wall4.status === 403, `status ${wall4.status}`)

  // 4. The money story fires: QA client loads R500 (starter pack)
  const walletBefore = await call('/api/wallet', { cookie })
  const before = walletBefore.json?.wallet?.balance ?? walletBefore.json?.balance ?? 0
  const topUp = await call('/api/wallet/topup', { method: 'POST', body: { packageId: 'starter' }, cookie })
  check('sandbox topup R500 accepted', topUp.status === 200 && topUp.json?.topUp?.status === 'PAID', `status ${topUp.status}`)
  await sleep(9000) // after(): exec email + auto campaign run post response
  const walletAfter = await call('/api/wallet', { cookie })
  const bal = walletAfter.json?.wallet?.balance ?? walletAfter.json?.balance ?? 0
  check('wallet credited R500', bal >= before + 50000, `before=${before} after=${bal}`)
  check('topup reference stamped', Boolean(topUp.json?.topUp?.reference), topUp.json?.topUp?.reference || '')

  // 5. Regression canary: discover still answers honestly for this client
  const disc = await call('/api/leads/discover', { method: 'POST', body: { definition: 'taverns and shebeens', city: 'Soweto', limit: 5 }, cookie })
  check('discover still answers', disc.status === 200 && Array.isArray(disc.json?.leads), `status ${disc.status} mode=${disc.json?.mode}`)

  console.log(`\nRESULT: ${passed}/${passed + failed} PASS`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((e) => { console.error('probe crashed:', e); process.exitCode = 1 })
