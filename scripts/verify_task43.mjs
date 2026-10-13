/**
 * Task 43 verify — multi engine AI Lead Finder (z.ai GLM backup engine).
 *
 * Runs against PRODUCTION. Self contained: registers a QA account, then checks
 * the new engine plumbing end to end. The z.ai / DeepSeek keys used here are
 * intentionally fake (shape correct, never valid): the contract under test is
 * that the chain reacts HONESTLY (save time probe verdicts, status rows, a
 * discover run that answers with real OSM data or a clean honest note instead
 * of a 500).
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
  const email = `task43_${stamp}@hustleqa.example.com`
  const password = `Qa!${stamp}x`

  // 1) register + auth cookie
  const reg = await req('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'register', email, password, name: 'Task43 QA' }),
  })
  check('register returns 200', reg.status === 200, `status ${reg.status}`)

  // 2) status exposes the new z.ai GLM engine row (platform view, honest not-set copy)
  const st = await req('/api/status')
  check('status 200', st.status === 200, `status ${st.status}`)
  const stj = await st.json().catch(() => null)
  const zaiRow = stj?.services?.find((s) => s.key === 'zai')
  check('status has z.ai GLM engine row', Boolean(zaiRow), zaiRow ? zaiRow.name : 'missing')
  check(
    'z.ai row is honest when no platform key is set',
    Boolean(zaiRow && /Integrations/.test(zaiRow.detail || '')),
    zaiRow?.detail?.slice(0, 80)
  )
  const dsRow = stj?.services?.find((s) => s.key === 'deepseek')
  check('status still has DeepSeek engine row', Boolean(dsRow), dsRow ? dsRow.name : 'missing')

  // 3) save a fake z.ai key: shape is plausible, engine rejects it, verdict comes
  //    back in the SAME response (the verdict IS the toast contract).
  const fakeZai = `zai-fake-${stamp}-abcdef0123456789abcdef`
  const putZai = await req('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ key: 'ZAI_API_KEY', value: fakeZai }),
    timeoutMs: 40_000,
  })
  check('PUT ZAI_API_KEY accepted', putZai.status === 200, `status ${putZai.status}`)
  const putZaij = await putZai.json().catch(() => null)
  check('z.ai save returns a validation verdict', putZaij && typeof putZaij.validation === 'object' && putZaij.validation !== null, JSON.stringify(putZaij?.validation || null).slice(0, 90))
  check(
    'z.ai verdict honestly rejects the fake key',
    putZaij?.validation && putZaij.validation.ok === false,
    putZaij?.validation?.message?.slice(0, 90)
  )

  // 4) save a fake DeepSeek key: verdict path still works (parked plumbing now shipped)
  const fakeDs = `sk-fake${stamp}abcdef0123456789`
  const putDs = await req('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ key: 'DEEPSEEK_API_KEY', value: fakeDs }),
    timeoutMs: 40_000,
  })
  check('PUT DEEPSEEK_API_KEY accepted', putDs.status === 200, `status ${putDs.status}`)
  const putDsj = await putDs.json().catch(() => null)
  check(
    'DeepSeek verdict honestly rejects the fake key',
    putDsj?.validation && putDsj.validation.ok === false,
    (putDsj?.validation?.message || '').slice(0, 90)
  )

  // 5) masked, never raw
  const list = await req('/api/settings')
  const listj = await list.json().catch(() => null)
  const zaiSetting = listj?.settings?.find((s) => s.key === 'ZAI_API_KEY')
  check('ZAI_API_KEY stored masked', Boolean(zaiSetting && zaiSetting.value.includes('••••') && !zaiSetting.value.includes('abcdef0123456789')), zaiSetting?.value)

  // 6) diagnose reports the z.ai engine section with a rejection (fake key)
  const diag = await req('/api/ai/diagnose', { timeoutMs: 55_000 })
  check('diagnose 200', diag.status === 200, `status ${diag.status}`)
  const diagj = await diag.json().catch(() => null)
  check('diagnose has zai section', Boolean(diagj?.zai && diagj.zai.configured), diagj?.zai?.masked || 'missing')
  check(
    'zai diagnose honestly rejects the fake key',
    diagj?.zai?.ok === false && /rejected/i.test(diagj?.zai?.message || ''),
    (diagj?.zai?.message || '').slice(0, 90)
  )

  // 7) the discover chain answers honestly with fake keys present: Gemini may
  //    run, z.ai must be rejected, and OSM real data (or an honest note) still
  //    lands. Never a 500, never fabricated contacts.
  const disc = await req('/api/leads/discover', {
    method: 'POST',
    body: JSON.stringify({ definition: 'taverns that need security services', city: 'Soweto', limit: 5 }),
    timeoutMs: 58_000,
  })
  check('discover 200', disc.status === 200, `status ${disc.status}`)
  const discj = await disc.json().catch(() => null)
  check('discover returns a mode', Boolean(discj && discj.mode), discj?.mode || 'none')
  check(
    'discover is honest (real leads or an honest note)',
    discj && (discj.mode === 'OSM' || discj.mode === 'AI_SEARCH' || discj.mode === 'EXPLEE' || (discj.mode === 'NONE' && discj.note)),
    (discj?.note || '').slice(0, 100)
  )
  if (discj?.mode === 'OSM') {
    const leads = discj.leads || []
    const fabricated = leads.filter((l) => l.email && /example\.(com|org)|your(email)?\.|domain\.com/i.test(l.email))
    check('OSM leads carry no fabricated emails', fabricated.length === 0, `${leads.length} leads checked`)
  }

  // 8) cleanup: clear the fake keys so the QA account stays clean
  const del1 = await req('/api/settings?key=ZAI_API_KEY', { method: 'DELETE' })
  const del2 = await req('/api/settings?key=DEEPSEEK_API_KEY', { method: 'DELETE' })
  check('fake keys cleaned up', del1.status === 200 && del2.status === 200, `zai ${del1.status}, ds ${del2.status}`)

  const passed = results.filter((r) => r.ok).length
  console.log(`\nRESULT: ${passed}/${results.length} PASS`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error('HARNESS ERROR', e)
  console.log(`\nRESULT: ${results.filter((r) => r.ok).length}/${results.length} PASS`)
  process.exit(1)
})
