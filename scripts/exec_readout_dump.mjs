// Exec read-out dump: campaigns overview, queue states, named-row hunt.
// Run: node scripts/exec_readout_dump.mjs  (ops seat via env or canonical)
import { writeFileSync } from 'node:fs'

const BASE = 'https://www.hustleportal.online'
const EMAIL = process.env.OPS_SEAT_EMAIL || 'ops@hustleqa.example.com'
const PASS = process.env.OPS_SEAT_PASSWORD || 'OpsSeat2026!Hustle'

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

const login = await call('/api/auth', { method: 'POST', body: { action: 'login', email: EMAIL, password: PASS } })
console.log('login:', login.status)
const cookie = cookieOf(login)
if (!cookie) process.exit(1)

const out = await call('/api/admin/exec/campaign', { cookie })
console.log('campaign GET:', out.status)
const data = out.json || {}
console.log('summary:', JSON.stringify(data.summary))

const rows = data.rows || []
console.log('rows:', rows.length)
writeFileSync('/tmp/exec_campaign_rows.json', JSON.stringify(data, null, 2))

// distinct campaigns with queued/sent/failed/opened counts
const byCamp = new Map()
for (const r of rows) {
  const k = r.campaign || r.label || '(none)'
  const agg = byCamp.get(k) || { rows: 0, queued: 0, sent: 0, failed: 0, opened: 0, states: {} }
  agg.rows++
  const st = String(r.status || '?').toUpperCase()
  agg.states[st] = (agg.states[st] || 0) + 1
  if (st === 'QUEUED') agg.queued++
  if (st === 'SENT') agg.sent++
  if (st === 'FAILED') agg.failed++
  if (r.openedAt) agg.opened++
  byCamp.set(k, agg)
}
console.log('\n== campaigns ==')
for (const [k, v] of byCamp) {
  console.log(`- ${k}: rows=${v.rows} states=${JSON.stringify(v.states)} opened=${v.opened}`)
}

// hunt named rows
const hunt = (needle) => {
  const hits = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle.toLowerCase()))
  console.log(`\n== hunt "${needle}": ${hits.length} ==`)
  for (const h of hits.slice(0, 10)) console.log('-', JSON.stringify(h).slice(0, 400))
}
hunt('avenzara')
hunt('kabir')
hunt('yindee')

// treg balance
const ver = await call('/api/admin/exec/pool/verify', { cookie })
console.log('\npool/verify:', ver.status)
if (ver.json) {
  console.log('treg:', JSON.stringify(ver.json.treg))
  console.log('budget:', JSON.stringify(ver.json.budget?.capUsd != null ? { cap: ver.json.budget.capUsd, spent: ver.json.budget.spentUsd, remaining: ver.json.budget.remainingUsd } : ver.json.budget))
}
