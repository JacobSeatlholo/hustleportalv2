#!/usr/bin/env node
/**
 * Business Hustle first-touch outreach — stage / status / start.
 *
 * The audience: every pipeline lead the boss's own account owns
 * (ceo@businesshustle.co.za), resolved server side by the leadsOf staging
 * source, minus wilscha (a Business Hustle client, excluded by name) and
 * minus every suppressed address (the queue engine refuses them at staging
 * and again before every send). The queue is born PAUSED and nothing can
 * ever send until a human presses Start — twice gated here:
 *   1. this script's `start` command requires GREENLIGHT=yes in the env
 *   2. the platform queue engine itself only sends when the state is ACTIVE
 *
 * Commands:
 *   node scripts/bh_outreach.mjs stage    stage the queue (born PAUSED)
 *   node scripts/bh_outreach.mjs status   read the queue readout
 *   GREENLIGHT=yes node scripts/bh_outreach.mjs start   arm the queue
 *   node scripts/bh_outreach.mjs pause    stop a running queue
 *
 * The draft below is the boss-approved letter (see download/BH_Outreach_Pack.docx).
 * Edit it HERE and in the doc, never on a queued row: the master draft rides
 * the queue state and every save re-personalizes the queued rows.
 */
import { readFileSync } from 'node:fs'

const BASE = 'https://www.hustleportal.online'
const BOSS_ID = 'cmv2lyew70000l806ylm84elw' // ceo@businesshustle.co.za
const EXCLUDE = ['wilscha.skincare@gmail.com'] // Business Hustle client, never pitched
const TAG = 'bh-first-touch-2026-11'
const FROM = 'Business Hustle <hello@hustleportal.online>'
const PER_HOUR = Number(process.env.PER_HOUR || 45)
const PROVIDER = process.env.PROVIDER || 'RESEND' // the free lane; SES stays internal

// The approved letter. Simple english, no dashes, one question set.
const SUBJECT = 'Quick one about finding customers'
const BODY = `Hi {name}

I am Jacob from Business Hustle in Cape Town. I have a quick question and a free offer, and that is the whole email.

Most business owners tell me the same thing. Finding new customers takes the most time and the most money. Not doing the work, finding the people who need the work.

So we built HustlePortal. It finds real businesses in your industry and your city that are growing, hiring or advertising right now, and it puts their contact details in front of you. You open your laptop, you pick your trade, you get a list of people to contact today. It also keeps your quotes, your jobs and your money talk in one place.

Here is the free part. Reply to this email with your industry and your city and I will send you a free sample of real leads for your trade. No payment, no card, no catch. If the sample is good you can carry on inside the app for free and only pay when you want more.

If you have 30 seconds, answer these four and I will make the sample fit you better.

1. How do you find most of your customers today?
2. What eats the most time when you look for new customers?
3. What would a steady list of new customers every month be worth to you?
4. Which industry and city should the free sample come from?

Either way, the free sample stands. Just reply.

Jacob Seatlholo
Business Hustle
HustlePortal, made for South African businesses
Unsubscribe any time, the link is below.`

const cmd = process.argv[2] || ''
if (!['stage', 'status', 'start', 'pause'].includes(cmd)) {
  console.error('usage: node scripts/bh_outreach.mjs <stage|status|start|pause>  (start needs GREENLIGHT=yes)')
  process.exit(2)
}
if (!process.env.OPS_SEAT_PASSWORD) {
  console.error('FAIL fast: export OPS_SEAT_EMAIL and OPS_SEAT_PASSWORD first. Nothing was done.')
  process.exit(2)
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text().catch(() => '')
  let json = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') }
}

const login = await call('/api/auth', { method: 'POST', body: { action: 'login', email: process.env.OPS_SEAT_EMAIL || 'ops@hustleqa.example.com', password: process.env.OPS_SEAT_PASSWORD } })
const cookie = (login.setCookie || '').split(';')[0]
if (!cookie) {
  console.error(`FAIL fast: exec login ${login.status}. Nothing was done.`)
  process.exit(2)
}

if (cmd === 'stage') {
  const r = await call('/api/admin/exec/campaigns', {
    method: 'POST',
    cookie,
    body: { campaign: TAG, subject: SUBJECT, body: BODY, from: FROM, provider: PROVIDER, perHour: PER_HOUR, leadsOf: BOSS_ID, exclude: EXCLUDE, personalize: true },
  })
  if (r.status !== 200 || !r.json?.ok) {
    console.error(`stage FAILED ${r.status}: ${JSON.stringify(r.json).slice(0, 400)}`)
    process.exit(1)
  }
  console.log(`staged tag=${r.json.campaign} queued=${r.json.queued} born=${r.json.state?.status}`)
  console.log(`leadsOf readout: ${JSON.stringify(r.json.leadsOf)}`)
  console.log(`suppressed skipped=${r.json.skippedSuppressed} duplicates skipped=${r.json.skippedDuplicate} invalid=${(r.json.invalid || []).length}`)
  console.log(`provider=${r.json.state?.provider} perHour=${r.json.state?.perHour} from=${r.json.state?.from}`)
  console.log('NOTHING SENDS until Start. The queue is PAUSED on purpose.')
  process.exit(0)
}

if (cmd === 'status') {
  const r = await call('/api/admin/exec/campaigns', { cookie })
  const c = (r.json?.campaigns || []).find((x) => x.tag === TAG)
  if (!c) { console.log(`no queue under ${TAG} yet — run stage first`); process.exit(0) }
  console.log(`tag=${c.tag} state=${JSON.stringify(c.state)}`)
  console.log(`summary=${JSON.stringify(c.summary)}`)
  process.exit(0)
}

if (cmd === 'start' || cmd === 'pause') {
  if (cmd === 'start' && process.env.GREENLIGHT !== 'yes') {
    console.error('REFUSED: starting a live send needs GREENLIGHT=yes in the environment, on top of the boss\'s word.')
    console.error('Nothing was armed. When the greenlight is real: GREENLIGHT=yes node scripts/bh_outreach.mjs start')
    process.exit(2)
  }
  const r = await call('/api/admin/exec/campaigns', { method: 'PATCH', cookie, body: { campaign: TAG, action: cmd === 'start' ? 'start' : 'pause' } })
  console.log(`${cmd} status=${r.status} ${JSON.stringify(r.json).slice(0, 300)}`)
  process.exit(r.status === 200 ? 0 : 1)
}
