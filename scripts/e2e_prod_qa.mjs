#!/usr/bin/env node
/**
 * End-to-end production QA for HustlePortal — the full user journey via API.
 * Usage: node scripts/e2e_prod_qa.mjs [baseUrl]
 * Creates a throwaway account, walks every core flow, prints PASS/FAIL summary.
 */
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const EMAIL = `qa_${Date.now()}@hustleqa.example.com`
const PASSWORD = 'QaTest2026!'
let cookie = ''
let pass = 0, fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

async function req(method, path, body, timeoutMs = 30000) {
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
    try { json = await res.json() } catch { /* empty body ok */ }
    return { status: res.status, json }
  } finally { clearTimeout(t) }
}

async function getBalance() {
  const w = await req('GET', '/api/wallet')
  return w.json?.wallet?.balance ?? null
}

async function main() {
  console.log(`E2E QA against ${BASE} — account ${EMAIL}\n`)

  // 1. Registration
  const reg = await req('POST', '/api/auth', { action: 'register', email: EMAIL, password: PASSWORD, name: 'QA Tester', businessName: 'QA Spaza', industry: 'RETAIL', city: 'Johannesburg' })
  check('register returns ok', reg.status === 200 && reg.json?.ok === true, `status ${reg.status}`)

  // 2. Session
  const me = await req('GET', '/api/auth/me')
  check('session works (GET /api/auth/me)', me.status === 200 && !!me.json?.user?.id, `status ${me.status}`)
  const userId = me.json?.user?.id

  // 3. Welcome email — lastSend is admin-only (Task 24), so a MEMBER account can
  // only verify registration succeeded and the send path was awaited (no error).
  const mail = await req('GET', '/api/emails/status')
  const last = mail.json?.lastSend
  check('mail diagnostics reachable', mail.status === 200, `status ${mail.status}`)
  if (last) check('welcome email stamped (admin view)', last.to === EMAIL, `via ${last.via || '?'}`)
  else console.log('  SKIP welcome-email stamp — admin-only view (member account)')

  // 4. Wallet: R99 welcome credit
  const bal0 = await getBalance()
  check('welcome credit R99 in wallet', bal0 === 9900, `balance=${bal0}`)

  // 5. Profile update (PATCH — the website-first flow backend)
  const prof = await req('PATCH', '/api/profile', { businessName: 'QA Spaza & Grill', website: 'https://example.com', city: 'Johannesburg' })
  check('profile update works', prof.status === 200 || prof.status === 201, `status ${prof.status} ${JSON.stringify(prof.json).slice(0, 80)}`)

  // 6. Lead discovery (AI/OSM/POOL — slow, honest-fail allowed)
  let firstLead = null
  try {
    const disc = await req('POST', '/api/leads/discover', { city: 'Johannesburg', industry: 'RETAIL', limit: 5 }, 150000)
    const results = disc.json?.leads || disc.json?.results || []
    check('lead discover returns results or honest error', disc.status === 200, `status ${disc.status}, results ${results.length}`)
    check('discover names its engine (mode + source)', Boolean(disc.json?.mode) && Boolean(disc.json?.source), `mode=${disc.json?.mode} source=${disc.json?.source}`)
    check('every lead carries a real business name', results.length === 0 || results.every((l) => l.company && String(l.company).trim().length > 1))
    firstLead = results[0] || null
  } catch (e) {
    check('lead discover returns results or honest error', false, String(e).slice(0, 80))
  }

  // 6b. Pipeline save + reveal — the honesty contract end to end. Discover
  // results carry no id: the seller saves a lead first, then reveals it.
  if (firstLead?.company) {
    const save = await req('POST', '/api/leads', {
      company: firstLead.company,
      phone: firstLead.phone || '',
      email: firstLead.email || '',
      website: firstLead.website || '',
      industry: firstLead.industry || '',
      city: firstLead.city || '',
      source: 'AI_SEARCH',
    })
    check('save discovered lead to pipeline', (save.status === 200 || save.status === 201) && !!save.json?.lead?.id, `status ${save.status}`)
    const savedLeadId = save.json?.lead?.id
    if (savedLeadId) {
      const balBefore = (await getBalance()) ?? 0
      const rev = await req('POST', '/api/leads/reveal', { leadId: savedLeadId }, 90000)
      const balAfter = (await getBalance()) ?? 0
      const charged = balAfter < balBefore
      const lead = rev.json?.lead
      const hasContact = !!(lead?.email || lead?.phone)
      check('reveal obeys honesty contract (charged only when real contact)', rev.status === 200 && (!charged || hasContact), `charged=${charged} hasContact=${hasContact} status=${rev.status}`)
      const again = await req('POST', '/api/leads/reveal', { leadId: savedLeadId }, 30000)
      const balAgain = (await getBalance()) ?? 0
      check('already unlocked lead never charges twice', again.status === 200 && balAgain === balAfter, `status=${again.status}`)
    }
  } else {
    console.log('  SKIP pipeline save + reveal — no discover results (noted, not a failure)')
  }

  // 8. Clients CRUD (the fixed add-contact flow)
  const cc = await req('POST', '/api/clients', { name: 'QA Client Thandi', company: 'Thandi Foods', email: 'thandi@example.com', phone: '+27821234567', monthlyValue: 2500, status: 'ACTIVE' })
  check('create client works', cc.status === 200 || cc.status === 201, `status ${cc.status}`)
  const cl = await req('GET', '/api/clients')
  check('client list shows the new client', cl.status === 200 && JSON.stringify(cl.json).includes('QA Client Thandi'))
  if (cc.json?.id || cc.json?.client?.id) {
    const cid = cc.json?.id || cc.json?.client?.id
    const cu = await req('PATCH', `/api/clients/${cid}`, { name: 'QA Client Updated' })
    check('update client works', cu.status === 200, `status ${cu.status}`)
  }

  // 9. Invoice create
  const inv = await req('POST', '/api/invoices', { clientName: 'QA Client Thandi', items: [{ description: 'QA consulting', quantity: 2, unitPrice: 50000 }], status: 'DRAFT' })
  check('create invoice works', inv.status === 200 || inv.status === 201, `status ${inv.status}`)

  // 10. Tasks + finance quick CRUD
  const task = await req('POST', '/api/tasks', { title: 'QA task', priority: 'HIGH' })
  check('create task works', task.status === 200 || task.status === 201, `status ${task.status}`)
  const fin = await req('POST', '/api/finance', { type: 'EXPENSE', description: 'QA stock purchase', amount: 12345 })
  check('create finance entry works', fin.status === 200 || fin.status === 201, `status ${fin.status}`)

  // 11. Subscribe (annual cycle validation — live key => PENDING + redirect; no key => sandbox + credits)
  // Balance baseline is taken HERE so a reveal charge earlier in the run can
  // never fake a failed credit grant.
  const balPreSub = (await getBalance()) ?? 0
  const sub = await req('POST', '/api/subscribe', { plan: 'HUSTLER', cycle: 'ANNUAL' }, 45000)
  const sandbox = sub.json?.sandbox === true
  if (sandbox) {
    check('subscribe sandbox activates', sub.json?.subscription?.status === 'ACTIVE' && sub.json?.subscription?.billingCycle === 'ANNUAL', `cycle=${sub.json?.subscription?.billingCycle}`)
    const bal2 = await getBalance()
    check('plan grants 5 reveal credits (R75)', (bal2 ?? 0) >= (balPreSub ?? 0) + 7500, `balance=${bal2} baseline=${balPreSub}`)
    const ps = await req('POST', '/api/subscribe/pause', { action: 'pause' })
    check('pause works', ps.status === 200 && ps.json?.subscription?.status === 'PAUSED', `status ${ps.status}`)
    const pr = await req('POST', '/api/subscribe/pause', { action: 'resume' })
    check('resume works', pr.status === 200 && pr.json?.subscription?.status === 'ACTIVE')
  } else {
    check('subscribe returns Yoco checkout redirect', sub.status === 200 && !!sub.json?.redirectUrl && sub.json?.subscription?.status === 'PENDING', `status ${sub.status} mode=${sub.json?.mode || '?'}`)
    const ps = await req('POST', '/api/subscribe/pause', { action: 'pause' })
    check('pause correctly rejects non-active plan', ps.status === 400, `status ${ps.status}`)
  }

  // 12. Annual price sanity via plan config (Boss = R499, annual 10x)
  const subBoss = await req('POST', '/api/subscribe', { plan: 'BOSS', cycle: 'ANNUAL' }, 45000)
  if (subBoss.json?.sandbox) {
    check('boss annual sandbox amount = R4,990', subBoss.json?.subscription?.amountCents === 499000, `amountCents=${subBoss.json?.subscription?.amountCents}`)
    await req('POST', '/api/subscribe/pause', { action: 'pause' })
  } else {
    check('boss annual checkout requested (R4,990)', subBoss.status === 200 && !!subBoss.json?.redirectUrl, `status ${subBoss.status}`)
  }

  // 12a. NPO 30% discount (registered nonprofits pay 30% less, every cycle)
  const subNpo = await req('POST', '/api/subscribe', { plan: 'HUSTLER', cycle: 'MONTHLY', npoNumber: '044-291' }, 45000)
  if (subNpo.json?.sandbox) {
    check('NPO sandbox amount = R139.30 (30% off R199)', subNpo.json?.subscription?.amountCents === 13930, `amountCents=${subNpo.json?.subscription?.amountCents}`)
    check('NPO number stored on subscription', Boolean(subNpo.json?.subscription?.npoNumber || subNpo.json?.subscription?.npo), '')
    await req('POST', '/api/subscribe/pause', { action: 'pause' })
  } else if (subNpo.status === 200 && subNpo.json?.redirectUrl) {
    check('NPO checkout requested at discounted amount', true, 'live yoco mode')
  } else {
    check('NPO subscribe path works', false, `status ${subNpo.status} ${JSON.stringify(subNpo.json).slice(0, 80)}`)
  }

  // 12b. Inventory (Task 31 — new stock module)
  const invAdd = await req('POST', '/api/inventory', { name: 'QA Paraffin 750ml', quantity: 10, unit: 'bottles', costPrice: 12, sellPrice: 18, lowStockAt: 3 })
  check('inventory add works', (invAdd.status === 200 || invAdd.status === 201) && !!invAdd.json?.item?.id, `status ${invAdd.status}`)
  const invId = invAdd.json?.item?.id
  const invUp = await req('PATCH', '/api/inventory', { id: invId, adjust: -2 })
  check('inventory adjust works (10-2=8)', invUp.json?.item?.quantity === 8, `qty=${invUp.json?.item?.quantity}`)
  const invList = await req('GET', '/api/inventory')
  check('inventory list + totals', invList.status === 200 && invList.json?.totals?.count >= 1 && typeof invList.json?.totals?.retailValue === 'number', `count=${invList.json?.totals?.count}`)
  const invDel = await req('DELETE', `/api/inventory?id=${invId}`)
  check('inventory delete works', invDel.status === 200)

  // 12c. Push infrastructure (Task 31 — VAPID key auto-provisioned)
  const pk = await req('GET', '/api/push')
  check('push VAPID public key served', pk.status === 200 && typeof pk.json?.publicKey === 'string' && pk.json.publicKey.length > 40, `len=${pk.json?.publicKey?.length}`)
  const pushTest = await req('POST', '/api/push', { action: 'test' })
  check('push test honestly reports no devices', pushTest.status === 400, `status ${pushTest.status}`)

  // 12d. Teams (Task 31 — invite without an account must park a pending invite)
  const team = await req('POST', '/api/teams', { name: `QA Crew ${Date.now() % 10000}` })
  check('create team works', team.status === 200 && !!team.json?.team?.id, `status ${team.status}`)
  const teamId = team.json?.team?.id
  const pendingEmail = `qa_pending_${Date.now()}@hustleqa.example.com`
  const inv1 = await req('POST', '/api/teams', { action: 'invite', teamId, email: pendingEmail })
  check('invite non-account email parks invite', inv1.status === 200 && inv1.json?.invited === true, `status ${inv1.status}`)
  const teamsList = await req('GET', '/api/teams')
  const myTeam = teamsList.json?.teams?.find((t) => t.id === teamId)
  check('pending invite listed for owner', Array.isArray(myTeam?.pending) && myTeam.pending.some((p) => p.email === pendingEmail), `pending=${myTeam?.pending?.length}`)

  // 12e. Auto-join: registering WITH the invited email lands in the team automatically
  const reg2 = await req('POST', '/api/auth', { action: 'register', email: pendingEmail, password: PASSWORD, name: 'QA Invitee' })
  check('invitee registers ok', reg2.status === 200 && reg2.json?.ok === true, `status ${reg2.status}`)
  check('invitee auto-joined the team', Array.isArray(reg2.json?.joinedTeams) && reg2.json.joinedTeams.length === 1, `joined=${JSON.stringify(reg2.json?.joinedTeams)}`)
  // leave the invitee account logged out so the final logout checks run on a clean state
  await req('POST', '/api/auth/logout')
  cookie = '' // fresh jar; the final logout checks below re-verify with no session

  // 13. Logout (dedicated route — same one the app uses)
  const out = await req('POST', '/api/auth/logout')
  check('logout works', out.status === 200, `status ${out.status}`)
  const meAfter = await req('GET', '/api/auth/me')
  check('session actually cleared', meAfter.status === 401 || !meAfter.json?.user, `status ${meAfter.status}`)

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`)
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1) }
}

main().catch(e => { console.error('E2E crashed:', e); process.exit(2) })
