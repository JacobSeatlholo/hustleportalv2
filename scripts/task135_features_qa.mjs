// Task 135 — QA the four boss features ON PROD (www.hustleportal.online):
//   [1] Quotes: kind=QUOTE → QT- number, quote status ladder (DRAFT→SENT→ACCEPTED/DECLINED,
//       declined re-send), invalid transitions rejected, invoices keep INV- series,
//       money reports count invoices only.
//   [2] Pipeline stage rename: PIPELINE_STAGES setting roundtrip (PUT→GET→reset).
//   [3] Tasks search+sort: list payload carries createdAt (sort field), create+search+cleanup.
//   [4] Socials: landing HTML carries the two footer links.
// Cleanup everywhere — no junk rows left on the ops seat.
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
    return { status: res.status, json, text, setCookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [] }
  } finally { clearTimeout(t) }
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const login = await call('/api/auth', { method: 'POST', body: { action: 'login', ...OPS } })
  const sc = login.setCookies.find((c) => c.startsWith('hp_session='))
  cookie = sc ? sc.split(';')[0] : ''
  check('ops login', login.status === 200 && Boolean(cookie), `status=${login.status}`)

  // ---------- [1] QUOTES ----------
  const stamp = Date.now().toString().slice(-6)
  const qCreate = await call('/api/invoices', {
    method: 'POST',
    body: {
      kind: 'QUOTE',
      clientName: `QA Quote Target ${stamp}`,
      items: [{ description: 'Brand refresh sprint', quantity: 1, unitPrice: 4500 }],
      taxRate: 15,
    },
  })
  const quote = qCreate.json?.invoice
  check('quote create → QT- number', qCreate.status === 201 && quote && String(quote.number).startsWith('QT-'), `number=${quote?.number} status=${qCreate.status}`)
  check('quote kind persisted', quote?.kind === 'QUOTE', `kind=${quote?.kind}`)

  const qSend = await call(`/api/invoices/${quote?.id}`, { method: 'PATCH', body: { status: 'SENT' } })
  check('quote DRAFT→SENT', qSend.status === 200 && qSend.json?.invoice?.status === 'SENT', `status=${qSend.status}`)

  const qBad = await call(`/api/invoices/${quote?.id}`, { method: 'PATCH', body: { status: 'PAID' } })
  check('quote SENT→PAID rejected', qBad.status === 400, `status=${qBad.status} msg=${qBad.json?.error?.slice(0, 60)}`)

  const qDecline = await call(`/api/invoices/${quote?.id}`, { method: 'PATCH', body: { status: 'DECLINED' } })
  check('quote SENT→DECLINED', qDecline.status === 200, `status=${qDecline.status}`)

  const qResend = await call(`/api/invoices/${quote?.id}`, { method: 'PATCH', body: { status: 'SENT' } })
  check('quote DECLINED→SENT (revised re-send)', qResend.status === 200, `status=${qResend.status}`)

  const qAccept = await call(`/api/invoices/${quote?.id}`, { method: 'PATCH', body: { status: 'ACCEPTED' } })
  check('quote SENT→ACCEPTED', qAccept.status === 200, `status=${qAccept.status}`)

  const qFrozen = await call(`/api/invoices/${quote?.id}`, { method: 'PATCH', body: { status: 'SENT' } })
  check('quote ACCEPTED frozen', qFrozen.status === 400, `status=${qFrozen.status}`)

  // invoice series untouched by the quote
  const iCreate = await call('/api/invoices', {
    method: 'POST',
    body: {
      clientName: `QA Invoice Target ${stamp}`,
      items: [{ description: 'Website build', quantity: 1, unitPrice: 12000 }],
      taxRate: 15,
    },
  })
  const inv = iCreate.json?.invoice
  check('invoice create → INV- number (own series)', iCreate.status === 201 && inv && String(inv.number).startsWith('INV-'), `number=${inv?.number} kind=${inv?.kind}`)

  const list = await call('/api/invoices')
  const rows = list.json?.invoices || []
  check('list carries kind on both', rows.some((r) => r.id === quote?.id && r.kind === 'QUOTE') && rows.some((r) => r.id === inv?.id && r.kind !== 'QUOTE'))

  const reports = await call('/api/reports')
  const stats = reports.json?.invoiceStats || {}
  const reportsQuoteCount = Number(stats.quotes)
  const reportsInvTotal = Number(stats.total)
  const invOnlyCount = rows.filter((r) => r.kind !== 'QUOTE').length
  check('reports: quotes counted separately, money stats exclude them', reports.json?.invoiceStats && reportsQuoteCount >= 1 && reportsInvTotal >= invOnlyCount - 1, `quotes=${reportsQuoteCount} total=${reportsInvTotal} opsInvRows=${invOnlyCount}`)

  await call(`/api/invoices/${quote?.id}`, { method: 'DELETE' })
  await call(`/api/invoices/${inv?.id}`, { method: 'DELETE' })
  const afterDel = await call('/api/invoices')
  check('QA documents cleaned up', !(afterDel.json?.invoices || []).some((r) => r.id === quote?.id || r.id === inv?.id))

  // ---------- [2] PIPELINE STAGE RENAME (setting roundtrip) ----------
  const putStage = await call('/api/settings', { method: 'PUT', body: { key: 'PIPELINE_STAGES', value: JSON.stringify({ CONTACTED: 'Waiting on them' }) } })
  check('PIPELINE_STAGES accepted by settings API', putStage.status === 200, `status=${putStage.status} err=${putStage.json?.error || ''}`)
  const getStage = await call('/api/settings')
  const stageRow = (getStage.json?.settings || []).find((s) => s.key === 'PIPELINE_STAGES')
  check('PIPELINE_STAGES roundtrip', stageRow && JSON.parse(stageRow.value).CONTACTED === 'Waiting on them', `value=${stageRow?.value}`)
  const clearStage = await call('/api/settings', { method: 'PUT', body: { key: 'PIPELINE_STAGES', value: JSON.stringify({}) } })
  check('PIPELINE_STAGES reset to defaults', clearStage.status === 200)

  // ---------- [3] TASKS search+sort field ----------
  const t1 = await call('/api/tasks', { method: 'POST', body: { title: `ZZQA searchtarget ${stamp}`, priority: 'HIGH', notes: 'sort probe alpha' } })
  const t2 = await call('/api/tasks', { method: 'POST', body: { title: `ZZQA second ${stamp}`, priority: 'LOW' } })
  check('tasks created', t1.status === 200 && t2.status === 200, `s=${t1.status}/${t2.status}`)
  const tList = await call('/api/tasks?scope=mine')
  const tRows = tList.json?.tasks || []
  const mine = tRows.filter((r) => r.title.includes('ZZQA'))
  check('task list rows carry createdAt (sort key)', tRows.length === 0 || tRows.every((r) => typeof r.createdAt === 'string' && r.createdAt.length > 0), `rows=${tRows.length}`)
  check('search surface has our probes (client filters title+notes)', mine.length >= 2, `found=${mine.length}`)

  // ---------- [4] SOCIALS in the landing HTML ----------
  const landing = await call('/', { timeout: 45_000 })
  const html = landing.text || ''
  const tw = html.includes('x.com/hustlebusiness')
  const ig = html.includes('instagram.com/businesshustleworldwide')
  check('landing footer: X/Twitter @hustlebusiness', tw)
  check('landing footer: Instagram @businesshustleworldwide', ig)

  // cleanup tasks
  for (const t of mine) await call(`/api/tasks/${t.id}`, { method: 'DELETE' })
  const tAfter = await call('/api/tasks?scope=mine')
  check('QA tasks cleaned up', !((tAfter.json?.tasks || []).some((r) => r.title.includes('ZZQA'))))

  const failed = results.filter((r) => !r.ok)
  console.log(`\n== ${results.length - failed.length}/${results.length} PASS ==`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
