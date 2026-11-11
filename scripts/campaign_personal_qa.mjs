// Campaign greeting personalization QA — the "Hi Michael" fix, end to end.
//
// The live bug: Edit-draft loaded ONE row's already-filled copy and the save
// flattened it onto every queued row, so a whole audience received "Hi
// Michael". This QA walks the exact member flow against a local dev server:
//
//   A. build a queue with {name} tokens  → per-recipient first-name fills
//   B. save a flattened letter ("Hi Michael") via editDraft → healed, every
//      row re-greeted from its own contact, master draft stored
//   C. legacy queue (no master draft, rows flattened by hand) → the Start
//      gate re-tokenizes and re-personalizes before anything sends
//   D. explicit opt-out (personalize: false) → byte-identical letter, Start
//      leaves it untouched
//   E. {email} fills per recipient
//   F. static greetings (Hi team) are never "healed"
//
// Run (dev server on :3000, schema pushed to the same DB):
//   DATABASE_URL="postgresql://postgres@127.0.0.1:54329/hustleportal" node scripts/campaign_personal_qa.mjs
import { PrismaClient } from '@prisma/client'

const BASE = process.env.HP_BASE || 'http://localhost:3000'
const db = new PrismaClient()

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}${extra ? ` :: ${extra}` : ''}`) }
  else { failed++; console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`) }
}

function cookieOf(res) {
  const raw = res.setCookie || ''
  return raw.split(';')[0]
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    let json = null
    try { json = await res.json() } catch { /* empty */ }
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') }
  } finally { clearTimeout(t) }
}

const TS = Date.now()
const MAIL = (n) => `${n}qa${TS}@hustleqa.local`

async function rowsFor(tag) {
  return db.emailLog.findMany({ where: { campaign: tag }, orderBy: { toEmail: 'asc' } })
}

function stateOf(tag) {
  return db.platformConfig.findUnique({ where: { key: `campaign_state:${tag}` } })
}

async function main() {
  console.log(`== Campaign greeting personalization QA :: ${BASE} ==`)

  // Clean slate for this run's data
  await db.user.deleteMany({ where: { email: { contains: `qa${TS}@hustleqa.local` } } })
  await db.platformConfig.deleteMany({ where: { key: { startsWith: 'campaign_state:u-qa-personal' } } })
  await db.emailLog.deleteMany({ where: { campaign: { startsWith: 'u-qa-personal' } } })

  // Member account, upgraded
  const email = `memberqa${TS}@hustleqa.local`
  const reg = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'hustle123', name: 'QA Member', businessName: 'QA Trades', city: 'Soweto', industry: 'Retail' } })
  check('member registers', reg.status === 200, `status ${reg.status}`)
  const cookie = cookieOf(reg)
  const me = await db.user.findUnique({ where: { email } })
  await db.subscription.upsert({
    where: { userId: me.id },
    update: {},
    create: {
      userId: me.id, plan: 'HUSTLER', status: 'ACTIVE', billingCycle: 'MONTHLY',
      amountCents: 19900, provider: 'YOCO', reference: `QA-${TS}`,
      startedAt: new Date(), renewsAt: new Date(Date.now() + 30 * 86400000),
    },
  })

  // Leads: one Michael (the flattened name), one plain name, one honorific, one nameless
  const leads = await Promise.all([
    db.lead.create({ data: { userId: me.id, company: 'Dunder Mifflin SA', contactName: 'Michael Scott', email: MAIL('michael'), unlocked: true, source: 'MANUAL' } }),
    db.lead.create({ data: { userId: me.id, company: 'Mokoena Brands', contactName: 'Thabo Mokoena', email: MAIL('thabo'), unlocked: true, source: 'MANUAL' } }),
    db.lead.create({ data: { userId: me.id, company: 'Khumalo Care', contactName: 'Dr Naledi Khumalo', email: MAIL('naledi'), unlocked: true, source: 'MANUAL' } }),
    db.lead.create({ data: { userId: me.id, company: 'Nameless PTY', contactName: null, email: MAIL('noname'), unlocked: true, source: 'MANUAL' } }),
  ])

  // ---- A. tokenized build → per-recipient first-name fills ----
  const tagA = 'u-qa-personal-token'
  const bodyA = 'Hi {name},\n\nThis QA letter is long enough to queue and carries the token fill.'
  const a = await call('/api/campaigns', {
    method: 'POST', cookie,
    body: { campaign: 'qa-personal-token', subject: 'Quick one, {name}', body: bodyA, leads: leads.map((l) => l.id), perHour: 120, theme: 'plain', brand: null },
  })
  check('A1 queue builds', a.status === 200, `status ${a.status} ${JSON.stringify(a.json?.error || '')}`)
  check('A2 personalized flag true', a.json?.personalized === true)
  const rowsA = await rowsFor(tagA)
  check('A3 four rows queued', rowsA.length === 4, `rows ${rowsA.length}`)
  const bodyByPrefix = (rows, p) => rows.find((r) => r.toEmail.startsWith(p))?.body || ''
  check('A4 Michael greeted by first name', bodyByPrefix(rowsA, 'michael').startsWith('Hi Michael,'), bodyByPrefix(rowsA, 'michael').slice(0, 22))
  check('A5 Thabo greeted by first name', bodyByPrefix(rowsA, 'thabo').startsWith('Hi Thabo,'), bodyByPrefix(rowsA, 'thabo').slice(0, 22))
  check('A6 honorific stripped (Dr Naledi → Naledi)', bodyByPrefix(rowsA, 'naledi').startsWith('Hi Naledi,'), bodyByPrefix(rowsA, 'naledi').slice(0, 22))
  check('A7 nameless contact rides "there"', bodyByPrefix(rowsA, 'noname').startsWith('Hi there,'), bodyByPrefix(rowsA, 'noname').slice(0, 22))
  const stateA = await stateOf(tagA)
  check('A8 master draft stored with tokens', JSON.parse(stateA.value).draft?.body?.includes('{name}') === true, JSON.parse(stateA.value).draft?.body?.slice(0, 14))

  // ---- B. the live bug's exact shape: a flattened "Hi Michael" save heals ----
  const b = await call('/api/campaigns', {
    method: 'PATCH', cookie,
    body: { campaign: 'qa-personal-token', action: 'editDraft', subject: 'Hi Michael, quick quote', body: 'Hi Michael,\n\nThis is the flattened letter the editor would have spread to everyone, long enough to queue.' },
  })
  check('B1 flattened save accepted', b.status === 200, `status ${b.status} ${JSON.stringify(b.json?.error || '')}`)
  check('B2 save reports greetingHealed', b.json?.greetingHealed === true)
  const rowsB = await rowsFor(tagA)
  check('B3 Michael row still greets Michael', bodyByPrefix(rowsB, 'michael').startsWith('Hi Michael,'), bodyByPrefix(rowsB, 'michael').slice(0, 22))
  check('B4 Thabo row re-greeted (no more Michael)', bodyByPrefix(rowsB, 'thabo').startsWith('Hi Thabo,'), bodyByPrefix(rowsB, 'thabo').slice(0, 22))
  check('B5 Naledi row re-greeted', bodyByPrefix(rowsB, 'naledi').startsWith('Hi Naledi,'), bodyByPrefix(rowsB, 'naledi').slice(0, 22))
  check('B6 nameless row rides "there"', bodyByPrefix(rowsB, 'noname').startsWith('Hi there,'), bodyByPrefix(rowsB, 'noname').slice(0, 22))
  check('B7 subject re-personalized too', rowsB.find((r) => r.toEmail.startsWith('thabo'))?.subject === 'Hi Thabo, quick quote', rowsB.find((r) => r.toEmail.startsWith('thabo'))?.subject)
  const stateB = JSON.parse((await stateOf(tagA)).value)
  check('B8 master draft holds {name}, not Michael', stateB.draft?.body?.includes('Hi {name}') === true, stateB.draft?.body?.slice(0, 14))

  // ---- C. legacy queue: rows flattened by hand, no master draft, Start heals ----
  const tagC = 'u-qa-personal-legacy'
  await call('/api/campaigns', {
    method: 'POST', cookie,
    body: { campaign: 'qa-personal-legacy', subject: 'Legacy letter', body: 'Hello {name},\n\nA legacy queue letter with enough body to pass the gate.', leads: leads.map((l) => l.id), perHour: 120, theme: 'plain', brand: null },
  })
  // Simulate the pre-fix world: strip the master draft and flatten every row
  const stC = await stateOf(tagC)
  const parsedC = JSON.parse(stC.value)
  delete parsedC.draft
  await db.platformConfig.update({ where: { key: stC.key }, data: { value: JSON.stringify(parsedC) } })
  await db.emailLog.updateMany({ where: { campaign: tagC }, data: { subject: 'Legacy letter', body: 'Hi Michael,\n\nA legacy queue flattened by hand, exactly like the live bug did, long enough.' } })
  const c = await call('/api/campaigns', { method: 'PATCH', cookie, body: { campaign: 'qa-personal-legacy', action: 'start' } })
  check('C1 start accepted', c.status === 200, `status ${c.status} ${JSON.stringify(c.json?.error || '')}`)
  check('C2 start reports greetingHealed', c.json?.greetingHealed === true)
  const rowsC = await rowsFor(tagC)
  check('C3 legacy queue re-greeted per contact (Thabo)', bodyByPrefix(rowsC, 'thabo').startsWith('Hi Thabo,'), bodyByPrefix(rowsC, 'thabo').slice(0, 24))
  check('C4 legacy queue re-greeted (Naledi)', bodyByPrefix(rowsC, 'naledi').startsWith('Hi Naledi,'), bodyByPrefix(rowsC, 'naledi').slice(0, 26))
  check('C5 legacy queue nameless rides "there"', bodyByPrefix(rowsC, 'noname').startsWith('Hi there,'), bodyByPrefix(rowsC, 'noname').slice(0, 25))
  const stateC = JSON.parse((await stateOf(tagC)).value)
  check('C6 master draft rebuilt at Start', stateC.draft?.body?.includes('{name}') === true)

  // ---- D. explicit opt-out rides byte-identical, Start leaves it alone ----
  const tagD = 'u-qa-personal-static'
  const bodyD = 'Hi Michael,\n\nOne static letter for everyone by explicit choice, long enough to pass the gate.'
  const d = await call('/api/campaigns', {
    method: 'POST', cookie,
    body: { campaign: 'qa-personal-static', subject: 'Static letter', body: bodyD, leads: leads.map((l) => l.id), perHour: 120, theme: 'plain', brand: null, personalize: false },
  })
  check('D1 opt-out queue builds', d.status === 200, `status ${d.status}`)
  check('D2 personalized flag false', d.json?.personalized === false)
  const rowsD = await rowsFor(tagD)
  check('D3 opt-out rows byte-identical (Hi Michael everywhere)', rowsD.every((r) => r.body === bodyD), rowsD.map((r) => r.body.slice(0, 10)).join('|'))
  await call('/api/campaigns', { method: 'PATCH', cookie, body: { campaign: 'qa-personal-static', action: 'pause' } })
  const dStart = await call('/api/campaigns', { method: 'PATCH', cookie, body: { campaign: 'qa-personal-static', action: 'start' } })
  check('D4 opt-out start does not heal', dStart.json?.greetingHealed === undefined || dStart.json?.greetingHealed === false)
  const rowsD2 = await rowsFor(tagD)
  check('D5 opt-out rows untouched after Start', rowsD2.every((r) => r.body === bodyD))

  // ---- E. {email} fills per recipient ----
  const tagE = 'u-qa-personal-email'
  await call('/api/campaigns', {
    method: 'POST', cookie,
    body: { campaign: 'qa-personal-email', subject: 'Your address', body: 'Hi {name}, we will write to {email} — this QA letter is long enough to queue.', leads: leads.map((l) => l.id), perHour: 120, theme: 'plain', brand: null },
  })
  const rowsE = await rowsFor(tagE)
  check('E1 {email} fills per row', rowsE.every((r) => r.body.includes(r.toEmail)), rowsE.map((r) => r.toEmail.split('@')[0]).join('|'))

  // ---- F. static greetings are never healed ----
  const f = await call('/api/campaigns', {
    method: 'PATCH', cookie,
    body: { campaign: 'qa-personal-email', action: 'editDraft', subject: 'Team note', body: 'Hi team,\n\nThis one greets the room on purpose and is long enough to pass the gate.' },
  })
  check('F1 static greeting not healed', f.json?.greetingHealed === false, `healed=${f.json?.greetingHealed}`)
  const rowsF = await rowsFor(tagE)
  check('F2 static greeting rides for everyone', rowsF.every((r) => r.body.startsWith('Hi team,')), rowsF[0]?.body?.slice(0, 10))

  console.log(`\n== ${passed} passed, ${failed} failed ==`)
  await db.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('QA crashed:', e)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
