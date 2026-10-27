// Task 134 — boss: "The lead quality is quite bad for users. We need to fix this
// workflow so that there is a product that works for the users. ALWAYS."
// Step 1: pull the REAL quality picture from prod — verdicts, reasons, sources,
// bounces, the members' own words. No fix before the data speaks.
const BASE = 'https://www.hustleportal.online'
const OPS = { email: 'ops@hustleqa.example.com', password: 'OpsSeat2026!Hustle' }

let cookie = ''

async function call(path, { method = 'GET', body, timeout = 60_000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text }
  } finally { clearTimeout(t) }
}

async function main() {
  const login = await call('/api/auth', { method: 'POST', body: { action: 'login', ...OPS } })
  cookie = (login.setCookie || '').split(';')[0]
  console.log(`ops login: ${login.status}`)

  const q = await call('/api/admin/exec/lead-quality')
  console.log(`\n== lead-quality lens: ${q.status} ==`)
  const j = q.json || {}
  console.log(`rated=${j.rated} good=${j.good} bad=${j.bad} goodPct=${j.goodPct}`)
  console.log(`30d: rated=${j.rated30} good=${j.good30} bad=${j.bad30}`)
  console.log(`released=${j.released} poolFacesJudged=${j.poolFacesJudged} bounced=${j.bounced} reachFlagged=${j.reachFlagged}`)
  console.log(`reasons: ${(j.reasons || []).map((r) => `${r.reason}:${r.count}`).join('  ')}`)
  console.log('bySource:')
  for (const s of j.bySource || []) console.log(`  ${s.source.padEnd(8)} rated=${String(s.rated).padEnd(5)} good=${String(s.good).padEnd(5)} bad=${s.bad}`)
  console.log('recent verdicts (member words):')
  for (const r of (j.recent || []).slice(0, 15)) {
    console.log(`  [${String(r.at).slice(0, 10)}] ${r.verdict}${r.reason ? '/' + r.reason : ''} ${r.company} (${r.city || '-'}) src=${r.source} — ${r.member}${r.note ? `: "${r.note}"` : ''}`)
  }

  // hot lens: which members hold the most leads (volume context)
  const feed = await call('/api/admin/exec')
  const roster = feed.json?.roster || []
  const real = roster.filter((c) => !c.isQa && !c.isInternal && c.counts?.leads > 0)
  console.log(`\n== members with pipelines: ${real.length} ==`)
  for (const c of real.slice(0, 15)) console.log(`  ${c.email} leads=${c.counts.leads} lastActive=${String(c.lastActiveAt || '').slice(0, 10)} wallet=${c.walletCents}`)

  console.log('== done ==')
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
