#!/usr/bin/env node
/**
 * Live verification of the leadsOf staging source, on a throwaway QA seat.
 * Nothing real is touched: example.com addresses, queue born PAUSED, the
 * test queue is cancelled and its rows removed at the end.
 * Run: node scripts/leadsOf_live_test.mjs
 */
const BASE = 'https://www.hustleportal.online'
let pass = 0, fail = 0
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS ${n}${d ? ' :: ' + d : ''}`) } else { fail++; console.log(`  FAIL ${n}${d ? ' :: ' + d : ''}`) } }
async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text().catch(() => '')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, headers: res.headers, setCookie: res.headers.get('set-cookie') }
}

// exec seat
const ex = await call('/api/auth', { method: 'POST', body: { action: 'login', email: 'ops@hustleqa.example.com', password: 'OpsSeat2026!Hustle' } })
const exCookie = (ex.headers.get('set-cookie') || '').split(';')[0]
check('exec login', Boolean(exCookie))

// fresh QA seat with two example.com leads
const email = `leadsOf_${Date.now()}@hustleqa.example.com`
const reg = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'LeadsOf2026!', name: 'LeadsOf Test' } })
const qaCookie = (reg.headers.get('set-cookie') || '').split(';')[0]
check('QA seat registered', Boolean(qaCookie), email)
const me = await call('/api/auth/me', { cookie: qaCookie })
const qaId = me.json?.user?.id
check('QA userId known', Boolean(qaId), qaId || '')
const l1 = await call('/api/leads', { method: 'POST', cookie: qaCookie, body: { company: 'Example One', email: 'one@example.com', city: 'Cape Town' } })
const l2 = await call('/api/leads', { method: 'POST', cookie: qaCookie, body: { company: 'Example Two', email: 'two@example.com', city: 'Durban' } })
check('two test leads created', l1.status === 200 && l2.status === 200)

// stage via leadsOf, excluding one address
const tag = `sec-probe-leadsof-${Date.now().toString(36)}`
const stage = await call('/api/admin/exec/campaigns', {
  method: 'POST', cookie: exCookie,
  body: { campaign: tag, subject: 'LeadsOf verification letter', body: 'This is the verification body for the leadsOf staging source test, long enough to pass the honest length law.', leadsOf: qaId, exclude: ['two@example.com'], from: 'Business Hustle <hello@hustleportal.online>' },
})
check('staging returns ok', stage.status === 200 && stage.json?.ok === true, `status ${stage.status} ${JSON.stringify(stage.json).slice(0, 200)}`)
check('leadsOf readout honest', stage.json?.leadsOf?.leads === 2 && stage.json?.leadsOf?.withEmail === 2 && stage.json?.leadsOf?.excluded === 1, JSON.stringify(stage.json?.leadsOf))
check('queued exactly the unexcluded lead', stage.json?.queued === 1, `queued ${stage.json?.queued}`)
check('queue born PAUSED', stage.json?.state?.status === 'PAUSED', stage.json?.state?.status)

// the queued row carries the right email and a QUEUED status
const readout = await call('/api/admin/exec/campaign', { cookie: exCookie })
const rows = (readout.json?.rows || []).filter(r => r.campaign === tag)
check('one QUEUED row staged', rows.length === 1 && rows[0].status === 'QUEUED', rows[0] ? rows[0].toEmail : 'no rows')
check('excluded address never staged', !rows.some(r => r.toEmail === 'two@example.com'))

// member wall still holds: QA seat cannot stage with leadsOf pointing at the boss
const memberTry = await call('/api/admin/exec/campaigns', {
  method: 'POST', cookie: qaCookie,
  body: { campaign: `member-forge-${Date.now().toString(36)}`, subject: 'x', body: 'member staging attempt should be refused here', leadsOf: 'cmv2lyew70000l806ylm84elw' },
})
check('member rejected on leadsOf staging', memberTry.status === 401 || memberTry.status === 403, `status ${memberTry.status}`)

// cleanup: remove the queued row while the queue is still paused, then cancel
if (rows[0]) {
  const rm = await call('/api/admin/exec/campaigns', { method: 'PATCH', cookie: exCookie, body: { campaign: tag, action: 'removeRow', rowId: rows[0].id } })
  check('test row removed', rm.status === 200, `status ${rm.status}`)
}
const cancel = await call('/api/admin/exec/campaigns', { method: 'PATCH', cookie: exCookie, body: { campaign: tag, action: 'cancel' } })
check('test queue cancelled', cancel.status === 200, `status ${cancel.status}`)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
