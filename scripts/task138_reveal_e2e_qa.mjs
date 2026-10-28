// Task 138 QA: reveal end-to-end on prod — door telemetry, pumps, probes, live reveal.
// Usage: node scripts/task138_reveal_e2e_qa.mjs <step>
//   stats    — door telemetry + aiToday lens
//   pumps    — run backfill (unlocked) + pool pre-warm to completion (idempotent)
//   probe    — probe one memory key: node ... probe "Company|City"
//   reveal <leadId> — attempt a real reveal as the ops seat
//   mklead "Company" "City" [website] — create a locked no-contact lead on ops seat
const BASE = 'https://www.hustleportal.online'
import fs from 'node:fs'

const cookie = fs.readFileSync('/tmp/ops_cookie.txt', 'utf8').trim()

async function jf(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { cookie, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const step = process.argv[2]

if (step === 'stats') {
  const { status, body } = await jf('/api/admin/exec/lookup-memory')
  console.log('status', status)
  const days = body.days || {}
  for (const k of Object.keys(days).sort()) console.log(k, JSON.stringify(days[k]))
  console.log('cacheRows:', body.cacheRows, 'aiToday:', JSON.stringify(body.aiToday))
} else if (step === 'pumps') {
  // 1) unlocked-leads backfill
  let cursor, batches = 0, totCached = 0
  do {
    const { status, body } = await jf('/api/admin/exec/lookup-memory', { method: 'POST', body: JSON.stringify({ cursor }) })
    if (status !== 200) { console.log('backfill stop', status, JSON.stringify(body).slice(0, 200)); break }
    batches++; totCached += body.cached
    console.log(`backfill#${batches} scanned=${body.scanned} cached=${body.cached} known=${body.alreadyKnown} dead=${body.deadStripped}`)
    cursor = body.nextCursor
  } while (cursor)
  console.log('BACKFILL TOTAL cached:', totCached)
  // 2) pool pre-warm
  cursor = undefined; batches = 0; totCached = 0
  let totDead = 0, totOpted = 0, totUnusable = 0
  do {
    const { status, body } = await jf('/api/admin/exec/lookup-memory', { method: 'POST', body: JSON.stringify({ source: 'pool', cursor }) })
    if (status !== 200) { console.log('pool stop', status, JSON.stringify(body).slice(0, 200)); break }
    batches++; totCached += body.cached; totDead += body.deadStripped; totOpted += body.optedOut; totUnusable += body.unusable
    console.log(`pool#${batches} scanned=${body.scanned} cached=${body.cached} known=${body.alreadyKnown} dead=${body.deadStripped} opted=${body.optedOut}`)
    cursor = body.nextCursor
  } while (cursor)
  console.log('POOL TOTAL cached:', totCached, 'dead:', totDead, 'optedOut:', totOpted, 'unusable:', totUnusable)
  const fin = await jf('/api/admin/exec/lookup-memory')
  console.log('cacheRows NOW:', fin.body.cacheRows)
} else if (step === 'probe') {
  const q = encodeURIComponent(process.argv[3] || '')
  const { status, body } = await jf(`/api/admin/exec/lookup-memory?probe=${q}`)
  console.log('status', status, JSON.stringify(body, null, 1))
} else if (step === 'reveal') {
  const t0 = Date.now()
  const { status, body } = await jf('/api/leads/reveal', { method: 'POST', body: JSON.stringify({ leadId: process.argv[3] }) })
  console.log('status', status, 'in', Date.now() - t0, 'ms')
  console.log(JSON.stringify(body, null, 1).slice(0, 900))
} else if (step === 'mklead') {
  const { status, body } = await jf('/api/leads', {
    method: 'POST',
    body: JSON.stringify({ company: process.argv[3], city: process.argv[4], website: process.argv[5] || null, source: 'CSV' }),
  })
  console.log('status', status, JSON.stringify(body).slice(0, 300))
} else {
  console.log('unknown step:', step)
}
