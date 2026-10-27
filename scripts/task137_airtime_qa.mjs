// Task 137 QA — airtime credit system, live on prod.
// Proves the full prepaid lifecycle on a fresh sandbox QA account:
//   welcome R99 loads the wallet → 6 free sends ride the free-plan sample
//   → send #7 spends R0.50 airtime AFTER the send went out (FEATURE_SPEND
//   ledger row, balance math exact) → the status quote flips ALLOWANCE→AIRTIME
//   → failed-recipient send is rejected BEFORE any charge.
// Run: node scripts/task137_airtime_qa.mjs
const BASE = 'https://www.hustleportal.online'
const TS = Date.now().toString(36)
const EMAIL = `qa-airtime-${TS}@hustleqa.example.com`
const PASSWORD = 'QaAirtime2026!'
const INBOX = 'qa-inbox@hustleqa.example.com'

let pass = 0, fail = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

let cookie = ''
async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookies = res.headers.getSetCookie?.() ?? []
  for (const c of setCookies) {
    const first = c.split(';')[0]
    if (first.startsWith('hp_session=')) cookie = first
  }
  let json = null
  try { json = await res.json() } catch { /* empty body */ }
  return { status: res.status, json }
}

async function main() {
  console.log(`QA account: ${EMAIL}`)

  // 1. Register → session + welcome credit load.
  const reg = await req('POST', '/api/auth', { action: 'register', email: EMAIL, password: PASSWORD, name: 'QA Airtime', businessName: 'QA Airtime Spaza', industry: 'RETAIL', city: 'Johannesburg' })
  check('register ok', reg.status === 200 && reg.json?.ok === true, `status ${reg.status}`)

  // 2. Wallet loaded with the welcome credit (the first airtime load).
  const w1 = await req('GET', '/api/wallet')
  const bal1 = w1.json?.wallet?.balance ?? 0
  check('welcome credit loaded (R99)', bal1 === 9900, `balance ${bal1}`)

  // 3. Status quote: ALLOWANCE mode, 6 free sends, price R0.50 visible.
  const s1 = await req('GET', '/api/emails/status')
  const q = s1.json?.spend
  check('status carries airtime quote', !!q && q.action === 'EMAIL_SEND', JSON.stringify(q ?? {}))
  check('quote mode ALLOWANCE with 6 remaining', q?.mode === 'ALLOWANCE' && q?.allowanceRemaining === 6 && q?.allowance === 6, `mode=${q?.mode} left=${q?.allowanceRemaining}`)
  check('quote price = 50c, balance = R99', q?.priceCents === 50 && q?.balanceCents === 9900, `price=${q?.priceCents} bal=${q?.balanceCents}`)

  // 4. Sends 1-6 ride the free sample, never a cent moves.
  let lastFree = null
  for (let i = 1; i <= 6; i++) {
    const r = await req('POST', '/api/emails', { to: INBOX, subject: `Airtime QA free ${i}/6`, body: 'Task 137 airtime QA — free sample send.' })
    lastFree = r
    if (r.status !== 200) break
  }
  check('all 6 sample sends went out free', lastFree?.status === 200 && lastFree.json?.spend == null && lastFree.json?.freeRemaining === 0,
    `status ${lastFree?.status} freeRemaining=${lastFree.json?.freeRemaining} spend=${JSON.stringify(lastFree.json?.spend ?? null)}`)

  const w2 = await req('GET', '/api/wallet')
  check('wallet untouched after 6 free sends', (w2.json?.wallet?.balance ?? -1) === 9900, `balance ${w2.json?.wallet?.balance}`)

  // 5. Send #7 — beyond the sample → airtime spend, debited AFTER delivery.
  const r7 = await req('POST', '/api/emails', { to: INBOX, subject: 'Airtime QA spend 7', body: 'Task 137 airtime QA — first paid send.' })
  const sp = r7.json?.spend
  check('send #7 accepted (airtime door, not the old hard stop)', r7.status === 200 && r7.json?.email?.status === 'SENT', `status ${r7.status}`)
  check('send #7 charged exactly R0.50', sp?.chargedCents === 50, JSON.stringify(sp ?? {}))
  check('send #7 balanceAfter = R98.50', sp?.balanceAfter === 9850, `after ${sp?.balanceAfter}`)

  // 6. The books: one FEATURE_SPEND ledger row, -50, honest description.
  const w3 = await req('GET', '/api/wallet')
  const row = (w3.json?.txs ?? []).find((t) => t.type === 'FEATURE_SPEND')
  check('ledger row FEATURE_SPEND -50 on the books', !!row && row.amount === -50 && /Airtime: email to/.test(row.description || ''), row ? `${row.description} @ ${row.balanceAfter}` : 'no row')
  check('wallet balance now 9850', (w3.json?.wallet?.balance ?? -1) === 9850, `balance ${w3.json?.wallet?.balance}`)

  // 7. Quote flipped to AIRTIME with the live balance.
  const s2 = await req('GET', '/api/emails/status')
  const q2 = s2.json?.spend
  check('quote mode now AIRTIME, balance shown', q2?.mode === 'AIRTIME' && q2?.allowanceRemaining === 0 && q2?.balanceCents === 9850, `mode=${q2?.mode} bal=${q2?.balanceCents}`)

  // 8. Invalid recipient → rejected before any charge (honesty law).
  const bad = await req('POST', '/api/emails', { to: 'not-an-email', subject: 'x', body: 'y' })
  check('invalid recipient rejected with no spend', bad.status === 400 && !bad.json?.spend, `status ${bad.status}`)

  // 9. Cleanup: remove the QA log rows (balance intentionally left — it is
  // sandbox credit on a sandbox account).
  const list = await req('GET', '/api/emails')
  let cleaned = 0
  for (const row2 of list.json?.emails ?? []) {
    const d = await req('DELETE', `/api/emails?id=${row2.id}`)
    if (d.status === 200) cleaned++
  }
  console.log(`  INFO cleaned ${cleaned} QA email log rows`)

  console.log(`\nRESULT ${pass} PASS / ${fail} FAIL`)
  if (fail) { console.log('Failures: ' + failures.join(' | ')); process.exit(1) }
}

main().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
