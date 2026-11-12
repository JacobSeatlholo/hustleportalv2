// Full suppression pull + final cross-reference for the Ubuntu Wave follow-on math.
// READ ONLY.
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
if (login.status !== 200) { console.log('login failed', login.status); process.exit(1) }
const cookie = cookieOf(login)
console.log('login ok')

const out = await call('/api/admin/exec/campaign', { cookie })
const rows = (out.json || {}).rows || []
const uw = rows.filter((r) => String(r.campaign || '').includes('ubuntu'))

// bounce ledger with addresses
const bounced = uw.filter((r) => String(r.status).toUpperCase() === 'BOUNCED').map((r) => r.toEmail)
writeFileSync('/tmp/uw_bounced.json', JSON.stringify(bounced, null, 2))
console.log('bounced:', bounced.length)
console.log(bounced.join('\n'))

// opens with addresses
const opened = uw.filter((r) => r.openedAt).map((r) => ({ e: r.toEmail, c: r.openCount }))
writeFileSync('/tmp/uw_opened.json', JSON.stringify(opened, null, 2))
console.log('opened:', opened.length)

// full suppression (paginate if the endpoint supports it)
let allSup = []
for (let skip = 0; skip < 2000; skip += 500) {
  const s = await call(`/api/admin/exec/suppression?skip=${skip}&take=500`, { cookie })
  if (s.status !== 200 || !s.json) break
  const items = s.json.items || s.json.rows || []
  allSup = allSup.concat(items)
  if (items.length < 500) break
}
writeFileSync('/tmp/uw_suppression.json', JSON.stringify(allSup, null, 2))
console.log('suppression pulled:', allSup.length)
