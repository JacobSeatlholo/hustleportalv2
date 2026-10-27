// Task 134 QA — the reachable promise at every pipeline door, verified on prod.
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
    // robust: multiple set-cookie headers exist now, never merge them
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    return { status: res.status, json, text, setCookies }
  } finally { clearTimeout(t) }
}

async function main() {
  const login = await call('/api/auth', { method: 'POST', body: { action: 'login', ...OPS } })
  const sess = (login.setCookies || []).find((c) => c.startsWith('hp_session='))
  cookie = (sess || '').split(';')[0]
  console.log(`login: ${login.status} session=${cookie ? 'ok' : 'MISSING'}`)
  let pass = 0, fail = 0
  const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' :: ' + extra : ''}`) } else { fail++; console.log(`  FAIL ${name}${extra ? ' :: ' + extra : ''}`) } }

  // 1. dead email is stripped at the till, never unlocks, notice rides along
  const dead = await call('/api/leads', { method: 'POST', body: { company: `Reach QA dead ${Date.now()}`, email: 'definitely-dead@nonexistent-domain-qax4.co.za', unlocked: true, source: 'MANUAL', city: 'Cape Town' } })
  const dlead = dead.json?.lead
  check('dead email stripped', dead.status === 200 && dlead && !dlead.email, `email=${dlead?.email}`)
  check('dead card not unlocked', dlead && dlead.unlocked === false, `unlocked=${dlead?.unlocked}`)
  check('honest notice present', Boolean(dead.json?.notice), (dead.json?.notice || '').slice(0, 60))

  // 2. a live address survives the till and may unlock
  const good = await call('/api/leads', { method: 'POST', body: { company: `Reach QA good ${Date.now()}`, email: 'hello@businesshustle.co.za', unlocked: true, source: 'MANUAL', city: 'Cape Town' } })
  const glead = good.json?.lead
  check('good email kept', good.status === 200 && glead && glead.email === 'hello@businesshustle.co.za', `email=${glead?.email}`)
  check('good card unlocked', glead && glead.unlocked === true, `unlocked=${glead?.unlocked}`)

  // cleanup
  for (const id of [dlead?.id, glead?.id].filter(Boolean)) {
    const del = await call(`/api/leads/${id}`, { method: 'DELETE' })
    console.log(`  cleanup ${id}: ${del.status}`)
  }

  // 3. the lens now counts the quality floor per source
  const lens = await call('/api/admin/exec/lead-quality')
  const j = lens.json || {}
  console.log(`lens: rated=${j.rated} goodPct=${j.goodPct}% bounced=${j.bounced}`)
  check('bySource30 present', Array.isArray(j.bySource30) && j.bySource30.length > 0)
  for (const s of (j.bySource30 || []).slice(0, 8)) {
    const pct = s.saved ? Math.round((s.withDoor / s.saved) * 100) : 0
    console.log(`  ${s.source.padEnd(8)} saved=${String(s.saved).padEnd(5)} withDoor=${String(s.withDoor).padEnd(5)} (${pct}%) withSite=${String(s.withWebsite).padEnd(5)} unlocked=${s.unlocked} bounced=${s.bounced}`)
  }

  console.log(`== QA done: ${pass} pass, ${fail} fail ==`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
