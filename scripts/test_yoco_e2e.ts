/**
 * Yoco payment integration E2E test.
 * Runs against a dev server on :3001 (started by the calling bash script with explicit env).
 * Exercises: sandbox topup, real-checkout branch, webhook verification (signature/timestamp/replay),
 * credit idempotency, failed-payment handling, fallback matching, webhook registration route.
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001'
const EMAIL = 'demo@hustleportal.co.za'
const PASSWORD = 'Hustle123!'

let cookie = ''
let pass = 0
let fail = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  for (const c of setCookie) {
    const kv = c.split(';')[0]
    if (kv.includes('=')) cookie = kv
  }
  let data: any = {}
  try {
    data = await res.json()
  } catch {}
  return { status: res.status, data }
}

/** Standard Webhooks signing, mirroring Yoco's scheme. */
function signPayload(secret: string, body: string, opts?: { id?: string; ts?: number }) {
  const id = opts?.id ?? `msg_${crypto.randomBytes(8).toString('hex')}`
  const ts = opts?.ts ?? Math.floor(Date.now() / 1000)
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  return { id: String(id), ts: String(ts), sig: `v1,${sig}` }
}

async function walletBalance() {
  const r = await api('GET', '/api/wallet')
  return r.data?.wallet?.balance as number
}

async function main() {
  console.log(`\n══ Yoco E2E against ${BASE} ══\n`)

  // ── Reset state from any previous run ──────────────────
  await prisma.platformConfig.deleteMany({ where: { key: 'yoco_webhook_secret' } })
  await prisma.topUp.deleteMany({ where: { reference: { startsWith: 'HP-TEST' } } })

  // ── Login ──────────────────────────────────────────────
  const login = await api('POST', '/api/auth', { action: 'login', email: EMAIL, password: PASSWORD })
  check('login ok', login.status === 200 && login.data?.ok === true, `status=${login.status}`)
  if (login.status !== 200) process.exit(1)

  // ── Phase A1: sandbox topup (no YOCO_SECRET_KEY) ───────
  console.log('A1. Sandbox top-up (no key configured)')
  const bal0 = await walletBalance()
  const t1 = await api('POST', '/api/wallet/topup', { packageId: 'starter' })
  check('sandbox topup ok', t1.status === 200 && t1.data?.sandbox === true && t1.data?.topUp?.status === 'PAID', `status=${t1.status} provider=${t1.data?.topUp?.provider}`)
  const bal1 = await walletBalance()
  check('credits added instantly', bal1 === bal0 + 50000, `${bal0} -> ${bal1}`)

  // ── Phase A2: webhook unconfigured -> 503 ──────────────
  console.log('A2. Webhook without configured secret')
  const w0 = await api('POST', '/api/webhooks/yoco', { type: 'payment.succeeded', payload: {} })
  check('503 when secret not set', w0.status === 503, `status=${w0.status}`)

  // ── Phase A3: register route without sk key -> 400 ─────
  console.log('A3. Webhook registration without secret key')
  const r0 = await api('POST', '/api/webhooks/yoco/register', {})
  check('400 when YOCO_SECRET_KEY missing', r0.status === 400, `status=${r0.status} err=${r0.data?.error}`)

  // ── Phase A4: webhook with config-stored secret ────────
  console.log('A4. Webhook verification + crediting (secret via DB config)')
  const WHSEC_RAW = crypto.randomBytes(24).toString('base64')
  const WHSEC = `whsec_${WHSEC_RAW}`
  await prisma.platformConfig.upsert({
    where: { key: 'yoco_webhook_secret' },
    update: { value: WHSEC },
    create: { key: 'yoco_webhook_secret', value: WHSEC },
  })

  // PENDING topups to reconcile (as if checkout had been created)
  const user = await prisma.user.findUnique({ where: { email: EMAIL } })
  if (!user) throw new Error('demo user missing')
  const pend1 = await prisma.topUp.create({
    data: { userId: user.id, packageId: 'growth', amountCents: 150000, creditCents: 165000, status: 'PENDING', provider: 'YOCO', reference: 'HP-TEST1' },
  })
  const pend2 = await prisma.topUp.create({
    data: { userId: user.id, packageId: 'growth', amountCents: 150000, creditCents: 165000, status: 'PENDING', provider: 'YOCO', reference: 'HP-TEST2' },
  })
  const pend3 = await prisma.topUp.create({
    data: { userId: user.id, packageId: 'scale', amountCents: 500000, creditCents: 575000, status: 'PENDING', provider: 'YOCO', reference: 'HP-TEST3' },
  })

  const bal2 = await walletBalance()

  // valid signed success with metadata — raw fetch to sign the EXACT bytes sent
  async function rawWebhook(rawBody: string, headers: Record<string, string>) {
    return fetch(`${BASE}/api/webhooks/yoco`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: rawBody,
    })
  }
  // The helper re-serializes; to sign the EXACT bytes sent, do a raw fetch here:
  const body1 = JSON.stringify({
    id: 'evt_1', type: 'payment.succeeded',
    payload: { amount: 150000, currency: 'ZAR', id: 'pay_abc123', mode: 'test', status: 'succeeded', metadata: { topUpId: pend1.id, reference: 'HP-TEST1' } },
  })
  const s1 = signPayload(WHSEC, body1)
  const raw1 = await rawWebhook(body1, { 'webhook-id': s1.id, 'webhook-timestamp': s1.ts, 'webhook-signature': s1.sig })
  const raw1data = await raw1.json() as any
  check('signed payment.succeeded accepted', raw1.status === 200 && raw1data.credited === 165000, `status=${raw1.status} resp=${JSON.stringify(raw1data)}`)
  const after1 = await prisma.topUp.findUnique({ where: { id: pend1.id } })
  check('topup marked PAID', after1?.status === 'PAID' && Boolean(after1?.paidAt), `status=${after1?.status}`)
  const bal3 = await walletBalance()
  check('wallet credited +R1650', bal3 === bal2 + 165000, `${bal2} -> ${bal3}`)

  // replay same delivery -> idempotent
  const raw1b = await rawWebhook(body1, { 'webhook-id': s1.id, 'webhook-timestamp': s1.ts, 'webhook-signature': s1.sig })
  const raw1bData = await raw1b.json() as any
  const bal3b = await walletBalance()
  check('replay is idempotent', raw1b.status === 200 && raw1bData.idempotent === true && bal3b === bal3, `resp=${JSON.stringify(raw1bData)} bal=${bal3b}`)

  // invalid signature -> 401
  const raw2 = await rawWebhook(body1, { 'webhook-id': 'msg_x', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,AAAAinvalidAAAA==' })
  check('invalid signature rejected 401', raw2.status === 401, `status=${raw2.status}`)

  // stale timestamp -> 401
  const stale = signPayload(WHSEC, body1, { ts: Math.floor(Date.now() / 1000) - 3600 })
  const raw3 = await rawWebhook(body1, { 'webhook-id': stale.id, 'webhook-timestamp': stale.ts, 'webhook-signature': stale.sig })
  check('stale timestamp rejected 401', raw3.status === 401, `status=${raw3.status}`)

  // payment.failed marks PENDING -> FAILED
  const body4 = JSON.stringify({
    id: 'evt_2', type: 'payment.failed',
    payload: { amount: 150000, id: 'pay_def456', mode: 'test', status: 'failed', metadata: { topUpId: pend2.id } },
  })
  const s4 = signPayload(WHSEC, body4)
  const raw4 = await rawWebhook(body4, { 'webhook-id': s4.id, 'webhook-timestamp': s4.ts, 'webhook-signature': s4.sig })
  const after2 = await prisma.topUp.findUnique({ where: { id: pend2.id } })
  check('payment.failed marks FAILED', raw4.status === 200 && after2?.status === 'FAILED', `status=${after2?.status}`)

  // fallback matching: no metadata, match by amount + PENDING
  const body5 = JSON.stringify({
    id: 'evt_3', type: 'payment.succeeded',
    payload: { amount: 500000, currency: 'ZAR', id: 'pay_ghi789', mode: 'test', status: 'succeeded' },
  })
  const s5 = signPayload(WHSEC, body5)
  const raw5 = await rawWebhook(body5, { 'webhook-id': s5.id, 'webhook-timestamp': s5.ts, 'webhook-signature': s5.sig })
  const raw5data = await raw5.json() as any
  check('fallback amount matching works', raw5.status === 200 && raw5data.credited === 575000, `resp=${JSON.stringify(raw5data)}`)
  const bal4 = await walletBalance()
  check('wallet credited +R5750 (fallback)', bal4 === bal3b + 575000, `${bal3b} -> ${bal4}`)

  // unknown event type acked
  const body6 = JSON.stringify({ id: 'evt_4', type: 'payment.refunded', payload: {} })
  const s6 = signPayload(WHSEC, body6)
  const raw6 = await rawWebhook(body6, { 'webhook-id': s6.id, 'webhook-timestamp': s6.ts, 'webhook-signature': s6.sig })
  check('unknown event acked 200', raw6.status === 200, `status=${raw6.status}`)

  // cleanup test topups (keep ledger honest: remove the credit added? — leave tx, remove test rows)
  await prisma.topUp.deleteMany({ where: { reference: { in: ['HP-TEST1', 'HP-TEST2', 'HP-TEST3'] } } })
  await prisma.creditTx.deleteMany({ where: { description: { contains: '(HP-TEST' } } })
  await prisma.wallet.update({ where: { userId: user.id }, data: { balance: bal2 } })

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`)
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('FATAL', e)
  await prisma.$disconnect()
  process.exit(1)
})
