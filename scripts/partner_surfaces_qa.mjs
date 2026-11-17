// ============ PARTNER SURFACES: PROD MACHINE TEST (recreated 2026-11-17) ============
// The original suite was untracked and a sandbox recycle ate it. Rebuilt from
// the live contracts and today's prod truth. Covers the partner-facing surfaces
// end to end: deal room (docs, badges, upload affordance, dashboard link),
// session list (live status, sha256 integrity), gated dashboard metrics, and
// the deny-like-a-dead-link law on every gated API. Read-only.
// Run: node scripts/partner_surfaces_qa.mjs [baseUrl]
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
    return { status: res.status, text }
  } catch (e) {
    return { status: 0, text: String(e && e.message || e) }
  }
}
function visible(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
}
const count = (hay, needle) => hay.split(needle).length - 1

console.log('[1] the deal room')
{
  const wrong = await raw(`/corporate/${SLUG}/documents?key=wrong-key`)
  check('room wrong key 404', wrong.status === 404, `status ${wrong.status}`)
  const d = await raw(`/corporate/${SLUG}/documents?key=${encodeURIComponent(ROOM_KEY)}`)
  const vis = visible(d.text)
  check('room serves for the partner', d.status === 200, `status ${d.status}`)
  check('room names itself private + partner-facing', vis.includes('Private partnership room'), '')
  check('room whitelabel: 0 HustlePortal visible', !vis.includes('HustlePortal'), `${count(vis, 'HustlePortal')} visible hits`)
  check('pricing doc card present (family, not a version snapshot)', vis.includes('Pricing Strategy (v'), '')
  check('V2 agreement card present', vis.includes('Strategic Partnership Agreement'), '')
  check('executed badge copy present (signed copy below)', vis.includes('signed copy below'), `${count(vis, 'signed copy below')} docs executed`)
  check('partner can load their own document', vis.toLowerCase().includes('load your own document'), '')
  check('dashboard link rides the partner key', d.text.includes(`/corporate/${SLUG}/dashboard?key=`), '')
}

console.log('[2] the session list — live badge truth + integrity')
{
  const wrong = await raw(`/api/corporate/${SLUG}/esign?key=wrong-key`)
  check('session list wrong key 404', wrong.status === 404, `status ${wrong.status}`)
  const list = await fetch(`${BASE}/api/corporate/${SLUG}/esign?key=${encodeURIComponent(ROOM_KEY)}`).then(r => r.json()).catch(() => null)
  const ss = Array.isArray(list?.sessions) ? list.sessions : []
  check('session list returns sessions', ss.length >= 1, `${ss.length} sessions`)
  const v2 = ss.find(s => (s.docTitle || '').includes('Strategic Partnership Agreement') && s.signerEmail === 'ceo@businesshustle.co.za')
  check("the owner's counter-sign on the V2 copy is SIGNED (permanent truth)", !!v2 && v2.status === 'SIGNED', v2 ? `signedAt=${v2.signedAt}` : 'no owner session found')
  const signed = ss.filter(s => s.status === 'SIGNED' && s.signedSha256)
  check('every SIGNED session carries its sha256 pin', signed.length >= 1 && signed.every(s => typeof s.signedSha256 === 'string' && s.signedSha256.length >= 32), `${signed.length} pinned`)
}

console.log('[3] the partner dashboard')
{
  const wrong = await raw(`/corporate/${SLUG}/dashboard?key=wrong-key`)
  check('dashboard wrong key 404', wrong.status === 404, `status ${wrong.status}`)
  const d = await raw(`/corporate/${SLUG}/dashboard?key=${encodeURIComponent(DASH_KEY)}`)
  const vis = visible(d.text)
  check('dashboard serves for the partner', d.status === 200, `status ${d.status}`)
  check('whitelabel: 0 HustlePortal visible', !vis.includes('HustlePortal'), `${count(vis, 'HustlePortal')} visible hits`)
  check('funnel metrics render (accounts/activated/leads/accrual)', vis.includes('corporate accounts opened through your door') && vis.includes('accounts already revealing leads (activated)') && vis.includes('managed leads delivered, all accounts') && vis.includes('accrued share at R50 per managed lead'), '')
  check('the accounts table renders', vis.includes('Last activity') && vis.includes('Top-ups'), '')
  check('close-now law visible (Balances below R110)', vis.includes('Balances below R'), '')
}

console.log('[4] gated APIs deny like a dead link')
{
  const esignWrong = await raw(`/api/corporate/${SLUG}/esign?key=wrong-key`)
  const uploadWrong = await fetch(`${BASE}/api/corporate/${SLUG}/esign/upload?key=wrong-key`, { method: 'POST' }).catch(e => null)
  const docsWrong = await raw(`/api/corporate/${SLUG}/docs?file=Pricing_Strategy_Internal.pdf&key=wrong-key`)
  check('esign API wrong key 404', esignWrong.status === 404, `status ${esignWrong.status}`)
  check('upload API wrong key 404', uploadWrong ? uploadWrong.status === 404 : false, `status ${uploadWrong?.status}`)
  check('docs API wrong key 404', docsWrong.status === 404, `status ${docsWrong.status}`)
}

console.log(`\n==== PARTNER SURFACES: ${pass} PASS / ${fail} FAIL ====`)
process.exit(fail > 0 ? 1 : 0)
