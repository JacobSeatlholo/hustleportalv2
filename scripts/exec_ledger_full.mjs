// Full exec ledger: per-campaign queued/sent/failed/bounced/skipped from the
// newest-2000 window + queue states + named-row hunt (kabir/avenzara).
import { writeFileSync } from 'node:fs'

const BASE = 'https://www.hustleportal.online'
const EMAIL = 'ops@hustleqa.example.com'
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

const out = await call('/api/admin/exec/campaigns', { cookie })
console.log('campaigns GET:', out.status, 'sesConfigured:', out.json?.sesConfigured)
const rows = out.json?.rows || []
console.log('rows in window:', rows.length)
writeFileSync('/tmp/exec_campaigns_full.json', JSON.stringify(out.json, null, 2))

console.log('\n== campaign cards (window) ==')
for (const c of out.json?.campaigns || []) {
  const s = c.summary
  const st = c.state ? `state=${c.state.status || c.state.state || '?'} perHour=${c.state.perHour ?? '?'}` : 'state=null'
  console.log(`- ${c.tag}: queued=${s.queued} sent=${s.sent} failed=${s.failed} bounced=${s.bounced} skipped=${s.skipped} opened=${s.opened} total=${s.total} | ${st}`)
}

const oldest = rows.length ? rows[rows.length - 1] : null
console.log('\noldest row in window:', oldest ? `${oldest.createdAt} ${oldest.campaign} ${oldest.toEmail}` : 'none')

const totalQueued = (out.json?.campaigns || []).reduce((a, c) => a + c.summary.queued, 0)
console.log('TOTAL QUEUED in window:', totalQueued)

// named hunts
for (const needle of ['kabir', 'avenzara']) {
  const hits = rows.filter((r) => `${r.toEmail} ${r.subject} ${r.campaign}`.toLowerCase().includes(needle))
  console.log(`\n== hunt "${needle}": ${hits.length} ==`)
  for (const h of hits.slice(0, 5)) {
    console.log(`- ${h.createdAt} | ${h.campaign} | ${h.toEmail} | ${h.status} | opened=${h.openedAt || 'no'} count=${h.openCount ?? 0}`)
  }
}
