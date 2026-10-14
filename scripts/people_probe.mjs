/**
 * People Pass probe: register + one real scan + inspect the human fields
 * (contactName / role / profileUrl), then save a lead to the pipeline and
 * confirm the human rides along. Honest about a drained grounding day.
 */
const BASE = 'https://www.hustleportal.online'
let cookie = ''
let pass = 0, fail = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || 58_000),
  })
  const sc = res.headers.get('set-cookie')
  if (sc && !cookie) cookie = sc.split(';')[0]
  return res
}
const stamp = Date.now()
const reg = await req('/api/auth', {
  method: 'POST',
  body: JSON.stringify({ action: 'register', email: `people_${stamp}@hustleqa.example.com`, password: `Qa!${stamp}x`, name: 'People Probe' }),
})
console.log('register', reg.status)

const disc = await req('/api/leads/discover', {
  method: 'POST',
  body: JSON.stringify({ definition: 'taverns and shebeens that need security services', city: 'Soweto', limit: 5, debug: true }),
  timeoutMs: 90_000,
})
console.log('discover', disc.status)
const j = await disc.json().catch(() => null)
const leads = j?.leads || []
console.log('mode:', j?.mode, '| leads:', leads.length)
const gemTrace = j?.geminiTrace || []
const peopleCall = gemTrace.find((t) => typeof t === 'string' && t.toLowerCase().includes('people'))
const named = leads.filter((l) => l.contactName)
const linked = leads.filter((l) => l.profileUrl)
check('scan returns real leads', leads.length > 0 && leads.every((l) => l.company), `${leads.length} leads`)
for (const l of leads) {
  console.log(`   ${l.company}${l.contactName ? ` | ${l.contactName}${l.role ? ` (${l.role})` : ''}` : ''}${l.profileUrl ? ` | ${l.profileUrl}` : ''}${l.phone ? ` | ${l.phone}` : ''}`)
}
if (named.length > 0) {
  check('named humans present on leads', named.every((l) => typeof l.contactName === 'string' && l.contactName.length >= 3), `${named.length}/${leads.length} named`)
  if (linked.length > 0) check('profile links are real urls', linked.every((l) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(l.profileUrl)), `${linked.length} linked`)
  else console.log('  NOTE no public profile pages surfaced this scan (honest omission)')
} else {
  console.log('  NOTE no humans named this scan — grounding day state:', gemTrace.length ? gemTrace.slice(0, 2).join(' | ') : 'no gemini trace')
  check('scan still delivers leads without names (honest floor)', leads.length > 0, `${leads.length} leads`)
}

// human rides into the pipeline (deterministic: inject test values when the scan named no one)
if (leads[0]?.company) {
  const human = {
    contactName: leads[0].contactName || 'Sipho Probe',
    role: leads[0].role || 'Owner',
    profileUrl: leads[0].profileUrl || 'https://www.linkedin.com/in/sipho-probe',
  }
  const save = await req('/api/leads', {
    method: 'POST',
    body: JSON.stringify({ company: leads[0].company, contactName: human.contactName, role: human.role, profileUrl: human.profileUrl, phone: leads[0].phone || '', website: leads[0].website || '', industry: leads[0].industry || '', city: leads[0].city || '', source: j?.mode || 'OSM' }),
  })
  const saved = await save.json().catch(() => null)
  check('save with human fields works', save.status === 200 && !!saved?.lead?.id, `status ${save.status}`)
  const list = await req('/api/leads')
  const lj = await list.json().catch(() => null)
  const row = (lj?.leads || lj || []).find?.((x) => x.company === leads[0].company)
  check(
    'human fields persist in pipeline',
    Boolean(row && row.contactName === human.contactName && row.role === human.role && row.profileUrl === human.profileUrl),
    row ? `name=${row.contactName || 'none'} role=${row.role || 'none'} profile=${row.profileUrl ? 'yes' : 'none'}` : 'row not found'
  )
}

console.log(`\nRESULT: ${pass}/${pass + fail} PASS`)
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1) }
