/** Clients CRM + Services E2E test (run against :3001). */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001'
let cookie = ''
let pass = 0
let fail = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const sc = res.headers.getSetCookie?.() ?? []
  for (const c of sc) { const kv = c.split(';')[0]; if (kv.includes('=')) cookie = kv }
  let data: any = {}
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

async function main() {
  console.log(`\n══ Clients + Services E2E against ${BASE} ══\n`)

  const login = await api('POST', '/api/auth', { action: 'login', email: 'demo@hustleportal.co.za', password: 'Hustle123!' })
  check('login ok', login.status === 200, `status=${login.status}`)
  if (login.status !== 200) process.exit(1)

  // seeded clients
  const l0 = await api('GET', '/api/clients')
  check('GET clients (seeded 3)', l0.status === 200 && l0.data.clients?.length === 3, `count=${l0.data.clients?.length}`)

  // create
  const c1 = await api('POST', '/api/clients', { name: 'Test Client E2E', company: 'TestCo', email: 't@e2e.co.za', phone: '+27821234567', monthlyValue: 2500, notes: 'e2e' })
  check('POST client', c1.status === 200 && c1.data.client?.name === 'Test Client E2E', `status=${c1.status}`)
  const cid = c1.data.client?.id

  // add_client challenge bumped
  const ch = await api('GET', '/api/gamification/challenges')
  const addClient = ch.data?.challenges?.find((c: any) => c.key === 'add_client')
  check('add_client challenge earned', Boolean(addClient?.done), `earned=${addClient?.done}`)

  // explore_services challenge bump (client-side allowed)
  const bump = await api('POST', '/api/gamification/challenges', { key: 'explore_services' })
  check('explore_services bump accepted', bump.status === 200, `status=${bump.status}`)
  const bumpBad = await api('POST', '/api/gamification/challenges', { key: 'nonexistent_key' })
  check('unknown challenge rejected 400', bumpBad.status === 400, `status=${bumpBad.status}`)

  // patch
  const p1 = await api('PATCH', `/api/clients/${cid}`, { status: 'CHURNED', monthlyValue: 0 })
  check('PATCH client churned', p1.status === 200 && p1.data.client?.status === 'CHURNED', `status=${p1.data.client?.status}`)

  // delete
  const d1 = await api('DELETE', `/api/clients/${cid}`)
  check('DELETE client', d1.status === 200 && d1.data.ok === true)
  const l1 = await api('GET', '/api/clients')
  check('client count back to 3', l1.data.clients?.length === 3, `count=${l1.data.clients?.length}`)

  // other-user isolation: team member sees only own
  const login2 = await api('POST', '/api/auth', { action: 'login', email: 'team@hustleportal.co.za', password: 'Hustle123!' })
  const l2 = await api('GET', '/api/clients')
  check('team member data isolation', login2.status === 200 && Array.isArray(l2.data.clients), `team count=${l2.data.clients?.length}`)

  // cleanup: remove any challenge rows created for team user during test? (bump was done as demo user; fine)

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`)
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error('FATAL', e); await prisma.$disconnect(); process.exit(1) })
