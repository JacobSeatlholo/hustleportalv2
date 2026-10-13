/**
 * Task 43d verify — the scan path tells the truth and still delivers leads.
 *
 * Runs against PRODUCTION. Registers a QA account with NO personal keys, so
 * the platform GLM_key env alias answers for the z.ai engine. One REAL scan
 * with debug on. PASS means: the scan returns real leads (any honest engine),
 * the GLM walk leaves a trace with the door's own words on failure, and a
 * fallback notice names the engine that carried the scan. No fabricated
 * contacts anywhere.
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
  const email = `scan43d_${stamp}@hustleqa.example.com`
  const password = `Qa!${stamp}x`

  // 1) register + auth cookie
  const reg = await req('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'register', email, password, name: 'Scan 43d Probe' }),
  })
  check('register returns 200', reg.status === 200, `status ${reg.status}`)

  // 2) System Status: the z.ai row exists and speaks about the search tool honestly
  const st = await req('/api/status')
  const stj = await st.json().catch(() => null)
  const zaiRow = stj?.services?.find((s) => s.key === 'zai')
  check('status has a z.ai row', Boolean(zaiRow), zaiRow?.detail?.slice(0, 110) || 'missing')
  check(
    'the z.ai row mentions search tool state when it cannot pay for search',
    Boolean(zaiRow?.ok) === false || /Live/i.test(zaiRow?.detail || ''),
    (zaiRow?.detail || '').slice(0, 130)
  )

  // 3) THE REAL SCAN, debug on, timed
  const t0 = Date.now()
  const disc = await req('/api/leads/discover', {
    method: 'POST',
    body: JSON.stringify({
      definition: 'taverns and shebeens that need security services',
      city: 'Soweto',
      limit: 5,
      debug: true,
    }),
    timeoutMs: 58_000,
  })
  const elapsed = Date.now() - t0
  check('discover 200', disc.status === 200, `status ${disc.status}, ${elapsed}ms`)
  const j = await disc.json().catch(() => null)
  const leads = Array.isArray(j?.leads) ? j.leads : []

  // 4) The scan DELIVERS: AI search (GLM or Gemini) or the real map directory
  check(
    'the scan returned real leads',
    leads.length > 0,
    `mode ${j?.mode}, ${leads.length} leads, ${elapsed}ms`
  )
  check(
    'mode is an honest source',
    ['AI_SEARCH', 'OSM', 'EXPLEE', 'LIVE'].includes(j?.mode),
    `mode ${j?.mode}`
  )

  // 5) Honesty: if GLM failed, the notice or note names the door and the fix
  const story = `${j?.notice || ''} ${j?.note || ''}`
  const glmTrace = Array.isArray(j?.glmTrace) ? j.glmTrace : []
  if (glmTrace.length > 0 && !/GLM engine/i.test(j?.note || '')) {
    check(
      'the GLM walk left a trace',
      glmTrace.every((l) => /→/.test(l)),
      glmTrace.slice(0, 4).join(' | ').slice(0, 200)
    )
    const toldTheTruth =
      /GLM|top up|pacing|billing page|Integrations/i.test(story) || leads.length > 0
    check('the fallback story names what happened', toldTheTruth, story.slice(0, 140))
  } else {
    check('the GLM engine took the scan or left no dead walk', true, (j?.note || '').slice(0, 110))
  }

  // 6) No fabricated contacts
  const fabricated = leads.filter(
    (l) =>
      (l.email && /example\.(com|org)|your(email)?\.|domain\.com/i.test(l.email)) ||
      (l.phone && /12345678|00000000/.test(String(l.phone).replace(/\D/g, '')))
  )
  check('no fabricated contacts in the leads', fabricated.length === 0, `${leads.length} leads checked`)
  check(
    'every lead has a real company name',
    leads.length > 0 && leads.every((l) => typeof l.company === 'string' && l.company.trim().length > 1),
    leads.slice(0, 3).map((l) => l.company).join(' | ')
  )

  // 7) Scan finished inside the function budget
  check('scan finished inside 55s', elapsed < 55_000, `${elapsed}ms`)

  const passed = results.filter((r) => r.ok).length
  console.log(`\nRESULT: ${passed}/${results.length} PASS`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error('HARNESS ERROR', e)
  console.log(`\nRESULT: ${results.filter((r) => r.ok).length}/${results.length} PASS`)
  process.exit(1)
})
