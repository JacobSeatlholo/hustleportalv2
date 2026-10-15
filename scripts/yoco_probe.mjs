// Yoco live key diagnostic probe.
// Registers a fresh QA probe account, then attempts BOTH money paths
// (subscription checkout + wallet top-up). QA accounts receive the raw
// provider detail (yocoDetail), so this prints Yoco's own verdict on the
// key currently wired into Vercel — expired key, bad permissions, or green.
const BASE = 'https://www.hustleportal.online'
const EMAIL = `yoco_${Date.now()}@hustleqa.example.com`
const PASSWORD = 'QaProbe!2345'

let cookie = ''

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  for (const c of setCookie) {
    const kv = c.split(';')[0]
    if (kv.startsWith('hp_session') || kv.includes('session')) cookie = kv
  }
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// 1. Register + login
const reg = await req('POST', '/api/auth', {
  action: 'register', email: EMAIL, password: PASSWORD,
  name: 'Yoco Probe', businessName: 'Yoco Probe', industry: 'RETAIL', city: 'Johannesburg',
})
check('register ok', reg.status === 200 && reg.json?.ok === true, `status ${reg.status}`)

// 2. Subscription checkout — the path a paying client hits.
const sub = await req('POST', '/api/subscribe', { plan: 'HUSTLER', cycle: 'MONTHLY' })
const subOk = sub.json?.ok === true && typeof sub.json?.redirectUrl === 'string'
check('subscribe checkout', subOk, JSON.stringify(sub.json))
if (subOk) console.log(`      mode=${sub.json.mode} redirect=${String(sub.json.redirectUrl).slice(0, 90)}`)

// 3. Wallet top-up checkout — second money path.
const top = await req('POST', '/api/wallet/topup', { packageId: 'starter' })
const topOk = top.json?.ok === true && typeof top.json?.redirectUrl === 'string'
check('topup checkout', topOk, JSON.stringify(top.json))
if (topOk) console.log(`      mode=${top.json.mode} redirect=${String(top.json.redirectUrl).slice(0, 90)}`)

const pass = checks.filter(c => c.ok).length
console.log(`\nRESULT: ${pass}/${checks.length} PASS`)
process.exit(pass === checks.length ? 0 : 1)
