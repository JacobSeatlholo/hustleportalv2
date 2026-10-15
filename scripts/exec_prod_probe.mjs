// Task 47 prod probe: Executive Dashboard deployed + locked to non-execs.
// Run: node scripts/exec_prod_probe.mjs
const BASE = process.env.HP_BASE || 'https://www.hustleportal.online'

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
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    let json = null
    try { json = await res.json() } catch { /* empty */ }
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') }
  } finally { clearTimeout(t) }
}

async function main() {
  console.log(`== Executive Dashboard prod probe :: ${BASE} ==`)

  // 1. Deployment marker: route exists now (401 unauthed, not 404)
  const anon = await call('/api/admin/exec')
  check('new route live: /api/admin/exec -> 401 unauthed', anon.status === 401, `status ${anon.status}`)
  const anonHl = await call('/api/admin/exec/hotleads')
  check('hotleads route live: 401 unauthed', anonHl.status === 401, `status ${anonHl.status}`)

  // 2. Fresh outsider session -> the whole exec surface is a 403 wall
  const email = `execqa_${Date.now()}@hustleqa.example.com`
  const reg = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'hustle123', name: 'Exec QA', businessName: 'Probe Co', city: 'Soweto' } })
  const cookie = (reg.setCookie || '').split(';')[0]
  check('fresh QA client registered', reg.status === 200 && !!cookie)

  const [feed, detail, patch, inject, hl, cfg] = await Promise.all([
    call('/api/admin/exec', { cookie }),
    call('/api/admin/exec/client/clx_probe_id', { cookie }),
    call('/api/admin/exec/client/clx_probe_id', { method: 'PATCH', cookie, body: { status: 'SUSPENDED' } }),
    call('/api/admin/exec/client/clx_probe_id/leads', { method: 'POST', cookie, body: { leads: [{ company: 'X' }] } }),
    call('/api/admin/exec/hotleads', { cookie }),
    call('/api/admin/config', { cookie }),
  ])
  check('feed 403', feed.status === 403, `status ${feed.status}`)
  check('detail 403', detail.status === 403, `status ${detail.status}`)
  check('suspend 403', patch.status === 403, `status ${patch.status}`)
  check('inject 403', inject.status === 403, `status ${inject.status}`)
  check('hotleads 403', hl.status === 403, `status ${hl.status}`)
  check('legacy admin config still 403 for non-admin', cfg.status === 403, `status ${cfg.status}`)

  // 3. The outsider's own session is healthy (auth path untouched by the exec gate)
  const me = await call('/api/auth/me', { cookie })
  check('QA client session healthy after auth change', me.status === 200 && me.json?.user?.email === email, `status ${me.status}`)
  check('QA client wallet + welcome credit intact', typeof me.json?.wallet?.balance === 'number' && me.json.wallet.balance > 0, `balance=${me.json?.wallet?.balance}`)

  console.log(`\nRESULT: ${passed}/${passed + failed} PASS${failed ? ` (${failed} FAIL)` : ''}`)
}

main().catch((e) => { console.error('PROBE_CRASH', e); process.exitCode = 1 })
