// Ubuntu Wave read-only truth: login (canonical seat), pull exec campaigns,
// aggregate the u-ubuntu-november-offer ledger, check for any other u- queues,
// count suppression + Ubuntu account leads. READ ONLY — nothing is sent,
// nothing is staged, no state is touched.
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
if (!cookie) { console.log('NO COOKIE — stop'); process.exit(1) }

const out = await call('/api/admin/exec/campaign', { cookie })
console.log('campaign GET:', out.status)
const data = out.json || {}
console.log('summary:', JSON.stringify(data.summary).slice(0, 400))
const rows = data.rows || []
console.log('rows in window:', rows.length)

// aggregate per campaign
const byCamp = new Map()
for (const r of rows) {
  const k = r.campaign || r.label || '(none)'
  const agg = byCamp.get(k) || { rows: 0, states: {}, opened: 0, addresses: new Set() }
  agg.rows++
  const st = String(r.status || '?').toUpperCase()
  agg.states[st] = (agg.states[st] || 0) + 1
  if (r.openedAt) agg.opened++
  if (r.to || r.email) agg.addresses.add((r.to || r.email).toLowerCase())
  byCamp.set(k, agg)
}
console.log('\n== all campaigns ==')
for (const [k, v] of byCamp) {
  console.log(`- ${k}: rows=${v.rows} states=${JSON.stringify(v.states)} opened=${v.opened}`)
}

// the Ubuntu wave in detail
const UW = rows.filter((r) => String(r.campaign || '').includes('ubuntu') || String(r.label || '').includes('ubuntu'))
console.log(`\n== ubuntu rows: ${UW.length} ==`)
const uwStates = {}
for (const r of UW) {
  const st = String(r.status || '?').toUpperCase()
  uwStates[st] = (uwStates[st] || 0) + 1
}
console.log('states:', JSON.stringify(uwStates))
const uwOpened = UW.filter((r) => r.openedAt).length
const sent = UW.filter((r) => String(r.status).toUpperCase() === 'SENT').length
console.log(`sent=${sent} opened=${uwOpened} openRate=${sent ? ((uwOpened / sent) * 100).toFixed(1) : 0}%`)
// bounce addresses sample
const bounced = UW.filter((r) => String(r.status).toUpperCase() === 'BOUNCED')
console.log('bounced sample:', bounced.slice(0, 8).map((r) => r.to || r.email))
// last send time
const times = UW.map((r) => r.sentAt || r.updatedAt).filter(Boolean).sort()
console.log('send window:', times[0], '->', times[times.length - 1])

// any other u- tagged campaign / wave 2 staged?
const utags = [...byCamp.keys()].filter((k) => k.startsWith('u-') || k.toLowerCase().includes('ubuntu'))
console.log('\nu- campaigns:', utags)

// suppression count
const sup = await call('/api/admin/exec/suppression', { cookie })
console.log('\nsuppression GET:', sup.status, sup.json ? JSON.stringify(sup.json).slice(0, 300) : '')

// leads on the Ubuntu account (imported Wave 1 book)
const leads = await call('/api/admin/exec/leads?take=1', { cookie })
console.log('leads probe:', leads.status, leads.json ? JSON.stringify(leads.json).slice(0, 200) : '')
