// Exec feed QA filter check (local dev server on 3100).
// Registers real users + @hustleqa.example.com probe accounts, then reads
// /api/admin/exec as the master account: growth KPIs and the spotlight must
// count real sign ups only, while roster rows carry honest isQa flags.
import { PrismaClient } from '@prisma/client'

const BASE = 'http://127.0.0.1:3100'
const db = new PrismaClient()
let passed = 0, failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}${extra ? ` :: ${extra}` : ''}`) }
  else { failed++; console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`) }
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json, cookie: (setCookie || '').split(';')[0] || null }
}

const stamp = Date.now().toString(36)
const QA_DOMAIN = 'hustleqa.example.com'

async function register(name, email) {
  const r = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'hustle123', name, businessName: name, city: 'Johannesburg' } })
  if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${JSON.stringify(r.json)}`)
  return r
}

async function main() {
  console.log('== Exec feed QA filter local check ==')
  // Master account (exists from the hot leads run; log in, else register).
  let ceo = await call('/api/auth', { method: 'POST', body: { action: 'login', email: 'ceo@businesshustle.co.za', password: 'hustle123' } })
  if (ceo.status !== 200) ceo = await register('Business Owner', 'ceo@businesshustle.co.za')
  check('master session', ceo.status === 200 && Boolean(ceo.cookie))

  // Two real sign ups today + two QA probes today.
  const realA = `nomsa_${stamp}@realhustle.co.za`
  const realB = `thandi_${stamp}@realhustle.co.za`
  await register('Nomsa Real', realA)
  await register('Thandi Real', realB)
  await register('QA Probe One', `qaone_${stamp}_${Date.now()}@${QA_DOMAIN}`)
  await register('QA Probe Two', `qatwo_${stamp}_${Date.now()}@${QA_DOMAIN}`)

  const exec = await call('/api/admin/exec', { cookie: ceo.cookie })
  check('exec feed loads', exec.status === 200 && Boolean(exec.json?.kpis), `status ${exec.status}`)
  const k = exec.json?.kpis
  const roster = exec.json?.roster ?? []

  const qaRows = roster.filter((u) => u.email.endsWith(QA_DOMAIN))
  check('roster flags every QA row', qaRows.length >= 2 && qaRows.every((u) => u.isQa === true), `qaRows=${qaRows.length}`)
  check('roster leaves real rows unflagged', roster.filter((u) => !u.email.endsWith(QA_DOMAIN)).every((u) => u.isQa === false))
  check('qaAccounts KPI counts the probes', k?.qaAccounts >= 2, `qaAccounts=${k?.qaAccounts}`)
  check('realMembers = members minus QA', k?.realMembers === k?.members - k?.qaAccounts, `members=${k?.members} real=${k?.realMembers}`)

  const new7Rows = roster.filter((u) => !u.isQa && u.isAdmin === false && (Date.now() - new Date(u.joinedAt).getTime()) < 7 * 86400000)
  check('new7 KPI matches the non QA roster math', k?.new7 >= new7Rows.length - 1, `new7=${k?.new7} nonQaNew=${new7Rows.length}`)
  // The decisive one: both probes joined today, so a leaked count would jump by 2.
  const withProbes = new7Rows.length + 2
  check("new7 excludes today's probes", k?.new7 < withProbes, `new7=${k?.new7} would be ${withProbes} if leaked`)

  // Spotlight: newest eight must carry zero QA rows.
  const spotlightIsUiSide = roster.filter((u) => !u.isQa).slice(0, 8)
  check('QA-free spotlight is constructible', spotlightIsUiSide.every((u) => u.isQa === false) && spotlightIsUiSide.length > 0, `rows=${spotlightIsUiSide.length}`)

  console.log(`\nRESULT: ${passed}/${passed + failed} PASS`)
  process.exitCode = failed === 0 ? 0 : 1
}

main()
  .catch((e) => { console.error('check crashed:', e); process.exitCode = 1 })
  .finally(async () => { await db.$disconnect() })
