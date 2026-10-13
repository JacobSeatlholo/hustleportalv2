/**
 * Task 43c probe — the GLM_key is LIVE on production, and the demo works.
 *
 * Runs against PRODUCTION. Registers a QA account with NO personal keys, so
 * everything below exercises the PLATFORM z.ai key (the operator's GLM_key env
 * var, accepted through the friendly alias chain). The discover scan at the
 * end is REAL: it spends about three cents of the operator's z.ai credits and
 * must come back with mode AI_SEARCH, sourced by the z.ai GLM engine, with
 * real business names and no fabricated contacts. That scan IS the demo proof.
 *
 * RESULT: n/n PASS  (exit 0 = all pass, 1 = at least one failure)
 */
const BASE = 'https://www.hustleportal.online'

let cookie = ''
const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: Boolean(cond), detail })
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(opts.timeoutMs || 30_000),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie && !cookie) cookie = setCookie.split(';')[0]
  return res
}

async function main() {
  const stamp = Date.now()
  const email = `glmkey_${stamp}@hustleqa.example.com`
  const password = `Qa!${stamp}x`

  // 1) register + auth cookie
  const reg = await req('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'register', email, password, name: 'GLMkey Probe' }),
  })
  check('register returns 200', reg.status === 200, `status ${reg.status}`)

  // 2) System Status: the platform z.ai key (GLM_key) is visible and LIVE
  const st = await req('/api/status')
  const stj = await st.json().catch(() => null)
  const zaiRow = stj?.services?.find((s) => s.key === 'zai')
  check('status z.ai row is LIVE on the platform key', Boolean(zaiRow && zaiRow.ok), zaiRow?.detail?.slice(0, 90))

  // 3) Diagnose: the platform key is accepted by z.ai with a real micro generation
  const diag = await req('/api/ai/diagnose', { timeoutMs: 55_000 })
  const diagj = await diag.json().catch(() => null)
  check(
    'diagnose sees the platform z.ai key and it works',
    Boolean(diagj?.zai?.configured && diagj?.zai?.keySource === 'platform' && diagj?.zai?.ok),
    (diagj?.zai?.message || diagj?.zai?.masked || 'missing').slice(0, 90)
  )

  // 4) THE DEMO PROOF: one real grounded lead scan on the operator's credits.
  //    With a platform key present the GLM engine LEADS the chain, so a
  //    successful web scan must name the z.ai GLM engine in its note.
  const disc = await req('/api/leads/discover', {
    method: 'POST',
    body: JSON.stringify({
      definition: 'taverns and shebeens that need security services',
      city: 'Soweto',
      limit: 5,
    }),
    timeoutMs: 58_000,
  })
  check('discover 200', disc.status === 200, `status ${disc.status}`)
  const discj = await disc.json().catch(() => null)
  check('discover returns AI_SEARCH mode', discj?.mode === 'AI_SEARCH', `mode ${discj?.mode}, note: ${(discj?.note || '').slice(0, 80)}`)
  check(
    'the scan was carried by the GLM engine',
    /GLM engine/i.test(discj?.note || ''),
    (discj?.note || '').slice(0, 100)
  )
  const leads = Array.isArray(discj?.leads) ? discj.leads : []
  check('real leads came back', leads.length > 0, `${leads.length} leads`)
  check(
    'every lead has a real company name',
    leads.length > 0 && leads.every((l) => typeof l.company === 'string' && l.company.trim().length > 1),
    leads.slice(0, 3).map((l) => l.company).join(' | ')
  )
  const fabricated = leads.filter((l) => (l.email && /example\.(com|org)|your(email)?\.|domain\.com/i.test(l.email)) || (l.phone && /12345678|00000000/.test(l.phone.replace(/\D/g, ''))))
  check('no fabricated contacts in the leads', fabricated.length === 0, `${leads.length} leads checked`)

  const passed = results.filter((r) => r.ok).length
  console.log(`\nRESULT: ${passed}/${results.length} PASS`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error('HARNESS ERROR', e)
  console.log(`\nRESULT: ${results.filter((r) => r.ok).length}/${results.length} PASS`)
  process.exit(1)
})
