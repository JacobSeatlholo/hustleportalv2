// Bench probe: the 48c auto campaign for the Explee Probe QA client captured
// its answers into the global verified pool under ITS topic fingerprint. A
// brand new user scanning that EXACT topic serves those captured faces from
// the pool for free. The shape of the served faces tells us which engine ran:
//   Explee live  -> B2B data rows: domains/websites, industry labels, often
//                   emails, LinkedIn company links as sourceRefs
//   Pool fallback -> map style rows: area labels like "Johannesburg Ward 38"
// The campaign brief for a QA user with no profile fields is deterministic:
//   "new customers in Johannesburg that would pay for what they sell"
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

async function main() {
  const stamp = Date.now()
  const reg = await req('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'register', email: `bench_${stamp}@hustleqa.example.com`, password: `Qa!${stamp}x`, name: 'Bench Probe' }),
  })
  console.log('register B:', reg.status)
  const scan = await req('/api/leads/discover', {
    method: 'POST',
    body: JSON.stringify({ definition: 'new customers in Johannesburg that would pay for what they sell', city: 'Johannesburg', limit: 8 }),
  })
  const j = await scan.json().catch(() => null)
  console.log('status:', scan.status, '| mode:', j?.mode, '| source:', j?.source || '')
  if (j?.note) console.log('note:', String(j.note).slice(0, 200))
  const leads = j?.leads || []
  console.log(`leads: ${leads.length}`)
  let expleeShape = 0
  let mapShape = 0
  for (const l of leads) {
    const isMap = /Ward|Ext|\d{4}$/.test(l.city || '') || (!l.website && !l.email)
    if (l.website || l.email || (l.profileUrl || '').includes('linkedin')) expleeShape++
    if (isMap) mapShape++
    console.log(`  ${l.company} | city=${l.city || '?'} | site=${l.website ? 'yes' : 'no'} | email=${l.email ? 'yes' : 'no'} | profile=${(l.profileUrl || '').slice(0, 60)}`)
  }
  console.log(`\nshape: ${expleeShape} explee style rows, ${mapShape} map style rows (of ${leads.length})`)
  if (leads.length > 0 && expleeShape > mapShape) console.log('VERDICT: campaign ran on LIVE EXPLEE data (captured faces are B2B data rows)')
  else if (leads.length > 0) console.log('VERDICT: faces are map/pool style rows; check the campaign result email for the exact engine line')
  else console.log('VERDICT: pool had no fresh faces for this topic; check the campaign result email')
}

main().catch((e) => { console.error('PROBE_CRASH', e); process.exitCode = 1 })
