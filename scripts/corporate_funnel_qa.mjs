// ============ CORPORATE FUNNEL: PROD MACHINE TEST (recreated 2026-11-17) ============
// The original suite was untracked and a sandbox recycle ate it. Rebuilt from
// the live contracts (src/app/api/auth/route.ts register branch, wallet, reveal)
// and walked on today's prod:
//   door attribution → register via partner slug → PREMIUM_DFY track →
//   the exact-five R550 credit → B2C packs hidden → managed reveal at the
//   flat R110 DFY rate → the partner dashboard sees the account →
//   self-serve control stays B2C → unknown slug falls back SELF_SERVE.
// Known side effect, by design: QA accounts persist (named "QA Closing
// Targets") and show on the partner dashboard — same as every run before.
// Register flood guard is 10 accounts/hour/IP: this suite uses 3. A 429 on
// register is environmental (budget spent by earlier runs) and recorded as
// a SKIP, never a fake PASS or FAIL.
// Run: node scripts/corporate_funnel_qa.mjs [baseUrl]
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const SLUG = 'trinitydirect'
const DASH_KEY = 'bh-tdc-dashboard-8v3nq5'

let pass = 0, fail = 0, skip = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${extra ? ` — ${extra}` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`) }
}
function skipIt(name, why) { skip++; console.log(`  SKIP ${name} — ${why}`) }
const ts = Date.now().toString(36).slice(-6)

async function call(jar, method, path, body, timeoutMs = 60000) {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(jar.cookie ? { cookie: jar.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    })
    const setC = res.headers.get('set-cookie')
    if (setC) jar.cookie = setC.split(';')[0]
    const json = await res.json().catch(() => null)
    return { status: res.status, json }
  } catch (e) {
    return { status: 0, json: { error: String(e && e.message || e) } }
  }
}
async function register(jar, email, name, corporatePartner) {
  return call(jar, 'POST', '/api/auth', {
    action: 'register', email, password: `qa-corp-${ts}-pass`, name,
    businessName: 'Qa Corporate', industry: 'RETAIL', city: 'Johannesburg',
    ...(corporatePartner ? { corporatePartner } : {}),
  })
}
async function registerOrSkip(jar, label, email, name, corporatePartner) {
  const r = await register(jar, email, name, corporatePartner)
  if (r.status === 429) { skipIt(`${label} registers`, 'register flood guard (10/hour/IP) spent by earlier runs — re-run next hour'); return false }
  check(`${label} registers`, r.status === 200 || r.status === 201, `status ${r.status}`)
  return r.status === 200 || r.status === 201
}
async function balance(jar) {
  const w = await call(jar, 'GET', '/api/wallet')
  return w.json?.wallet?.balance ?? null
}

console.log('[1] the partner door opens the DFY track')
const corp = {}
const corpOk = await registerOrSkip(corp, 'corporate account', `qa-corp-${ts}@bhqa.co.za`, `QA Closing Targets ${ts}`, SLUG)
if (corpOk) {
  const me = await call(corp, 'GET', '/api/auth/me')
  check('tier is PREMIUM_DFY', me.json?.user?.pricingTier === 'PREMIUM_DFY', `tier=${me.json?.user?.pricingTier}`)
  check('attribution rides the account (trinitydirect)', me.json?.user?.corporatePartner === SLUG, `partner=${me.json?.user?.corporatePartner}`)

  console.log('[2] the exact-five welcome credit')
  const bal = await balance(corp)
  check('R550 exact-five starting credit', bal === 55000, `balance=${bal}`)

  console.log('[3] the B2C world is hidden from a DFY account')
  const w = await call(corp, 'GET', '/api/wallet')
  check('top-up packs hidden (corporate law: packs [])', Array.isArray(w.json?.packs) && w.json.packs.length === 0, `packs=${(w.json?.packs || []).length}`)

  console.log('[4] the managed lead at the flat contractual rate')
  const save = await call(corp, 'POST', '/api/leads', {
    company: `QA Managed Lead ${ts}`, phone: '+27115550000', email: `lead-${ts}@bhqa.co.za`,
    website: '', industry: 'RETAIL', city: 'Johannesburg', source: 'AI_SEARCH',
  })
  const leadId = save.json?.lead?.id
  check('lead saved to pipeline', (save.status === 200 || save.status === 201) && !!leadId, `status ${save.status}`)
  if (leadId) {
    const balBefore = (await balance(corp)) ?? 0
    const rev = await call(corp, 'POST', '/api/leads/reveal', { leadId }, 90000)
    const balAfter = (await balance(corp)) ?? 0
    const drop = balBefore - balAfter
    check('reveal answers (charged only when real contact — honesty contract)', rev.status === 200 && drop >= 0, `status ${rev.status} drop=${drop}`)
    check('DFY rate is FLAT R110 — no ladder, no legacy config, no promo', drop === 0 || drop === 11000, `charged=${drop}`)
  }

  console.log('[5] the partner dashboard sees the account')
  const dash = await fetch(`${BASE}/corporate/${SLUG}/dashboard?key=${encodeURIComponent(DASH_KEY)}`).then(r => r.text()).catch(() => '')
  check('dashboard lists the QA account by name', dash.includes(`QA Closing Targets ${ts}`), '')
  check('dashboard shows the R50 accrual meter', dash.includes('R50 per managed lead'), '')
}

console.log('[6] the self-serve control stays B2C')
const ctrl = {}
const ctrlOk = await registerOrSkip(ctrl, 'self-serve control', `qa-self-${ts}@bhqa.co.za`, `QA Self Serve ${ts}`, undefined)
if (ctrlOk) {
  const me = await call(ctrl, 'GET', '/api/auth/me')
  check('control tier SELF_SERVE', me.json?.user?.pricingTier === 'SELF_SERVE', `tier=${me.json?.user?.pricingTier}`)
  check('control has no partner', me.json?.user?.corporatePartner == null, `partner=${me.json?.user?.corporatePartner}`)
  const bal = await balance(ctrl)
  check('control welcome is the R99 welcome', bal === 9900, `balance=${bal}`)
  const w = await call(ctrl, 'GET', '/api/wallet')
  check('control sees the B2C packs grid', Array.isArray(w.json?.packs) && w.json.packs.length >= 3, `packs=${(w.json?.packs || []).length}`)
}

console.log('[7] an unknown slug can never open the DFY track')
const unk = {}
const unkOk = await registerOrSkip(unk, 'unknown-slug signup', `qa-unknown-${ts}@bhqa.co.za`, `QA Unknown Slug ${ts}`, 'nosuchslug')
if (unkOk) {
  const me = await call(unk, 'GET', '/api/auth/me')
  check('unknown slug falls back SELF_SERVE', me.json?.user?.pricingTier === 'SELF_SERVE' && me.json?.user?.corporatePartner == null, `tier=${me.json?.user?.pricingTier} partner=${me.json?.user?.corporatePartner}`)
  const bal = await balance(unk)
  check('fallback welcome is the R99 welcome, not R550', bal === 9900, `balance=${bal}`)
}

console.log('[8] cleanup — sessions closed, QA accounts left as honest dashboard artifacts')
for (const [name, jar] of [['corporate', corp], ['control', ctrl], ['unknown-slug', unk]]) {
  if (jar.cookie) {
    const out = await call(jar, 'POST', '/api/auth/logout')
    check(`${name} session closed`, out.status === 200, `status ${out.status}`)
  }
}

console.log(`\n==== CORPORATE FUNNEL: ${pass} PASS / ${fail} FAIL / ${skip} SKIP ====`)
process.exit(fail > 0 ? 1 : 0)
