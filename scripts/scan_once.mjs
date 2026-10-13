/**
 * Minimal one shot scan: register + ONE real discover scan. Nothing else, so
 * the tiny request per minute budget of a fresh GLM account is respected.
 */
const BASE = 'https://www.hustleportal.online'
let cookie = ''
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
  body: JSON.stringify({ action: 'register', email: `scan_${stamp}@hustleqa.example.com`, password: `Qa!${stamp}x`, name: 'Scan Probe' }),
})
console.log('register', reg.status)
const disc = await req('/api/leads/discover', {
  method: 'POST',
  body: JSON.stringify({ definition: 'taverns and shebeens that need security services', city: 'Soweto', limit: 3, debug: true }),
})
console.log('discover', disc.status)
const j = await disc.json().catch(() => null)
console.log('mode:', j?.mode)
console.log('glmTrace:', JSON.stringify(j?.glmTrace || [], null, 1))
console.log('notice:', j?.notice || '(none)')
console.log('note:', j?.note || '(none)')
console.log('leads:', (j?.leads || []).length)
for (const l of (j?.leads || []).slice(0, 5)) {
  console.log(`  - ${l.company} | ${l.city || '?'} | ${l.phone || 'no phone'} | ${l.website || 'no site'} | score ${l.score ?? '?'}`)
}
process.exit(0)
