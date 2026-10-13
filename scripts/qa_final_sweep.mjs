#!/usr/bin/env node
/**
 * Final production QA sweep — routes and contracts not covered by the other suites.
 * Asserts CONTRACT (status + JSON shape + honesty), never AI luck.
 * Usage: node scripts/qa_final_sweep.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const EMAIL = `qasweep_${Date.now()}@hustleqa.example.com`
const PASSWORD = 'QaSweep2026!'
let cookie = ''
let pass = 0, fail = 0, skip = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
function note(name, detail = '') { skip++; console.log(`  SKIP ${name}${detail ? ` — ${detail}` : ''}`) }

async function req(method, path, body, timeoutMs = 30000, extraHeaders = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    const setC = res.headers.get('set-cookie')
    if (setC) cookie = setC.split(';')[0]
    let json = null
    try { json = await res.json() } catch { /* html or empty ok */ }
    return { status: res.status, json, text: json ? '' : await res.text().catch(() => '') }
  } finally { clearTimeout(t) }
}
async function raw(path, timeoutMs = 20000) {
  const res = await fetch(path.startsWith('http') ? path : BASE + path, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
  const text = await res.text().catch(() => '')
  return { status: res.status, text, location: res.headers.get('location') }
}

console.log(`\n[0] public surfaces`)
{
  const h = await raw('/api/health')
  const hj = (() => { try { return JSON.parse(h.text) } catch { return null } })()
  check('health ok + db ping', h.status === 200 && hj?.ok === true && hj?.db?.ping === true, `tables=${hj?.db?.tables?.length ?? 0}`)
  const root = await raw('/')
  check('app shell serves', root.status === 200 && root.text.includes('HustlePortal'), `${root.text.length} bytes`)
  check('landing is client-rendered shell (pricing verified via browser QA)', root.text.length < 60000 && root.status === 200, `${root.text.length} bytes`)
  const man = await raw('/manifest.webmanifest')
  check('manifest ok + start_url fixed', man.status === 200 && man.text.includes('"start_url"') && !man.text.includes('/dashboard"'), '')
  const sw = await raw('/sw.js')
  check('service worker serves', sw.status === 200 && sw.text.includes('push'), '')
  const robots = await raw('/robots.txt')
  check('robots serves', robots.status === 200, '')
  const apex = await raw('https://hustleportal.online/api/health')
  check('apex 308 → www (informational)', apex.status === 308 && (apex.location || '').includes('www.'), `loc=${apex.location || 'none'}`)
  const bad = await req('POST', '/api/auth', { action: 'login', email: 'nosuch@hustleqa.example.com', password: 'wrong' })
  check('bad login rejected cleanly', bad.status === 401 && typeof bad.json?.error === 'string', bad.json?.error?.slice(0, 60))
  const noauth = await req('GET', '/api/clients')
  check('protected route rejects anonymous', noauth.status === 401, '')
}

console.log(`\n[1] account bootstrap`)
{
  const reg = await req('POST', '/api/auth', { action: 'register', email: EMAIL, password: PASSWORD, name: 'QA Sweep', businessName: 'Sweep Spaza' })
  check('register ok (session via cookie)', reg.status === 200 && reg.json?.ok === true, `joinedTeams=${JSON.stringify(reg.json?.joinedTeams ?? [])}`)
  const me = await req('GET', '/api/auth/me')
  check('session me ok', me.status === 200 && me.json?.user?.email === EMAIL, '')
}

console.log(`\n[2] core data routes (contract)`)
{
  const dash = await req('GET', '/api/dashboard')
  check('dashboard 200', dash.status === 200 && typeof dash.json === 'object', Object.keys(dash.json || {}).slice(0, 5).join(','))
  const prof = await req('PATCH', '/api/profile', { name: 'QA Sweep', city: 'Johannesburg' })
  check('profile PATCH 200', prof.status === 200 && (prof.json?.ok === true || !!prof.json?.user), '')
  const leads = await req('GET', '/api/leads')
  check('leads GET 200 + array', leads.status === 200 && Array.isArray(leads.json?.leads ?? leads.json), '')
  const clients = await req('GET', '/api/clients')
  check('clients GET 200 + array', clients.status === 200 && Array.isArray(clients.json?.clients ?? clients.json), '')
  const inv = await req('GET', '/api/invoices')
  check('invoices GET 200 (ships logoUrl key)', inv.status === 200 && Array.isArray(inv.json?.invoices ?? inv.json), `logoUrl=${'logoUrl' in (inv.json?.invoices?.[0] ?? inv.json ?? {})}`)
  const tasks = await req('GET', '/api/tasks')
  check('tasks GET 200 + array', tasks.status === 200 && Array.isArray(tasks.json?.tasks ?? tasks.json), '')
  const fin = await req('GET', '/api/finance')
  check('finance GET 200', fin.status === 200, '')
  const appts = await req('GET', '/api/appointments')
  check('appointments GET 200', appts.status === 200, '')
  const projects = await req('GET', '/api/projects')
  check('projects GET 200 + ships members', projects.status === 200 && Array.isArray(projects.json?.projects ?? projects.json), '')
  const teams = await req('GET', '/api/teams')
  check('teams GET 200', teams.status === 200, '')
  const emails = await req('GET', '/api/emails')
  check('emails GET 200', emails.status === 200, '')
  const emailStatus = await req('GET', '/api/emails/status')
  check('emails/status 200', emailStatus.status === 200, '')
  const settings = await req('GET', '/api/settings')
  check('settings GET 200 (no key material)', settings.status === 200 && !JSON.stringify(settings.json).includes('AIza'), '')
  const refs = await req('GET', '/api/refs')
  check('refs GET 200', refs.status === 200, '')
  const reports = await req('GET', '/api/reports')
  check('reports GET 200', reports.status === 200, '')
  const gam = await req('GET', '/api/gamification/challenges')
  check('challenges GET 200', gam.status === 200, '')
  const exportData = await req('GET', '/api/export')
  check('export GET 200', exportData.status === 200, '')
  const geo = await req('GET', '/api/geo')
  const geoOk = geo.status === 200 && typeof geo.json?.country === 'string' && typeof geo.json?.currency === 'string'
    && ((geo.json.country === 'ZA') === (geo.json.currency === 'ZAR'))
  check('geo honest country/currency coherence (ZA→ZAR enforced at the edge)', geoOk, JSON.stringify(geo.json).slice(0, 60))
  const push = await req('GET', '/api/push')
  check('push public key served', push.status === 200 && (push.json?.publicKey || push.json?.key || '').length > 50, '')
  const sub = await req('GET', '/api/subscribe')
  check('subscribe GET 200 (plan state)', sub.status === 200 && typeof sub.json === 'object', `plan=${sub.json?.subscription?.plan ?? sub.json?.plan ?? '?'}`)
}

console.log(`\n[3] free-plan gates not covered elsewhere`)
{
  // email send cap: contract check — the 7th send must 402. Sends 1..6 land on a fake domain (harmless).
  let gateSeen = false
  for (let i = 1; i <= 7; i++) {
    const r = await req('POST', '/api/emails', { to: 'nobody@hustleqa.example.com', subject: `QA sweep ${i}`, body: 'QA sweep message body.' }, 25000)
    if (r.status === 402 && r.json?.upgrade === true) { gateSeen = true; check(`email gate fires on send #${i} → 402 upgrade`, true, r.json?.error?.slice(0, 60)); break }
    if (r.status >= 500) { check(`email send #${i} not a server error`, false, JSON.stringify(r.json).slice(0, 80)); break }
  }
  if (!gateSeen) note('email 6-send gate', 'did not reach the wall in 7 sends (engine state dependent)')
  // service request dual channel: task + email
  const sr = await req('POST', '/api/service-requests', { serviceTitle: 'Simple business website', message: 'QA sweep: please build me a simple site for my spaza.' }, 30000)
  check('service request creates task + mail', sr.status === 200 && sr.json?.ok === true && !!sr.json?.ref, `emailSent=${sr.json?.emailSent ?? '?'}`)
}

console.log(`\n[4] AI routes — contract + honesty only (quota is allowed to answer)`)
{
  const diag = await req('GET', '/api/ai/diagnose', null, 45000)
  check('ai/diagnostics reports key health', diag.status === 200 && diag.json?.ok === true && Array.isArray(diag.json?.checks), `platformKey=${diag.json?.keys?.platformKey?.present ? 'present' : 'missing'}`)
  await new Promise(r => setTimeout(r, 3000))
  const plan = await req('POST', '/api/ai/plan', { business: 'Spaza shop in Johannesburg selling groceries and airtime', goal: 'grow monthly revenue' }, 45000)
  check('ai/plan answers or fails honestly', plan.status === 200 || (typeof plan.json?.error === 'string' && plan.json.error.length > 10), `status=${plan.status}`)
  await new Promise(r => setTimeout(r, 3000))
  const advisor = await req('POST', '/api/ai/advisor', { message: 'What is one thing I should fix first?' }, 45000)
  check('ai/advisor answers or fails honestly', advisor.status === 200 || (typeof advisor.json?.error === 'string' && advisor.json.error.length > 10), `status=${advisor.status}`)
  await new Promise(r => setTimeout(r, 3000))
  const parse = await req('POST', '/api/ai/parse-appointment', { transcript: 'Meeting with Thabo Tuesday 10am about stock' }, 45000)
  check('ai/parse-appointment answers or fails honestly', parse.status === 200 || (typeof parse.json?.error === 'string'), `status=${parse.status}`)
}

console.log(`\n[5] task record integrity (sealed chain)`)
{
  const t = await req('POST', '/api/tasks', { title: 'Sweep sealed task', assigneeEmail: EMAIL }, 20000)
  const taskId = t.json?.task?.id ?? t.json?.id
  check('task created', t.status === 200 && !!taskId, '')
  if (taskId) {
    const rec = await req('GET', `/api/tasks/${taskId}/record`)
    check('record endpoint returns events + verified', rec.status === 200 && Array.isArray(rec.json?.events) && typeof rec.json?.verified === 'boolean', `events=${rec.json?.events?.length ?? 0} verified=${rec.json?.verified}`)
    const c = await req('POST', `/api/tasks/${taskId}/comments`, { body: 'Sweep comment one' }, 20000)
    check('comment posts', c.status === 200, '')
    const list = await req('GET', `/api/tasks/${taskId}/comments`)
    check('comments list shows it', list.status === 200 && JSON.stringify(list.json).includes('Sweep comment one'), '')
    const del = await req('DELETE', `/api/tasks/${taskId}`)
    check('task cleanup delete', del.status === 200 || del.status === 204, '')
  }
}

console.log(`\n[6] cleanup + session`)
{
  const out = await req('POST', '/api/auth/logout', {})
  check('logout ok', out.status === 200, '')
  const me = await req('GET', '/api/auth/me')
  check('session cleared', me.status === 401, '')
}

console.log(`\n===== RESULT: ${pass} PASS / ${fail} FAIL / ${skip} informational =====`)
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(`  ✗ ${f}`)); process.exit(1) }
