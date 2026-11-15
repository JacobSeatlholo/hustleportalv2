#!/usr/bin/env node
/**
 * Security probe for HustlePortal prod — owner-authorized black-box pass.
 * Non-destructive: no real third-party spend, no real recipient touched,
 * forged webhooks use fake addresses/messageIds only, suppression counts are
 * asserted UNCHANGED. Run: node scripts/security_probe.mjs
 */
const BASE = 'https://www.hustleportal.online'
let pass = 0, fail = 0
const findings = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${detail ? ' :: ' + detail : ''}`) }
  else { fail++; findings.push(name); console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`) }
}
async function call(path, { method = 'GET', body, cookie, headers = {}, timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    const text = await res.text().catch(() => '')
    let json = null
    try { json = JSON.parse(text) } catch { /* html or empty */ }
    return { status: res.status, json, text, headers: res.headers, setCookie: res.headers.get('set-cookie') }
  } finally { clearTimeout(t) }
}

// ---------- 1. unauthenticated access map ----------
console.log('\n== 1. unauthenticated access map (expect 401/403/405) ==')
const EXEC_PATHS = [
  '/api/admin/exec', '/api/admin/exec/campaigns', '/api/admin/exec/campaigns/audience',
  '/api/admin/exec/pool/verify', '/api/admin/exec/suppression', '/api/admin/exec/hotleads',
  '/api/admin/exec/growth', '/api/admin/exec/lead-quality', '/api/admin/exec/lookup-memory',
  '/api/admin/exec/welcome-sweep', '/api/admin/exec/winback', '/api/admin/exec/engine-diag',
  '/api/admin/exec/treg/catalog', '/api/admin/exec/abandoned-checkouts', '/api/admin/exec/clients/welcome',
  '/api/admin/exec/whatsapp-bot', '/api/admin/exec/mail', '/api/admin/config', '/api/admin/growth',
  '/api/admin/exec/xpitch', '/api/admin/exec/xpitch/search', '/api/admin/exec/xpitch/review',
  '/api/admin/exec/client/cm2lyew70000l806ylm84elwTEST', '/api/admin/exec/engine-diag',
]
let unauthLeaks = 0
for (const p of [...new Set(EXEC_PATHS)]) {
  const r = await call(p)
  const ok = r.status === 401 || r.status === 403 || r.status === 405 || r.status === 404
  if (!ok) { unauthLeaks++; console.log('    LEAK:', p, r.status) }
}
check('all exec/admin routes refuse anonymous callers', unauthLeaks === 0, `${EXEC_PATHS.length} routes probed`)

// member-only surfaces must not leak to anonymous either
const MEMBER_PATHS = ['/api/leads', '/api/clients', '/api/finance', '/api/invoices', '/api/tasks', '/api/emails', '/api/export', '/api/dashboard', '/api/wallet', '/api/settings']
let memberLeaks = 0
for (const p of MEMBER_PATHS) {
  const r = await call(p)
  if (r.status !== 401 && r.status !== 405) { memberLeaks++; console.log('    LEAK:', p, r.status) }
}
check('member data routes refuse anonymous callers', memberLeaks === 0, `${MEMBER_PATHS.length} routes probed`)

// ---------- 2. cron routes without the bearer secret ----------
console.log('\n== 2. cron routes without secret (expect 401/403 when CRON_SECRET set) ==')
const cr1 = await call('/api/cron/campaign-tick', { method: 'GET' })
check('campaign-tick refuses anonymous GET', cr1.status === 401 || cr1.status === 403, `status ${cr1.status} ${JSON.stringify(cr1.json).slice(0, 80)}`)
const cr2 = await call('/api/cron/daily-reminders', { method: 'GET' })
// a 200 here means CRON_SECRET is unset in prod AND the route fired — recorded as env finding
check('daily-reminders refuses anonymous GET', cr2.status === 401 || cr2.status === 403, `status ${cr2.status} ${JSON.stringify(cr2.json).slice(0, 120)}`)
const cr3 = await call('/api/cron/leads-refresh', { method: 'GET' })
check('leads-refresh refuses anonymous GET', cr3.status === 401 || cr3.status === 403, `status ${cr3.status} ${JSON.stringify(cr3.json).slice(0, 120)}`)

// ---------- 3. webhook forgery ----------
console.log('\n== 3. webhook forgery (fake ids only, suppression must not move) ==')
const supBefore = await (async () => {
  const login = await call('/api/auth', { method: 'POST', body: { action: 'login', email: 'ops@hustleqa.example.com', password: 'OpsSeat2026!Hustle' } })
  const cookie = (login.setCookie || '').split(';')[0]
  const s = await call('/api/admin/exec/suppression', { cookie })
  return { cookie, total: s.json?.total ?? -1 }
})()
check('exec login for probe works', Boolean(supBefore.cookie) && supBefore.total >= 0, `suppression total ${supBefore.total}`)

const fw1 = await call('/api/webhooks/resend', { method: 'POST', body: { type: 'email.bounced', data: { email: 'forgery-probe@nonexistent-hp-test.example', last_event: 'bounced' } } })
check('resend webhook ignores forged address-only bounce', fw1.status === 200 || fw1.status === 401 ? !(fw1.json?.processed === true) : true, `status ${fw1.status} body ${JSON.stringify(fw1.json).slice(0, 100)}`)

const forgeMsgId = `forge-probe-${Date.now()}`
const fw2 = await call('/api/webhooks/ses', { method: 'POST', body: { Type: 'Notification', Message: JSON.stringify({ eventType: 'Bounce', mail: { messageId: forgeMsgId, destination: ['forgery-probe@nonexistent-hp-test.example'] }, bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'forgery-probe@nonexistent-hp-test.example' }] } }) } })
const supAfter = await call('/api/admin/exec/suppression', { cookie: supBefore.cookie })
check('ses webhook does not suppress on forged bounce', supAfter.json?.total === supBefore.total, `before ${supBefore.total} after ${supAfter.json?.total} (status ${fw2.status})`)

const fw3 = await call('/api/webhooks/yoco', { method: 'POST', body: { id: 'evt_forge', type: 'payment.succeeded' }, headers: { 'webhook-id': 'x', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,deadbeef' } })
check('yoco webhook rejects forged signature', fw3.status === 400 || fw3.status === 401 || fw3.status === 403, `status ${fw3.status}`)

const fwi = await call('/api/webhooks/ses-inbound', { method: 'POST', body: { Type: 'Notification', Message: 'forged', Signature: 'deadbeef' } })
check('ses-inbound rejects forged SNS envelope', fwi.status === 400 || fwi.status === 403 || (fwi.json && fwi.json.ok !== true), `status ${fwi.status} body ${JSON.stringify(fwi.json).slice(0, 80)}`)

// ---------- 4. cross-tenant IDOR with a fresh member session ----------
console.log('\n== 4. cross-tenant IDOR (fresh QA member vs boss-owned rows) ==')
const qaEmail = `secprobe_${Date.now()}@hustleqa.example.com`
const reg = await call('/api/auth', { method: 'POST', body: { action: 'register', email: qaEmail, password: 'SecProbe2026!', name: 'Sec Probe' } })
const qaCookie = (reg.setCookie || '').split(';')[0]
check('QA probe seat registered', Boolean(qaCookie), qaEmail)

// boss lead id via exec seat
const execLogin = await call('/api/auth', { method: 'POST', body: { action: 'login', email: 'ops@hustleqa.example.com', password: 'OpsSeat2026!Hustle' } })
const execCookie = (execLogin.setCookie || '').split(';')[0]
const bossDetail = await call('/api/admin/exec/client/cmv2lyew70000l806ylm84elw', { cookie: execCookie })
const bossLeadId = bossDetail.json?.pipeline?.rows?.[0]?.id
if (bossLeadId) {
  const idor1 = await call(`/api/leads/${bossLeadId}`, { cookie: qaCookie })
  check('member cannot read another account lead', idor1.status === 404 || idor1.status === 403, `status ${idor1.status}`)
  const idor2 = await call(`/api/leads/${bossLeadId}`, { method: 'PATCH', cookie: qaCookie, body: { stage: 'LOST' } })
  check('member cannot mutate another account lead', idor2.status === 404 || idor2.status === 403 || (idor2.json && idor2.json.error), `status ${idor2.status}`)
} else check('boss lead id fetch (prereq)', false, 'no lead rows returned')

const bossProject = 'cmv3hqdk30001kz06oyjn770q'
const idor3 = await call(`/api/projects/${bossProject}`, { cookie: qaCookie })
check('member cannot read another account project', idor3.status === 404 || idor3.status === 403, `status ${idor3.status}`)

const execAsMember = await call('/api/admin/exec', { cookie: qaCookie })
check('member session rejected on exec dashboard', execAsMember.status === 403 || execAsMember.status === 401, `status ${execAsMember.status}`)
const execCampaignAsMember = await call('/api/admin/exec/campaigns', { method: 'POST', cookie: qaCookie, body: { campaign: 'sec-probe', subject: 'x', body: 'x' } })
check('member session rejected on exec campaign staging', execCampaignAsMember.status === 403 || execCampaignAsMember.status === 401, `status ${execCampaignAsMember.status}`)

// ---------- 5. headers + cookie flags ----------
console.log('\n== 5. security headers + cookie flags ==')
const home = await call('/')
const hsts = home.headers.get('strict-transport-security')
check('HSTS present', Boolean(hsts), hsts || 'missing')
const frame = home.headers.get('x-frame-options') || (home.headers.get('content-security-policy') || '').includes('frame-ancestors')
check('clickjacking guard present', Boolean(frame), frame ? 'frame-ancestors/XFO set' : 'MISSING')
const nosniff = home.headers.get('x-content-type-options')
check('nosniff present', (nosniff || '').toLowerCase() === 'nosniff', nosniff || 'missing')
const loginRes = await call('/api/auth', { method: 'POST', body: { action: 'login', email: qaEmail, password: 'wrong-password' } })
const sc = loginRes.setCookie || ''
check('failed login sets no new session cookie', !/hp_session=/.test(sc), sc ? sc.slice(0, 60) : 'no cookie on failure')

// ---------- 6. client bundle secret scan ----------
console.log('\n== 6. client bundle secret scan ==')
const html = home.text || ''
const bundles = [...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map(m => m[0])
const uniqBundles = [...new Set(bundles)].slice(0, 8)
let secretHits = []
for (const b of uniqBundles) {
  const r = await call(b)
  const t = r.text || ''
  const pats = [
    [/sk_live_[A-Za-z0-9]{8,}/, 'yoco secret key'], [/AKIA[0-9A-Z]{16}/, 'aws access key'],
    [/re_[A-Za-z0-9]{20,}/, 'resend api key'], [/whsec_[A-Za-z0-9]{10,}/, 'webhook secret'],
    [/AIza[A-Za-z0-9_\-]{30,}/, 'google api key'],
  ]
  for (const [re, label] of pats) {
    const m = t.match(re)
    if (m) secretHits.push(`${label}: ${m[0].slice(0, 12)}...`)
  }
}
check('no provider secrets in shipped bundles', secretHits.length === 0, secretHits.join('; ') || `${uniqBundles.length} bundles scanned`)

// ---------- 7. login rate limit ----------
console.log('\n== 7. login rate limit ==')
let saw429 = false
const attempts = []
for (let i = 0; i < 8; i++) {
  const r = await call('/api/auth', { method: 'POST', body: { action: 'login', email: `rl_${Date.now()}_${i}@hustleqa.example.com`, password: 'WrongPass123!' } })
  attempts.push(r.status)
  if (r.status === 429) saw429 = true
}
check('login brute force meets a rate wall or honest 401s', saw429 || attempts.every(s => s === 401 || s === 429), `statuses ${attempts.join(',')}`)

// ---------- 8. unsubscribe + open pixel forgery ----------
console.log('\n== 8. unsubscribe / open pixel ==')
const u1 = await call('/api/unsubscribe?c=fakeid123&s=badsig', {})
check('unsubscribe rejects bad signature', u1.status === 403 || u1.status === 400, `status ${u1.status}`)
const u2 = await call('/api/mail/open/nonexistent-id', {})
check('open pixel handles unknown id gracefully', u2.status !== 500, `status ${u2.status}`)

// ---------- summary ----------
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) console.log('findings:', findings.join(' | '))
process.exit(fail > 0 ? 1 : 0)
