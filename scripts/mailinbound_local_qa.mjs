// Inbound mail capture + task-from-meeting local QA — full positive and
// negative paths against a local dev server on the local postgres.
// Run: DATABASE_URL="postgresql://postgres@127.0.0.1:54329/hustleportal" node scripts/mailinbound_local_qa.mjs
// Requires the dev server started with:
//   DATABASE_URL=... SES_INBOUND_SECRET="local-test-secret" SES_INBOUND_SKIP_SIG=1 bun run dev
import { PrismaClient } from '@prisma/client'

const BASE = 'http://localhost:3000'
const KEY = 'local-test-secret'
const db = new PrismaClient()

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}${extra ? ` :: ${extra}` : ''}`) }
  else { failed++; console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`) }
}

async function call(path, { method = 'GET', body, cookie, key } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 30000)
  try {
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${BASE}${path}${key ? `${sep}key=${encodeURIComponent(key)}` : ''}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    let json = null
    try { json = await res.json() } catch { /* empty */ }
    const setCookie = res.headers.get('set-cookie')
    return { status: res.status, json, setCookie }
  } finally { clearTimeout(t) }
}

function cookieOf(res) {
  const raw = res.setCookie || ''
  return raw.split(';')[0] || null
}

function rfcDate(d) {
  return d.toUTCString().replace('GMT', '+0000')
}

/** A minimal RFC822 email, the shape SES actually hands over as `content`. */
function mime({ from, to, cc, subject, body, date }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${subject}`,
    `Date: ${rfcDate(date)}`,
    `Message-ID: <${Math.random().toString(36).slice(2)}@qa.local>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ]
  return lines.join('\r\n')
}

/** The SES receipt → SNS Notification envelope, as the boss's rule will post it. */
function envelope({ msgId, content, from, to, cc, subject, date, spamVerdict = 'PASS' }) {
  const message = {
    notificationType: 'Received',
    mail: {
      messageId: msgId,
      timestamp: date.toISOString(),
      destination: to.split(',').map((s) => s.trim()).concat(['log@hustleportal.online']),
      commonHeaders: {
        from: [from],
        to: to.split(',').map((s) => `Recipient <${s.trim()}>`),
        ...(cc ? { cc: cc.split(',').map((s) => `CC <${s.trim()}>`) } : {}),
        subject,
        date: rfcDate(date),
      },
    },
    receipt: { spamVerdict: { status: spamVerdict } },
    ...(content ? { content } : {}),
  }
  return {
    Type: 'Notification',
    MessageId: `sns-${msgId}`,
    TopicArn: 'arn:aws:sns:af-south-1:111122223333:hustleportal-inbound',
    Timestamp: date.toISOString(),
    SignatureVersion: '1',
    Signature: 'LOCALTEST',
    SigningCertURL: 'https://sns.af-south-1.amazonaws.com/SimpleNotificationService-00000000000000000000000000000000.pem',
    Subject: 'Email Received',
    Message: JSON.stringify(message),
  }
}

async function register(email, name, business) {
  const res = await call('/api/auth', { method: 'POST', body: { action: 'register', email, password: 'hustle123', name, businessName: business, city: 'Cape Town', industry: 'Retail' } })
  if (res.status !== 200) throw new Error(`register failed for ${email}: ${res.status} ${JSON.stringify(res.json)}`)
  return cookieOf(res)
}

async function main() {
  console.log('== Inbound capture local QA ==')

  // 0. Clean slate
  const oldUsers = await db.user.findMany({ where: { email: { contains: '@hustleqa.local' } }, select: { id: true } })
  await db.user.deleteMany({ where: { email: { contains: '@hustleqa.local' } } })
  if (oldUsers.length) await db.user.deleteMany({ where: { email: 'ceo@businesshustle.co.za' } })
  await db.emailAlias.deleteMany({ where: { address: { contains: 'businesshustle' } } })
  await db.inboundMail.deleteMany({})
  await db.user.deleteMany({ where: { email: 'ceo@businesshustle.co.za' } })

  // 1. Register the exec (login email IS the sending address) + a second user
  const ceoCookie = await register('ceo@businesshustle.co.za', 'Business Owner', 'Business Hustle')
  check('CEO registers with exec email', typeof ceoCookie === 'string' && ceoCookie.length > 10)
  const me = await call('/api/auth/me', { cookie: ceoCookie })
  check('CEO self-heals to ADMIN', me.json?.user?.role === 'ADMIN', `role=${me.json?.user?.role}`)
  const ceoId = me.json.user.id

  const aliceEmail = `alice_${Date.now()}@hustleqa.local`
  const aliceCookie = await register(aliceEmail, 'Alice Old', 'Alice Trading')
  check('Alice registers', typeof aliceCookie === 'string')

  // 2. Aliases: Alice connects her old mailbox
  const aliasRes = await call('/api/emails/aliases', { method: 'POST', body: { address: 'aliceold@businesshustle.co.za', label: 'old box' }, cookie: aliceCookie })
  check('alias add 200', aliasRes.status === 200, JSON.stringify(aliasRes.json || {}).slice(0, 120))
  const aliasDup = await call('/api/emails/aliases', { method: 'POST', body: { address: 'aliceold@businesshustle.co.za' }, cookie: aliceCookie })
  check('alias re-add is idempotent', aliasDup.status === 200 && aliasDup.json?.already === true)
  const aliasSteal = await call('/api/emails/aliases', { method: 'POST', body: { address: 'aliceold@businesshustle.co.za' }, cookie: ceoCookie })
  check('alias owned by another account is 409', aliasSteal.status === 409)
  const aliasList = await call('/api/emails/aliases', { cookie: aliceCookie })
  check('alias list shows 1', aliasList.json?.aliases?.length === 1)

  // 3. Webhook auth walls
  const noKey = await call('/api/webhooks/ses-inbound', { method: 'POST', body: envelope({ msgId: 'x', content: '', from: 'a@b.c', to: 'd@e.f', subject: 'x', date: new Date() }) })
  check('webhook without key is 403', noKey.status === 403, `status ${noKey.status}`)
  const badKey = await call('/api/webhooks/ses-inbound', { method: 'POST', key: 'wrong-secret', body: {} })
  check('webhook with wrong key is 403', badKey.status === 403, `status ${badKey.status}`)
  const probe = await call('/api/webhooks/ses-inbound', { key: KEY })
  check('GET readiness probe ok', probe.status === 200 && probe.json?.ok === true, JSON.stringify(probe.json || {}))

  // 4. Subscription confirmation handshake
  const confirm = await call('/api/webhooks/ses-inbound', {
    method: 'POST', key: KEY,
    body: { Type: 'SubscriptionConfirmation', MessageId: 'sub-1', SubscribeURL: 'https://sns.af-south-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:af-south-1:111122223333:hustleportal-inbound&Token=deadbeef', Timestamp: new Date().toISOString(), TopicArn: 'arn:aws:sns:af-south-1:111122223333:hustleportal-inbound' },
  })
  check('subscription confirmation ok', confirm.status === 200 && confirm.json?.confirmed === true, JSON.stringify(confirm.json || {}))

  // 5. Inbound via ALIAS resolution (Alice's old address) — capture address scrubbed from To/Cc
  const date1 = new Date(Date.now() - 60 * 60 * 1000)
  const content1 = mime({ from: 'Alice Old <aliceold@businesshustle.co.za>', to: 'prospect@example.com, log@hustleportal.online', cc: 'auditor@example.com, log@hustleportal.online', subject: 'Quarterly order update', body: 'Hi, sending the quarterly order update from the old system — the portal must catch this.', date: date1 })
  const in1 = await call('/api/webhooks/ses-inbound', { method: 'POST', key: KEY, body: envelope({ msgId: 'qa-001', content: content1, from: 'Alice Old <aliceold@businesshustle.co.za>', to: 'prospect@example.com', cc: 'auditor@example.com', subject: 'Quarterly order update', date: date1 }) })
  check('alias-sender inbound logged', in1.status === 200 && in1.json?.outcome === 'LOGGED', JSON.stringify(in1.json || {}))
  const aliceLog = await db.emailLog.findFirst({ where: { userId: (await db.user.findUnique({ where: { email: aliceEmail } })).id, providerId: null, provider: 'SES_INBOUND' }, orderBy: { createdAt: 'desc' } })
  check('EmailLog row for Alice (IN/LOGGED/SES_INBOUND)', !!aliceLog && aliceLog.direction === 'IN' && aliceLog.status === 'LOGGED', aliceLog ? `${aliceLog.subject} | from ${aliceLog.fromEmail}` : 'missing')
  check('capture address scrubbed from toEmail', aliceLog && !aliceLog.toEmail.includes('log@hustleportal.online'), aliceLog?.toEmail)
  check('capture address scrubbed from ccEmail', aliceLog && aliceLog.ccEmail === 'auditor@example.com', aliceLog?.ccEmail)
  check('body text parsed from MIME', aliceLog && aliceLog.body.includes('quarterly order update'))
  const ib1 = await db.inboundMail.findUnique({ where: { sesMessageId: 'qa-001' } })
  check('InboundMail audit row LOGGED + linked', !!ib1 && ib1.status === 'LOGGED' && ib1.emailLogId === aliceLog?.id && ib1.userId === aliceLog?.userId)

  // 6. Inbound via LOGIN-EMAIL resolution (the boss's Bongo-style pitch)
  const date2 = new Date(Date.now() - 30 * 60 * 1000)
  const pitchBody = 'Good day\n\nI noticed Bongo Credit is actively scaling its Cape Town footprint across IT operations, marketing, training, and call center leadership.\n\nBooking Link = https://www.hustleportal.online/book/64qqe09d'
  const content2 = mime({ from: 'ceo@businesshustle.co.za', to: 'procurement@bongofinance.co.za', subject: 'Strategic partnership — Bongo Credit x Business Hustle', body: pitchBody, date: date2 })
  const in2 = await call('/api/webhooks/ses-inbound', { method: 'POST', key: KEY, body: envelope({ msgId: 'qa-002', content: content2, from: 'ceo@businesshustle.co.za', to: 'procurement@bongofinance.co.za', subject: 'Strategic partnership — Bongo Credit x Business Hustle', date: date2 }) })
  check('login-email sender inbound logged', in2.status === 200 && in2.json?.outcome === 'LOGGED', JSON.stringify(in2.json || {}))
  const ceoLog = await db.emailLog.findFirst({ where: { userId: ceoId, provider: 'SES_INBOUND', direction: 'IN' }, orderBy: { createdAt: 'desc' } })
  check('EmailLog row for CEO from ceo@businesshustle.co.za', !!ceoLog && ceoLog.fromEmail === 'ceo@businesshustle.co.za' && ceoLog.subject.includes('Bongo'), ceoLog?.subject)

  // 7. Duplicate delivery is absorbed
  const dup = await call('/api/webhooks/ses-inbound', { method: 'POST', key: KEY, body: envelope({ msgId: 'qa-002', content: content2, from: 'ceo@businesshustle.co.za', to: 'procurement@bongofinance.co.za', subject: 'Strategic partnership — Bongo Credit x Business Hustle', date: date2 }) })
  check('duplicate redelivery -> DUPLICATE', dup.status === 200 && dup.json?.outcome === 'DUPLICATE', JSON.stringify(dup.json || {}))
  const dupCount = await db.emailLog.count({ where: { userId: ceoId, provider: 'SES_INBOUND' } })
  check('no duplicate EmailLog row', dupCount === 1, `count ${dupCount}`)

  // 8. Unknown sender → UNMATCHED queue → claim
  const date3 = new Date(Date.now() - 10 * 60 * 1000)
  const content3 = mime({ from: 'Sipho Radebe <sipho@unknowncorp.co.za>', to: 'partner@hustleportal.online, log@hustleportal.online', subject: 'We should talk', body: 'We heard about the portal and want in.', date: date3 })
  const in3 = await call('/api/webhooks/ses-inbound', { method: 'POST', key: KEY, body: envelope({ msgId: 'qa-003', content: content3, from: 'Sipho Radebe <sipho@unknowncorp.co.za>', to: 'partner@hustleportal.online', subject: 'We should talk', date: date3 }) })
  check('unknown sender -> UNMATCHED', in3.status === 200 && in3.json?.outcome === 'UNMATCHED', JSON.stringify(in3.json || {}))
  const queue = await call('/api/inbound', { cookie: ceoCookie })
  check('exec queue lists the unmatched row', queue.status === 200 && queue.json?.rows?.some((r) => r.id && r.fromEmail === 'sipho@unknowncorp.co.za'), `rows ${queue.json?.rows?.length}`)
  const unRow = queue.json.rows.find((r) => r.fromEmail === 'sipho@unknowncorp.co.za')
  const forbidden = await call('/api/inbound', { cookie: aliceCookie })
  check('non-exec queue access is 403', forbidden.status === 403, `status ${forbidden.status}`)
  const claim = await call('/api/inbound', { method: 'POST', body: { id: unRow.id, action: 'CLAIM' }, cookie: ceoCookie })
  check('claim -> LOGGED into exec log', claim.status === 200 && claim.json?.action === 'LOGGED', JSON.stringify(claim.json || {}))
  const claimed = await db.inboundMail.findUnique({ where: { id: unRow.id } })
  check('claimed row carries userId + emailLogId', claimed?.status === 'LOGGED' && claimed?.userId === ceoId && !!claimed?.emailLogId)
  const ignoreRes = await call('/api/webhooks/ses-inbound', { method: 'POST', key: KEY, body: envelope({ msgId: 'qa-004', content: mime({ from: 'spam@junk.co.za', to: 'log@hustleportal.online', subject: 'WIN A MILLION', body: 'click here', date: new Date() }), from: 'spam@junk.co.za', to: 'log@hustleportal.online', subject: 'WIN A MILLION', date: new Date() }) })
  const junkRow = await db.inboundMail.findUnique({ where: { sesMessageId: 'qa-004' } })
  const ignore = await call('/api/inbound', { method: 'POST', body: { id: junkRow.id, action: 'IGNORE' }, cookie: ceoCookie })
  check('ignore -> IGNORED', ignore.status === 200, JSON.stringify(ignore.json || {}))

  // 9. Manual external log (the Today-door): the boss logs the Bongo pitch by hand
  const manNeg = await call('/api/emails/log-external', { method: 'POST', body: { to: 'procurement@bongofinance.co.za', subject: 'x', body: 'y', fromEmail: 'notmine@somewhere.co.za' }, cookie: ceoCookie })
  check('manual log with un-owned fromEmail is 400', manNeg.status === 400, `status ${manNeg.status}`)
  const man = await call('/api/emails/log-external', { method: 'POST', cookie: ceoCookie, body: { to: 'procurement@bongofinance.co.za', cc: 'ops@businesshustle.co.za', subject: 'Strategic partnership — Bongo Credit x Business Hustle', body: pitchBody, fromEmail: 'ceo@businesshustle.co.za', sentAt: new Date(Date.now() - 3600_000).toISOString() } })
  check('manual log 200 + LOGGED/EXTERNAL', man.status === 200 && man.json?.email?.status === 'LOGGED' && man.json?.email?.provider === 'EXTERNAL', JSON.stringify(man.json || {}).slice(0, 160))
  check('manual log direction OUT with honest fromEmail', man.json?.email?.direction === 'OUT' && man.json?.email?.fromEmail === 'ceo@businesshustle.co.za')
  const logList = await call('/api/emails', { cookie: ceoCookie })
  const logRow = (logList.json?.emails || []).find((e) => e.subject?.includes('Bongo') && e.status === 'LOGGED')
  check('manual row visible in GET /api/emails', !!logRow)
  const manFuture = await call('/api/emails/log-external', { method: 'POST', body: { to: 'a@b.co.za', body: 'x', sentAt: new Date(Date.now() + 7 * 86400_000).toISOString() }, cookie: ceoCookie })
  check('future sentAt is 400', manFuture.status === 400)

  // 10. Task-from-meeting: appointment + task with the appointmentId link
  const apptRes = await call('/api/appointments', { method: 'POST', cookie: ceoCookie, body: { title: 'Coffee — Bongo Credit', clientName: 'Bongo Finance', clientEmail: 'procurement@bongofinance.co.za', startsAt: new Date(Date.now() + 2 * 86400_000).toISOString(), notes: '15-minute coffee, Kloof Street' } })
  check('appointment created (201 Created)', apptRes.status === 201 && !!apptRes.json?.appointment?.id, JSON.stringify(apptRes.json || {}).slice(0, 120))
  const apptId = apptRes.json?.appointment?.id
  const taskRes = await call('/api/tasks', { method: 'POST', cookie: ceoCookie, body: { title: 'Follow up: Coffee — Bongo Credit', notes: 'Send the deck.', dueDate: new Date(Date.now() + 3 * 86400_000).toISOString(), appointmentId: apptId } })
  check('task created with appointmentId link', taskRes.status === 200 && taskRes.json?.task?.appointmentId === apptId, JSON.stringify(taskRes.json || {}).slice(0, 160))
  const badTask = await call('/api/tasks', { method: 'POST', cookie: aliceCookie, body: { title: 'steal', appointmentId: apptId } })
  check("someone else's appointment cannot be linked (404)", badTask.status === 404, `status ${badTask.status}`)

  // 11. Spam flag rides the row
  const spamRow = await db.inboundMail.findUnique({ where: { sesMessageId: 'qa-004' } })
  const spamIn = await call('/api/webhooks/ses-inbound', { method: 'POST', key: KEY, body: envelope({ msgId: 'qa-005', content: mime({ from: 'nope@junkmail.co.za', to: 'log@hustleportal.online', subject: 'PHARMACY', body: 'cheap', date: new Date() }), from: 'nope@junkmail.co.za', to: 'log@hustleportal.online', subject: 'PHARMACY', date: new Date(), spamVerdict: 'FAIL' }) })
  const spamCheck = await db.inboundMail.findUnique({ where: { sesMessageId: 'qa-005' } })
  check('spam verdict flagged on row', spamIn.status === 200 && spamCheck?.spam === true, `spam=${spamCheck?.spam}`)

  // 12. Alias cleanup round trip
  const delAlias = await call(`/api/emails/aliases?address=aliceold@businesshustle.co.za`, { method: 'DELETE', cookie: aliceCookie })
  check('alias delete 200', delAlias.status === 200)

  // 13. Cleanup (leave no QA rows behind)
  await db.inboundMail.deleteMany({})
  await db.user.deleteMany({ where: { email: { contains: '@hustleqa.local' } } })
  await db.user.deleteMany({ where: { email: 'ceo@businesshustle.co.za' } })
  await db.emailAlias.deleteMany({})

  console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
  await db.$disconnect()
  process.exit(failed ? 1 : 0)
}

main().catch(async (e) => {
  console.error('FATAL', e)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
