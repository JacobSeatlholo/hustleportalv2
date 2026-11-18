// ============ CORPORATE GATE: PROD MACHINE TEST (recreated 2026-11-17) ============
// The original suite was untracked and a sandbox recycle ate it. Rebuilt from
// the live contracts (src/lib/corporate.ts, the door/document/dashboard pages,
// the access/apply APIs) and asserted against today's prod truth:
//   - generic /corporate door: locked door with code + application paths, the
//     calculator, and NO trust footer (footer={false} law)
//   - partner door: open "no credit card" signup, whitelabel (0 HustlePortal
//     visible — <script> stripped so JSON-LD never masquerades as copy)
//   - every gated surface: wrong or missing key = indistinguishable 404
//   - Task 219: /app reachable on every host (the funnel end + login entry),
//     the door links it, and the testimonial wall obeys the approval law —
//     a submitted story stays hidden until the desk (the internal ops exec
//     seat) approves it, then it shows on the wall and the door, then the
//     suite deletes it (self-cleaning; the only side effects are one desk
//     notification mail and a rate-limit hit).
// Mostly read-only: no accounts persist, no applications, no leftover rows.
// Run: node scripts/corporate_gate_qa.mjs [baseUrl]
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const SUB = 'https://app.trinitydirect.co.za'
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
async function post(path, body, cookie = '', timeoutMs = 20000) {
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    })
    const json = await res.json().catch(() => null)
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') }
  } catch (e) {
    return { status: 0, json: { error: String(e && e.message || e) }, setCookie: null }
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
  // Task 216/217 offer-asymmetry law (boss): the generic door carries the
  // R120 access-code credit, routes the R550 to the strategist doors, and
  // never promises the R550 as a direct claim — every circumvention lands on
  // a cheaper rung, never a better one.
  check('offer asymmetry: R120 code credit visible', d.status === 200 && vis.includes('R120'), `${count(vis, 'R120')} hits`)
  check('offer asymmetry: R550 routed to the brand strategist', d.status === 200 && vis.includes('R550') && vis.toLowerCase().includes('strategist'), '')
  check('offer asymmetry: no direct R550 claim promise', d.status === 200 && !/claim (your|my) R550/i.test(vis), '')
  // The location field renders client-side after the tab switch, so the static
  // HTML cannot prove it. Prove the behaviour instead: an application without
  // a location is rejected by the survey API (validation runs before any rate
  // limit or row write, so the probe leaves nothing behind).
  const ap = await post('/api/corporate/apply', { business: 'Gate QA Probe', contactName: 'Gate QA', email: 'qa-gate217@noise.invalid', industry: 'QA probe', leadsNeeded: '50' })
  check('Task 217: apply survey demands where the business operates', ap.status === 400 && typeof ap.json?.error === 'string' && ap.json.error.toLowerCase().includes('where your business operates'), `status ${ap.status} error ${ap.json?.error ?? ''}`)
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
  check('open signup: the R550 credit stays visible (the strategist door advantage)', d.status === 200 && vis.includes('R550'), `${count(vis, 'R550')} hits`)
  check('door calculator shows the corporate rate (R110)', d.status === 200 && vis.includes('R110'), `${count(vis, 'R110')} hits`)
  check('partner logo wired', d.status === 200 && d.text.includes('/corporate/trinitydirect-logo.jpg'), '')
  check('trust footer stayed off the partner door (no entity block)', d.status === 200 && !vis.includes('Cape Town'), '')
  // Task 217 (boss): the sweetener is a real, enforced fact — DFY accounts get
  // a 200/day engine allowance in the scan gate, and the door states it.
  check('Task 217 sweetener: 200 lead searches a day stated', d.status === 200 && vis.includes('200') && vis.toLowerCase().includes('lead searches a day'), '')
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

console.log('[8] Task 219: /app is the product entry on every host, the door links it')
{
  const door = await raw(`/corporate/${SLUG}`)
  check('door links Sign in at /app (login entry on his own domain)', door.text.includes('href="/app?signin=1"'), '')
  const appPage = await raw('/app?signin=1')
  check('/app serves the product entry on the main domain', appPage.status === 200, `status ${appPage.status}`)
  check('/app boots to the login tab via ?signin=1', appPage.status === 200 && visible(appPage.text).includes('Sign in'), '')
  const subDoor = await fetch(`${SUB}/`, { signal: AbortSignal.timeout(20000) }).then(r => r.text()).catch(() => '')
  check('subdomain serves the strategist door', subDoor.includes('Claim your R550 credit'), '')
  check('subdomain door carries the login entry too', subDoor.includes('/app?signin=1'), '')
  const subApp = await fetch(`${SUB}/app?signin=1`, { signal: AbortSignal.timeout(20000) }).then(r => ({ s: r.status, t: r.text() })).then(async x => ({ s: x.s, t: await x.t }))
  check('subdomain /app serves the product entry (funnel completes there)', subApp.s === 200 && subApp.t.includes('Sign in'), `status ${subApp.s}`)
}

console.log('[9] Task 219: testimonials — hidden until the desk says yes')
{
  const ts = Date.now()
  const sub = await post('/api/testimonials', {
    name: `QA Story ${ts}`, business: 'QA Enterprises', location: 'Cape Town',
    body: `The verified leads pipeline kept our sellers selling through QA run ${ts}.`, rating: 5, slug: SLUG,
  })
  check('testimonial submits ok', sub.status === 200 && sub.json?.ok === true, `status ${sub.status}`)
  const id = sub.json?.id
  const pub = await fetch(`${BASE}/api/testimonials?slug=${SLUG}`).then(r => r.json()).catch(() => null)
  check('pending story is NOT on the public wall', Array.isArray(pub?.testimonials) && !pub.testimonials.some(t => t.id === id), '')
  check('pending story is NOT on the door HTML', !(await raw(`/corporate/${SLUG}`)).text.includes(`QA Story ${ts}`), '')
  // Moderation rides the internal ops exec seat (the established automation
  // identity on prod: same gate as the boss's own, flagged internal on every
  // roster lens). Login → approve → live → delete → gone. No db access needed.
  const deny = await post('/api/admin/exec/testimonials', { id, action: 'approve' })
  check('moderation is exec-only (unauthed 401)', deny.status === 401, `status ${deny.status}`)
  const login = await post('/api/auth', { action: 'login', email: 'ops@hustleqa.example.com', password: process.env.OPS_SEAT_PASSWORD || 'OpsSeat2026!Hustle' })
  const cookie = (login.setCookie || '').split(';')[0]
  if (login.status === 200 && cookie) {
    const ap = await post('/api/admin/exec/testimonials', { id, action: 'approve' }, cookie)
    check('desk approves the story', ap.status === 200 && ap.json?.ok === true, `status ${ap.status}`)
    const pub2 = await fetch(`${BASE}/api/testimonials?slug=${SLUG}`).then(r => r.json()).catch(() => null)
    check('approved story is live on the public wall', Array.isArray(pub2?.testimonials) && pub2.testimonials.some(t => t.id === id), '')
    check('approved story shows on the door HTML', (await raw(`/corporate/${SLUG}`)).text.includes(`QA Story ${ts}`), '')
    const del = await post('/api/admin/exec/testimonials', { id, action: 'delete' }, cookie)
    const pub3 = await fetch(`${BASE}/api/testimonials?slug=${SLUG}`).then(r => r.json()).catch(() => null)
    check('desk deletes the story (suite leaves no artifact)', del.status === 200 && Array.isArray(pub3?.testimonials) && !pub3.testimonials.some(t => t.id === id), '')
  } else {
    check('ops exec seat available for the moderation leg', false, `status ${login.status} cookie=${!!cookie}`)
  }
}

console.log(`\n==== CORPORATE GATE: ${pass} PASS / ${fail} FAIL ====`)
process.exit(fail > 0 ? 1 : 0)
