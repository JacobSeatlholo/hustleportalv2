import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { sendMail } from '@/lib/mailer'
import { planState, FREE_LIMITS } from '@/lib/limits'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { ensureWallet, spendCredits, addCredits, formatRands } from '@/lib/wallet'
import { SPEND_ACTIONS, PLAN_SEND_BUNDLES, DEFAULT_SEND_BUNDLE, SEND_BUNDLE_WINDOW_DAYS } from '@/lib/spend'

// GET /api/emails → the user's email log (drafts first, newest first)
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const emails = await db.emailLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ emails })
}

// POST /api/emails → send a draft (or ad-hoc mail), plug & play:
// user's own Gmail if connected, otherwise the HustlePortal mail engine sends for them.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Send-rate ceiling per account: a human never hits 60 sends in an hour,
  // but this door sends real email through the platform mail engine, the
  // ceiling keeps a compromised or scripted account from turning HustlePortal
  // into a spam relay. 60/hour, generous and honest.
  const sendGate = rateLimit(`emails:send:${userId}`, 60, 60 * 60 * 1000)
  if (!sendGate.ok) {
    return NextResponse.json(tooMany(sendGate.retryAfterSec), { status: 429 })
  }
  const body = await req.json().catch(() => ({}))
  const to = String(body.to || '').trim()
  const subject = String(body.subject || '').trim()
  const mailBody = String(body.body || '').trim()
  if (!to || !to.includes('@')) return NextResponse.json({ error: 'A valid recipient email is required.' }, { status: 400 })
  if (!subject || !mailBody) return NextResponse.json({ error: 'Subject and body are required.' }, { status: 400 })

  // AIRTIME LAW for email (the boss's prepaid model — prices live in ONE
  // place, src/lib/spend.ts):
  //  - FREE plan: 6 lifetime sample sends (unchanged). After that, airtime
  //    takes over instead of the old hard stop — loading credits keeps you
  //    sending. Strictly MORE room, never less.
  //  - PAID plans: a bundle of sends rides free per rolling 30 days
  //    (Operator 150, Boss 400); beyond the bundle, airtime applies.
  //  - The debit only ever lands AFTER the send actually went out; a failed
  //    send never costs a cent — the same honesty law as the reveal till.
  //  - Daily AI limits and scan caps: untouched.
  const { paid, plan } = await planState(userId)
  const priceCents = SPEND_ACTIONS.EMAIL_SEND.cents
  const bundle = paid ? (PLAN_SEND_BUNDLES[plan] ?? DEFAULT_SEND_BUNDLE) : FREE_LIMITS.emailSends
  const windowStart = paid ? new Date(Date.now() - SEND_BUNDLE_WINDOW_DAYS * 24 * 60 * 60 * 1000) : null
  const used = await db.emailLog.count({
    where: { userId, status: 'SENT', ...(windowStart ? { createdAt: { gte: windowStart } } : {}) },
  })
  const withinAllowance = used < bundle
  const wallet = await ensureWallet(userId)
  if (!withinAllowance && wallet.balance < priceCents) {
    // Both doors named honestly: load airtime or upgrade. The 402 shape keeps
    // the ONE upgrade-dialog contract with the client api() helper.
    return NextResponse.json(
      {
        error: paid
          ? `Your ${bundle} monthly sends are used up and your credits are empty. Load airtime in the Wallet (from R50) and keep going, or upgrade for a bigger bundle — either way, the next email keeps moving your pipeline.`
          : `Your 6 free sends are done and your credits are empty. Load airtime in the Wallet (from R50) to keep sending — every email is ${formatRands(priceCents)} and a failed send never costs a cent.`,
        upgrade: true,
        feature: 'email',
        limit: bundle,
      },
      { status: 402 },
    )
  }
  const freeRemaining = !paid && withinAllowance ? bundle - used - 1 : undefined
  const bundleRemaining = paid && withinAllowance ? bundle - used - 1 : undefined

  // Attachments (the Video Studio pitch video rides here): base64 strings,
  // sanitized and size capped inside sendMail, invalid entries drop quietly.
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.map((a: { filename?: unknown; content?: unknown }) => ({
        filename: String(a?.filename || 'attachment'),
        content: String(a?.content || ''),
      }))
    : undefined

  const result = await sendMail(userId, { to, subject, body: mailBody, attachments })
  const provider = result.ok ? result.provider : 'NONE'

  // If this send belongs to a logged draft, update it; otherwise log the send
  let email
  if (body.draftId) {
    const draft = await db.emailLog.findFirst({ where: { id: body.draftId, userId } })
    if (draft) {
      email = await db.emailLog.update({
        where: { id: draft.id },
        data: { toEmail: to, subject, body: mailBody, status: result.ok ? 'SENT' : 'FAILED', provider, error: result.ok ? null : result.error },
      })
    }
  }
  if (!email) {
    email = await db.emailLog.create({
      data: {
        userId,
        projectId: body.projectId || null,
        toEmail: to,
        subject,
        body: mailBody,
        status: result.ok ? 'SENT' : 'FAILED',
        provider,
        error: result.ok ? null : result.error,
      },
    })
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error, email }, { status: 400 })
  }

  // The debit lands ONLY after the send actually went out (honesty law —
  // the airtime twin of "failed lookups charge nothing").
  let spend: { chargedCents: number; balanceAfter: number } | null = null
  if (!withinAllowance) {
    const spent = await spendCredits(userId, priceCents, `Airtime: email to ${to}`, 'FEATURE_SPEND')
    if (spent && spent.wallet) {
      spend = { chargedCents: priceCents, balanceAfter: spent.wallet.balance }
    } else {
      // Rare race: the balance drained between the gate and the debit while
      // the email is already on its way. The books stay truthful: an
      // ADJUSTMENT carries the shortfall and the wallet waits for a top-up.
      await addCredits(userId, -priceCents, 'ADJUSTMENT', `Airtime shortfall: email to ${to} already sent — load to clear it`)
      const after = await ensureWallet(userId)
      spend = { chargedCents: priceCents, balanceAfter: after.balance }
    }
  }
  return NextResponse.json({ email, notice: result.notice || null, freeRemaining: freeRemaining ?? null, bundleRemaining: bundleRemaining ?? null, spend })
}

// DELETE /api/emails?id= → remove a draft/log row
export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
  const existing = await db.emailLog.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.emailLog.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
