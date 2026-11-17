// ============ CORPORATE GATE: PROD MACHINE TEST (recreated 2026-11-17) ============
// The original suite was untracked and a sandbox recycle ate it. Rebuilt from
// the live contracts (src/lib/corporate.ts, the door/document/dashboard pages,
// the access/apply APIs) and asserted against today's prod truth:
//   - generic /corporate door: locked door with code + application paths, the
//     calculator, and NO trust footer (footer={false} law)
//   - partner door: open "no credit card" signup, whitelabel (0 HustlePortal
//     visible — <script> stripped so JSON-LD never masquerades as copy)
//   - every gated surface: wrong or missing key = indistinguishable 404
// Read-only by design: no accounts, no applications, no emails.
// Run: node scripts/corporate_gate_qa.mjs [baseUrl]
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const SLUG = 'trinitydirect'
const DASH_KEY = 'bh-tdc-dashboard-8v3nq5'
const ROOM_KEY = 'bh-tdc-dealroom-qx7k29'

let pass = 0, fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${extra ? ` — ${extra}` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`) }
}
async function raw(path, timeoutMs = 20000) {
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    const text = await res.text().catch(() => '')
    return { status: res.status, text, location: res.headers.get('location') }
  } catch (e) {
    return { status: 0, text: String(e && e.message || e), location: null }
  }
}
async function post(path, body, timeoutMs = 20000) {
  try {
    const res = await fetch(BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    })
    const json = await res.json().catch(() => null)
    return { status: res.status, json }
  } catch (e) {
    return { status: 0, json: { error: String(e && e.message || e) } }
  }
}
// Visible copy only: scripts/styles stripped (JSON-LD metadata is not copy).
function visible(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}
const count = (hay, needle) => hay.split(needle).length - 1

console.log('[1] generic corporate door (the locked one)')
{
  const d = await raw('/corporate')
  const vis = visible(d.text)
  check('generic door serves', d.status === 200, `status ${d.status}`)
  check('generic door shows the managed rate (R110)', d.status === 200 && vis.includes('R110'), `${count(vis, 'R110')} hits`)
  check('generic door offers the locked paths (code or application)', d.status === 200 && (vis.toLowerCase().includes('access code') || vis.toLowerCase().includes('apply')), '')
  check('generic door keeps the BH voice (HustlePortal visible)', d.status === 200 && vis.includes('HustlePortal'), '')
  check('trust footer stayed off the corporate door (no entity block)', d.status === 200 && !vis.includes('Cape Town'), '')
}

console.log('[2] partner door (the open one)')
{
  const d = await raw(`/corporate/${SLUG}`)
  const vis = visible(d.text)
  check('TDC door serves', d.status === 200, `status ${d.status}`)
  check('whitelabel law: 0 HustlePortal visible', d.status === 200 && !vis.includes('HustlePortal'), `${count(vis, 'HustlePortal')} visible hits`)
  check('Trinity Direct branding visible', d.status === 200 && vis.includes('Trinity Direct'), '')
  check('open signup: no-credit-card promise visible', d.status === 200 && vis.toLowerCase().includes('no credit card'), '')
  check('open signup: free-credit promise visible', d.status === 200 && vis.toLowerCase().includes('claim your free credit'), '')
  check('door calculator shows the corporate rate (R110)', d.status === 200 && vis.includes('R110'), `${count(vis, 'R110')} hits`)
  check('partner logo wired', d.status === 200 && d.text.includes('/corporate/trinitydirect-logo.jpg'), '')
  check('trust footer stayed off the partner door (no entity block)', d.status === 200 && !vis.includes('Cape Town'), '')
}

console.log('[3] unknown slug = a dead link, nothing else')
{
  const d = await raw('/corporate/nosuchslug')
  check('unknown slug door 404s', d.status === 404, `status ${d.status}`)
}

console.log('[4] access-code check API (brute-force gated, no happy path burned)')
{
  const bad = await post('/api/corporate/access', { code: 'qa-not-a-real-code', slug: SLUG })
  check('bogus code refused 403', bad.status === 403, `status ${bad.status}`)
  const wall = await post('/api/corporate/apply', { business: 'x' })
  check('application wall: missing fields 400', wall.status === 400, `status ${wall.status}`)
  const badEmail = await post('/api/corporate/apply', { business: 'QA Gate Co', contactName: 'QA', email: 'not-an-email', industry: 'x', leadsNeeded: 'x' })
  check('application wall: malformed email 400', badEmail.status === 400, `status ${badEmail.status}`)
}

console.log('[5] partner dashboard gate (?key=)')
{
  const wrong = await raw(`/corporate/${SLUG}/dashboard?key=wrong-key`)
  const none = await raw(`/corporate/${SLUG}/dashboard`)
  check('dashboard wrong key 404', wrong.status === 404, `status ${wrong.status}`)
  check('dashboard no key 404', none.status === 404, `status ${none.status}`)
  const right = await raw(`/corporate/${SLUG}/dashboard?key=${encodeURIComponent(DASH_KEY)}`)
  const vis = visible(right.text)
  check('dashboard right key 200', right.status === 200, `status ${right.status}`)
  check('dashboard shows the funnel metrics', right.status === 200 && vis.includes('corporate accounts opened through your door') && vis.includes('accrued share at R50 per managed lead'), '')
  check('dashboard whitelabel: 0 HustlePortal visible', right.status === 200 && !vis.includes('HustlePortal'), `${count(vis, 'HustlePortal')} visible hits`)
}

console.log('[6] partner deal room gate (?key=)')
{
  const wrong = await raw(`/corporate/${SLUG}/documents?key=wrong-key`)
  check('room wrong key 404', wrong.status === 404, `status ${wrong.status}`)
  const right = await raw(`/corporate/${SLUG}/documents?key=${encodeURIComponent(ROOM_KEY)}`)
  const vis = visible(right.text)
  check('room right key 200', right.status === 200, `status ${right.status}`)
  check('room names itself private + partner-facing', right.status === 200 && vis.includes('Private partnership room'), '')
  check('room whitelabel: 0 HustlePortal visible', right.status === 200 && !vis.includes('HustlePortal'), `${count(vis, 'HustlePortal')} visible hits`)
  check('room shows the pricing doc (family, not a version snapshot)', right.status === 200 && vis.includes('Pricing Strategy (v'), '')
  check('room links the partner dashboard with its own key', right.status === 200 && right.text.includes(`/corporate/${SLUG}/dashboard?key=`), '')
}

console.log('[7] gated APIs deny like a dead link (404, never 401/403)')
{
  const docsNone = await raw(`/api/corporate/${SLUG}/docs?file=Pricing_Strategy_Internal.pdf`)
  const docsWrong = await raw(`/api/corporate/${SLUG}/docs?file=Pricing_Strategy_Internal.pdf&key=wrong-key`)
  const esignNone = await post(`/api/corporate/${SLUG}/esign`, { file: 'Pricing_Strategy_Internal.pdf', signerName: 'x', signerEmail: 'x@y.z' })
  const uploadNone = await post(`/api/corporate/${SLUG}/esign/upload`, {})
  check('docs API no key 404', docsNone.status === 404, `status ${docsNone.status}`)
  check('docs API wrong key 404', docsWrong.status === 404, `status ${docsWrong.status}`)
  check('esign API no key 404', esignNone.status === 404, `status ${esignNone.status}`)
  check('upload API no key 404', uploadNone.status === 404, `status ${uploadNone.status}`)
}

console.log(`\n==== CORPORATE GATE: ${pass} PASS / ${fail} FAIL ====`)
process.exit(fail > 0 ? 1 : 0)
