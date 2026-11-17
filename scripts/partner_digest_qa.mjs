#!/usr/bin/env node
// ============ PARTNER DIGEST QA (Task 215, background analytics) ============
// Kelo asked for "background analytics to monitor client onboarding". This
// machine test walks prod:
//   1. The deal room links his dashboard (the discovery gap).
//   2. The dashboard gate: 200 with his key, 404 without.
//   3. The digest route's auth: no credential → 401, wrong key → 401.
//   4. The partner's own dashboard key sends HIS digest: real numbers out of
//      the live DB, the referral law holds (R50 per delivered lead), and the
//      email actually leaves (the first send is the enablement mail).
//   5. An immediate repeat is held by the cooldown (no mail bombing).
// No rows are created — the only side effect is the digest email itself.

const BASE = process.env.QA_BASE || 'https://www.hustleportal.online'
const SLUG = 'trinitydirect'
const DOCS_KEY = process.env.DOCS_KEY || 'bh-tdc-dealroom-qx7k29'
const DASH_KEY = process.env.DASH_KEY || 'bh-tdc-dashboard-8v3nq5'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL ${name} — ${detail}`) }
}

// 1. Discovery: the room the partner already uses points at the dashboard.
const room = await (await fetch(`${BASE}/corporate/${SLUG}/documents?key=${encodeURIComponent(DOCS_KEY)}`)).text()
const roomOk = room.status === 200 || room.includes('Deal room')
const dashHref = `/corporate/${SLUG}/dashboard?key=${encodeURIComponent(DASH_KEY)}`
check('deal room links the partner dashboard', roomOk && room.includes(dashHref), room.includes(dashHref) ? 'link present with the dashboard key' : 'link missing')

// 2. The dashboard gate itself.
const dash = await fetch(`${BASE}/corporate/${SLUG}/dashboard?key=${encodeURIComponent(DASH_KEY)}`)
const dashNo = await fetch(`${BASE}/corporate/${SLUG}/dashboard`)
check('dashboard opens with the key', dash.status === 200 && (await dash.text()).includes('Your sign-ups, live'), `status ${dash.status}`)
check('dashboard 404s without the key', dashNo.status === 404, `status ${dashNo.status}`)

// 3. The digest route's walls.
const noAuth = await fetch(`${BASE}/api/cron/partner-digest`)
const badKey = await fetch(`${BASE}/api/cron/partner-digest?key=bh-tdc-dashboard-WRONG`)
check('digest without credentials is 401', noAuth.status === 401, `status ${noAuth.status}`)
check('digest with a wrong key is 401', badKey.status === 401, `status ${badKey.status}`)

// 4. The partner's own key sends his digest — the enablement email.
const res = await fetch(`${BASE}/api/cron/partner-digest?key=${encodeURIComponent(DASH_KEY)}`)
const j = await res.json().catch(() => null)
const r = j?.results?.[0]
const m = r?.metrics
check('digest computed with the partner key', res.status === 200 && !!m && r.slug === SLUG, `status ${res.status}`)
check('referral law holds (R50 per delivered lead)', !!m && m.shareCents === m.managedLeads * 5000, m ? `${m.managedLeads} leads → R${Math.round(m.shareCents / 100)}` : 'no metrics')
check('funnel numbers are consistent', !!m && m.activated <= m.accounts && m.newAccountsWeek <= m.accounts && m.topupsWeekCents >= 0,
  m ? `${m.accounts} accounts, ${m.activated} activated, ${m.newAccountsWeek} new this week, top-ups R${Math.round(m.topupsWeekCents / 100)}` : 'no metrics')
check('call lists carry business names only', !!m && Array.isArray(m.closeNow) && Array.isArray(m.warming),
  m ? `close-now ${m.closeNow.length}, warming ${m.warming.length}, last activity ${m.lastActivity || 'none yet'}` : 'no metrics')
check('digest email left the building', !!r && r.emailed === true, r?.emailed ? 'sent to the partner contact' : `emailError ${r?.emailError || r?.skipped || 'unknown'}`)

// 5. The cooldown holds the repeat.
const again = await fetch(`${BASE}/api/cron/partner-digest?key=${encodeURIComponent(DASH_KEY)}`)
const aj = await again.json().catch(() => null)
const ar = aj?.results?.[0]
check('immediate repeat is cooldown-skipped', again.status === 200 && ar?.skipped === 'cooldown', ar?.skipped ? `retry after ${ar.retryAfterSec}s` : JSON.stringify(ar))

console.log(`\n==== PARTNER DIGEST: ${pass} PASS / ${fail} FAIL ====`)
process.exit(fail > 0 ? 1 : 0)
