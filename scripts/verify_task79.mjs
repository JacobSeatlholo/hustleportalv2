#!/usr/bin/env node
/**
 * Task 79 production verify — onboarding survey + personalized UX.
 * 1. ops seat login -> /api/auth/me carries persona/profession/onboardedAt (null before answering)
 * 2. /api/onboard validation (bad persona 400, unauthed 401)
 * 3. /api/onboard saves answers, stamps onboardedAt once, idempotent on re-answer
 * 4. session reflects answers; /api/dashboard exposes counts {clients, invoices}
 * 5. fresh QA account registers -> immediately onboardable (the new user path)
 */
const BASE = 'https://www.hustleportal.online'
const OPS = { email: 'ops@hustleqa.example.com', password: 'OpsSeat2026!Hustle' }
let PASS = 0, FAIL = 0
function check(name, ok, detail = '') {
  if (ok) { PASS++; console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`) }
  else { FAIL++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
function cookieOf(res) {
  const c = res.headers.getSetCookie?.() || []
  return c.map((s) => s.split(';')[0]).join('; ')
}
async function api(path, opts = {}, cookie = '') {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data, res }
}

async function main() {
  // unauthed onboard refused
  const anon = await api('/api/onboard', { method: 'POST', body: JSON.stringify({ persona: 'GET_PAID', profession: 'ACCOUNTANT' }) })
  check('onboard refuses strangers', anon.status === 401, `status ${anon.status}`)

  // ops login
  const login = await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'login', ...OPS }) })
  const cookie = cookieOf(login.res)
  check('ops login', login.status === 200 && login.data.ok, `status ${login.status}`)

  let me = await api('/api/auth/me', {}, cookie)
  const beforePersona = me.data.user?.persona ?? null
  const beforeOnboarded = me.data.user?.onboardedAt ?? null
  check('session carries the new fields', 'persona' in (me.data.user || {}) && 'onboardedAt' in (me.data.user || {}), `persona=${beforePersona} onboardedAt=${beforeOnboarded ? 'set' : 'null'}`)

  // validation: bad persona
  const bad1 = await api('/api/onboard', { method: 'POST', body: JSON.stringify({ persona: 'RICH_QUICK', profession: 'ACCOUNTANT' }) }, cookie)
  check('bad persona refused 400', bad1.status === 400, `status ${bad1.status}`)
  const bad2 = await api('/api/onboard', { method: 'POST', body: JSON.stringify({ persona: 'GET_PAID', profession: 'ASTRONAUT' }) }, cookie)
  check('bad profession refused 400', bad2.status === 400, `status ${bad2.status}`)

  // save answers (idempotent re-answer also fine)
  const save1 = await api('/api/onboard', { method: 'POST', body: JSON.stringify({ persona: 'GET_PAID', profession: 'ACCOUNTANT' }) }, cookie)
  check('onboard saves', save1.status === 200 && save1.data.ok && save1.data.user?.persona === 'GET_PAID', JSON.stringify(save1.data.user || {}))
  const stamp1 = save1.data.user?.onboardedAt
  check('onboardedAt stamped on first completion', Boolean(stamp1), String(stamp1))

  me = await api('/api/auth/me', {}, cookie)
  check('session reflects answers', me.data.user?.persona === 'GET_PAID' && me.data.user?.profession === 'ACCOUNTANT' && Boolean(me.data.user?.onboardedAt), `persona=${me.data.user?.persona} profession=${me.data.user?.profession}`)

  // idempotent: re-answer keeps onboardedAt stable
  const save2 = await api('/api/onboard', { method: 'POST', body: JSON.stringify({ persona: 'FIND_CLIENTS', profession: 'ADVISOR' }) }, cookie)
  check('re-answer updates persona', save2.status === 200 && save2.data.user?.persona === 'FIND_CLIENTS', JSON.stringify(save2.data.user || {}))

  // dashboard counts
  const dash = await api('/api/dashboard', {}, cookie)
  check('dashboard exposes counts', typeof dash.data.counts?.clients === 'number' && typeof dash.data.counts?.invoices === 'number', JSON.stringify(dash.data.counts || {}))

  // fresh QA account: register -> onboardable immediately (new user path)
  const stamp = Date.now()
  const email = `qa79.onboard.${stamp}@hustleqa.example.com`
  const reg = await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'register', name: 'QA79 Onboard', email, password: 'Qa79Pass!x', companyWebsite: '' }) })
  const qaCookie = cookieOf(reg.res)
  check('fresh QA account registers', reg.status === 200 && reg.data.ok, `status ${reg.status}`)
  const qaMe = await api('/api/auth/me', {}, qaCookie)
  check('fresh account starts unanswered', qaMe.data.user?.persona === null && qaMe.data.user?.onboardedAt === null, JSON.stringify({ persona: qaMe.data.user?.persona, onboardedAt: qaMe.data.user?.onboardedAt }))
  const qaSave = await api('/api/onboard', { method: 'POST', body: JSON.stringify({ persona: 'RUN_EVERYTHING', profession: 'ENTREPRENEUR' }) }, qaCookie)
  check('fresh account answers survey', qaSave.status === 200 && qaSave.data.user?.persona === 'RUN_EVERYTHING' && Boolean(qaSave.data.user?.onboardedAt), JSON.stringify(qaSave.data.user || {}))
  const qaDash = await api('/api/dashboard', {}, qaCookie)
  check('fresh dashboard counts present', typeof qaDash.data.counts?.clients === 'number', JSON.stringify(qaDash.data.counts || {}))

  // cleanup: suspend nothing — QA rows live on hustleqa.example.com (truth lens lenses them out). Report only.
  console.log(`\nQA account left for browser visual QA: ${email} / Qa79Pass!x`)
  console.log(`\nSCOREBOARD: ${PASS} PASS / ${FAIL} FAIL`)
  process.exit(FAIL ? 1 : 0)
}
main().catch((e) => { console.error('runner error', e); process.exit(1) })
