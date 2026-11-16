#!/usr/bin/env node
/**
 * Live verification of the onboarding workflow fix (f711de1):
 * 1. fresh QA seat answers the three question survey, valueProp lands on the
 *    default workspace
 * 2. the replay law: a second answer never overwrites the workspace line
 * 3. the AI business plan generates on the GLM engine (no Gemini key needed)
 * Run: node scripts/onboard_fix_live_test.mjs
 */
const BASE = 'https://www.hustleportal.online'
let pass = 0, fail = 0
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS ${n}${d ? ' :: ' + d : ''}`) } else { fail++; console.log(`  FAIL ${n}${d ? ' :: ' + d : ''}`) } }
async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text().catch(() => '')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, headers: res.headers, setCookie: res.headers.get('set-cookie') }
}

const email = `onboardfix_${Date.now()}@hustleqa.example.com`
const reg = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'OnboardFix2026!', name: 'Onboard Fix QA' } })
const cookie = (reg.setCookie || '').split(';')[0]
check('QA seat registered', Boolean(cookie), email)

// 1. the three question survey, incl. the promised business line
const LINE = 'We wash and detail cars at offices and homes around Sandton, booked on WhatsApp.'
const ob = await call('/api/onboard', { method: 'POST', cookie, body: { persona: 'FIND_CLIENTS', profession: 'ENTREPRENEUR', valueProp: LINE } })
check('onboard accepts the three answers', ob.status === 200 && ob.json?.ok === true, `status ${ob.status}`)
check('onboardedAt stamped', Boolean(ob.json?.user?.onboardedAt))

const pr = await call('/api/projects', { cookie })
const def = (pr.json?.projects || []).find((p) => p.isDefault) || (pr.json?.projects || [])[0]
check('default workspace exists', Boolean(def?.id), def?.name || 'none')
check('valueProp landed on the workspace', def?.valueProp === LINE, (def?.valueProp || '(empty)').slice(0, 60))

// 2. replay law: a later answer never overwrites the workspace line
const ob2 = await call('/api/onboard', { method: 'POST', cookie, body: { persona: 'GET_PAID', profession: 'ACCOUNTANT', valueProp: 'A totally different line.' } })
check('replay accepted (idempotent survey)', ob2.status === 200 && ob2.json?.user?.persona === 'GET_PAID')
const pr2 = await call('/api/projects', { cookie })
const def2 = (pr2.json?.projects || []).find((p) => p.isDefault)
check('workspace line NOT overwritten on replay', def2?.valueProp === LINE, (def2?.valueProp || '(empty)').slice(0, 60))

// 3. the AI business plan on the GLM engine
const plan = await call('/api/ai/plan', {
  method: 'POST', cookie,
  body: {
    business: LINE,
    targetMarket: 'Office park managers and busy homeowners in Sandton',
    revenueModel: 'Per wash pricing plus monthly packages',
    competitors: 'Shopping mall car washes, but we come to the customer',
    goals: '40 monthly package customers in 6 months',
  },
})
check('AI plan generated (GLM engine, no user key)', plan.status === 200 && Boolean(plan.json?.plan?.content), `status ${plan.status} ${(plan.json?.error || '').slice(0, 80)}`)
const content = plan.json?.plan?.content || ''
check('plan carries the SA-grounded structure', content.includes('##') && /This Week/i.test(content), `${content.length} chars`)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
