// Local QA for the meeting-minutes feature (Task: notes/minutes on events).
// Boots against a local dev server: register a QA user, create an appointment
// (no clientEmail so no invite attempt), PATCH minutes, GET verifies the field
// rides, PATCH empty clears it. Run: node scripts/minutes_local_qa.mjs
const BASE = process.env.QA_BASE || 'http://localhost:3000'

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ` :: ${extra}` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`) }
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  let json = null
  try { json = await res.json() } catch { /* empty */ }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') }
}
const cookieOf = (res) => (res.setCookie || '').split(';')[0] || null

async function main() {
  console.log('== Meeting minutes local QA ==')
  const stamp = Date.now()
  const email = `minutes_qa_${stamp}@hustleqa.example.com`
  const reg = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'QaMinutes2026!', name: 'Minutes QA', businessName: 'QA Calls', city: 'Cape Town' } })
  check('QA user registered', reg.status === 200, `status ${reg.status}`)
  const cookie = cookieOf(reg)
  if (!cookie) { console.log('no cookie, abort'); process.exit(1) }

  // 1. Create an appointment (no clientEmail — no invite path at all)
  const startsAt = new Date(Date.now() + 3600_000).toISOString()
  const created = await call('/api/appointments', {
    method: 'POST', cookie,
    body: { title: 'Discovery call, QA Spa', clientName: 'Thabo', startsAt, endsAt: new Date(Date.now() + 5400_000).toISOString(), notes: 'Bring the quote' },
  })
  check('appointment created', [200, 201].includes(created.status) && !!created.json?.appointment?.id, `status ${created.status}`)
  const id = created.json?.appointment?.id
  if (!id) process.exit(1)
  check('new appointment carries minutes null', created.json.appointment.minutes == null)

  // 2. PATCH minutes — the during-the-call save
  const patched = await call(`/api/appointments/${id}`, {
    method: 'PATCH', cookie,
    body: { minutes: 'Quote R4 500, they confirm Friday. Wants the site live before launch day.' },
  })
  check('minutes PATCH accepted', patched.status === 200, `status ${patched.status}`)
  check('minutes stored verbatim', (patched.json?.appointment?.minutes || '').includes('confirm Friday'), patched.json?.appointment?.minutes?.slice(0, 50))

  // 3. GET rides the field (upcoming scope)
  const list = await call('/api/appointments?scope=upcoming', { cookie })
  const row = (list.json?.appointments || []).find((a) => a.id === id)
  check('GET carries minutes', !!row && row.minutes?.includes('confirm Friday'))
  check('agenda notes untouched', !!row && row.notes === 'Bring the quote')

  // 4. Whitespace-only save stores null (honest empty, not whitespace)
  const wsPatch = await call(`/api/appointments/${id}`, { method: 'PATCH', cookie, body: { minutes: '   ' } })
  check('whitespace save clears to null', wsPatch.status === 200 && wsPatch.json?.appointment?.minutes === null)

  // 5. Re-save + clear cycle
  const re = await call(`/api/appointments/${id}`, { method: 'PATCH', cookie, body: { minutes: 'Round two: deposit paid.' } })
  check('re-save works', re.status === 200 && re.json?.appointment?.minutes === 'Round two: deposit paid.')
  const clear = await call(`/api/appointments/${id}`, { method: 'PATCH', cookie, body: { minutes: '' } })
  check('empty save clears', clear.status === 200 && clear.json?.appointment?.minutes === null)

  // 6. Ownership wall: another session cannot touch the minutes
  const other = await call('/api/auth', { method: 'POST', body: { action: 'register', email: `minutes_other_${stamp}@hustleqa.example.com`, password: 'QaMinutes2026!', name: 'Other QA', businessName: 'Other Co', city: 'Durban' } })
  const otherCookie = cookieOf(other)
  const forbidden = await call(`/api/appointments/${id}`, { method: 'PATCH', cookie: otherCookie, body: { minutes: 'hijack' } })
  check('other session gets 404', forbidden.status === 404, `status ${forbidden.status}`)

  // 7. Cleanup: delete the QA appointment
  const del = await call(`/api/appointments/${id}`, { method: 'DELETE', cookie })
  check('cleanup delete ok', del.status === 200)

  console.log(`\nRESULT: ${pass}/${pass + fail} PASS`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('QA crashed:', e); process.exit(1) })
