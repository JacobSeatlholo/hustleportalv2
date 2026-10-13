#!/usr/bin/env node
/**
 * Task 42 production verify — workspace switching must repopulate pipeline, clients,
 * invoices and dashboard numbers. Asserts CONTRACT (status + JSON shape + scoping),
 * never AI luck.
 * Usage: node scripts/verify_project42.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const EMAIL = `ws42_${Date.now()}@hustleqa.example.com`
const PASSWORD = 'QaWs2026!'
let cookie = ''
let pass = 0, fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function req(method, path, body, timeoutMs = 45000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    const setC = res.headers.get('set-cookie')
    if (setC) cookie = setC.split(';')[0]
    let json = null
    try { json = await res.json() } catch { /* html ok */ }
    return { status: res.status, json, text: json ? '' : await res.text().catch(() => '') }
  } finally { clearTimeout(t) }
}

console.log(`\n[1] register QA account (default workspace auto-exists)`)
const reg = await req('POST', '/api/auth', { action: 'register', email: EMAIL, password: PASSWORD, name: 'QA Ws42', businessName: 'Ws42 Spaza' })
check('register ok (session via cookie)', reg.status === 200 && reg.json?.ok === true)
const plist = await req('GET', '/api/projects')
const projects = plist.json?.projects || []
const def = projects.find((p) => p.isDefault)
check('default workspace auto-created', !!def, def ? def.name : 'none')

console.log(`\n[2] second workspace`)
const cr = await req('POST', '/api/projects', { name: 'Ws42 Second' })
const B = cr.json?.project
check('second workspace created', (cr.status === 200 || cr.status === 201) && !!B?.id, B?.name || '')

console.log(`\n[3] clients scoping`)
const cDef = await req('POST', '/api/clients', { name: 'Client Default Side' })
check('client without projectId lands in default workspace', cDef.status === 200 && cDef.json?.client?.projectId === def.id, `projectId=${cDef.json?.client?.projectId || 'null'}`)
const cB = await req('POST', '/api/clients', { name: 'Client Second Side', projectId: B.id })
check('client with explicit projectId lands there', cB.status === 200 && cB.json?.client?.projectId === B.id)
const inDef = await req('GET', `/api/clients?projectId=${def.id}`)
const inB = await req('GET', `/api/clients?projectId=${B.id}`)
check('default-side client visible only in default filter', (inDef.json?.clients || []).some((c) => c.name === 'Client Default Side') && !(inB.json?.clients || []).some((c) => c.name === 'Client Default Side'))
check('second-side client visible only in second filter', (inB.json?.clients || []).some((c) => c.name === 'Client Second Side') && !(inDef.json?.clients || []).some((c) => c.name === 'Client Second Side'))
const mixed = await req('GET', '/api/clients')
check('no param keeps the classic mixed view (both sides)', (mixed.json?.clients || []).length === 2, `count=${(mixed.json?.clients || []).length}`)
const bogus = await req('GET', '/api/clients?projectId=nosuchproject')
check('bogus projectId rejected (404)', bogus.status === 404)

console.log(`\n[4] whatsapp import stamps the requested workspace`)
const wi = await req('POST', '/api/whatsapp/import', { text: 'Thandi Mokoena +27821234567', projectId: B.id })
check('import ok', wi.status === 200 && (wi.json?.imported || 0) >= 1, `imported=${wi.json?.imported}`)
const inB2 = await req('GET', `/api/clients?projectId=${B.id}`)
const inDef2 = await req('GET', `/api/clients?projectId=${def.id}`)
check('imported contact is in second workspace, not default', (inB2.json?.clients || []).some((c) => c.name === 'Thandi Mokoena') && !(inDef2.json?.clients || []).some((c) => c.name === 'Thandi Mokoena'))

console.log(`\n[5] invoices scoping`)
const invB = await req('POST', '/api/invoices', { clientName: 'Second Side Client', items: [{ description: 'Delivery', quantity: 1, unitPrice: 450 }], projectId: B.id })
check('invoice created into second workspace', (invB.status === 200 || invB.status === 201) && invB.json?.invoice?.projectId === B.id, invB.json?.invoice?.number || '')
const invDef = await req('POST', '/api/invoices', { clientName: 'Default Side Client', items: [{ description: 'Delivery', quantity: 1, unitPrice: 200 }] })
check('invoice without projectId lands in default workspace', (invDef.status === 200 || invDef.status === 201) && invDef.json?.invoice?.projectId === def.id)
const invBList = await req('GET', `/api/invoices?projectId=${B.id}`)
const invDefList = await req('GET', `/api/invoices?projectId=${def.id}`)
check('invoice list follows the workspace filter', (invBList.json?.invoices || []).every((i) => i.projectId === B.id) && (invBList.json?.invoices || []).some((i) => i.id === invB.json?.invoice?.id) && !(invDefList.json?.invoices || []).some((i) => i.id === invB.json?.invoice?.id))

console.log(`\n[6] pipeline (leads) scoping regression`)
const lB = await req('POST', '/api/leads', { company: 'Lead Second Side', projectId: B.id })
const lDef = await req('POST', '/api/leads', { company: 'Lead Default Side' })
check('leads created into both sides', (lB.status === 200 || lB.status === 201) && (lDef.status === 200 || lDef.status === 201))
const leadB = await req('GET', `/api/leads?projectId=${B.id}`)
check('pipeline filter returns only that workspace', (leadB.json?.leads || []).length === 1 && leadB.json?.leads?.[0]?.company === 'Lead Second Side', `count=${(leadB.json?.leads || []).length}`)

console.log(`\n[7] dashboard follows the workspace`)
const dashB = await req('GET', `/api/dashboard?projectId=${B.id}`)
const dashDef = await req('GET', `/api/dashboard?projectId=${def.id}`)
const dashAll = await req('GET', '/api/dashboard')
check('dashboard scoped: second workspace sees its 1 lead', dashB.status === 200 && dashB.json?.kpis?.totalLeads === 1, `totalLeads=${dashB.json?.kpis?.totalLeads}`)
check('dashboard scoped: default workspace sees its 1 lead', dashDef.json?.kpis?.totalLeads === 1, `totalLeads=${dashDef.json?.kpis?.totalLeads}`)
check('dashboard unscoped keeps the whole-business view (2 leads)', dashAll.json?.kpis?.totalLeads === 2, `totalLeads=${dashAll.json?.kpis?.totalLeads}`)

console.log(`\n[8] deployed bundle carries the workspace dropdowns`)
const pageRes = await fetch(BASE + '/', { signal: AbortSignal.timeout(30000), redirect: 'manual' })
const pageHtml = await pageRes.text()
check('app shell 200', pageRes.status === 200 && pageHtml.length > 1000, `${pageHtml.length} bytes`)
const scripts = [...pageHtml.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1])
let bundleHit = false
for (const s of scripts.slice(0, 12)) {
  const u = s.startsWith('http') ? s : BASE + s
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) })
    const t = await r.text()
    if (t.includes('All workspaces')) { bundleHit = true; break }
  } catch { /* next chunk */ }
}
check('bundle contains workspace switcher dropdowns', bundleHit, `${scripts.length} scripts scanned`)

console.log(`\nRESULT: ${pass}/${pass + fail} PASS`)
if (fail > 0) { console.log(`FAILED: ${failures.join(' | ')}`); process.exit(1) }
process.exit(0)
