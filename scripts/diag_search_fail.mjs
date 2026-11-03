// Diagnose the user report: "I tried out the search it failed twice and only
// worked when I said coffee shop." READ-ONLY evidence run on production:
// one throwaway QA account (the repo's established hustleqa.example.com
// pattern), three discover scans with debug:true to capture mode, note and
// the engine traces. Nothing is saved, mailed or sent anywhere; the QA
// account scans free lanes only (platform Gemini free tier, platform GLM
// search which refuses unpaid, OSM keyless directory).
const BASE = 'https://www.hustleportal.online'
let cookie = ''

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || 90_000),
  })
  const sc = res.headers.get('set-cookie')
  if (sc && !cookie) cookie = sc.split(';')[0]
  return res
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function scan(label, definition, city) {
  const t0 = Date.now()
  const res = await req('/api/leads/discover', {
    method: 'POST',
    body: JSON.stringify({ definition, city: city || '', limit: 5, debug: true }),
  })
  const j = await res.json().catch(() => null)
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n===== ${label} :: ${definition}${city ? ` | ${city}` : ''} =====`)
  console.log(`status ${res.status} in ${dt}s`)
  if (!j) { console.log('(no json body)'); return }
  console.log(`mode=${j.mode} source=${j.source || '-'} leads=${(j.leads || []).length}`)
  if (j.leads?.length) {
    for (const l of j.leads.slice(0, 3)) console.log(`  · ${l.company}${l.city ? ` [${l.city}]` : ''}${l.phone ? ` ${l.phone}` : ''}`)
  }
  if (j.note) console.log(`note: ${j.note}`)
  if (j.notice) console.log(`NOTICE: ${j.notice}`)
  if (j.geminiTrace?.length) console.log(`geminiTrace: ${j.geminiTrace.join(' | ')}`)
  if (j.glmTrace?.length) console.log(`glmTrace: ${j.glmTrace.join(' | ')}`)
}

const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(20_000) })
const h = await health.json().catch(() => null)
console.log(`health ${health.status} sha=${h?.sha || h?.commit || JSON.stringify(h).slice(0, 80)}`)

const stamp = Date.now()
const reg = await req('/api/auth', {
  method: 'POST',
  body: JSON.stringify({ action: 'register', email: `diag_${stamp}@hustleqa.example.com`, password: `Qa!${stamp}x`, name: 'Search Diag', city: 'Cape Town' }),
})
console.log(`register ${reg.status}`)
if (reg.status !== 200) process.exit(1)

// Scan A: the vague ask that likely failed for the user (wide area, no niche)
await scan('A vague-wide', 'businesses that need cleaning services', '')
await sleep(13_000)
// Scan B: the exact shape the user said worked
await scan('B coffee shop', 'coffee shop', 'Cape Town')
await sleep(13_000)
// Scan C: specific trade + area, the recommendation the note itself gives
await scan('C specific', 'plumbers in Soweto that need accounting services', 'Soweto')
console.log('\n(done — no leads saved, nothing sent)')
