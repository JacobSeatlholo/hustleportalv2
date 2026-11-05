import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { sendMail, sanitizeCcInput, sanitizeFromLocal } from '@/lib/mailer'
import { planState, FREE_LIMITS } from '@/lib/limits'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { ensureWallet, spendCredits, addCredits, formatRands } from '@/lib/wallet'
import { SPEND_ACTIONS, PLAN_SEND_BUNDLES, DEFAULT_SEND_BUNDLE, SEND_BUNDLE_WINDOW_DAYS } from '@/lib/spend'
import { matchLead, type LeadMatch } from '@/lib/leadMatch'
import { resolveProject } from '@/lib/workspace'

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
  // The composer's sender pick + copies: cc is sanitized to real addresses
  // (max 5), fromLocal is collapsed to a clean local part on OUR sending
  // domain — the user only ever edits the part before the @, the domain the
  // engine signs never moves.
  const cc = sanitizeCcInput(typeof body.cc === 'string' ? body.cc : '')
  const fromLocal = sanitizeFromLocal(typeof body.fromLocal === 'string' ? body.fromLocal : '') || undefined

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

  const result = await sendMail(userId, { to, subject, body: mailBody, attachments, ...(cc.length ? { cc } : {}), ...(fromLocal ? { fromLocal } : {}) })
  const provider = result.ok ? result.provider : 'NONE'

  // If this send belongs to a logged draft, update it; otherwise log the send
  let email
  const logData = {
    toEmail: to,
    ccEmail: cc.length ? cc.join(', ') : null,
    subject,
    body: mailBody,
    status: result.ok ? 'SENT' : 'FAILED',
    provider,
    error: result.ok ? null : result.error,
  }
  if (body.draftId) {
    const draft = await db.emailLog.findFirst({ where: { id: body.draftId, userId } })
    if (draft) {
      email = await db.emailLog.update({ where: { id: draft.id }, data: logData })
    }
  }
  if (!email) {
    email = await db.emailLog.create({
      data: {
        userId,
        projectId: body.projectId || null,
        ...logData,
      },
    })
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error, email }, { status: 400 })
  }

  // The statement→lead bridge (opt-in). Two doors, both explicit:
  //  - matchLead: ONLY the matching runs here, the match is handed back and
  //    the CLIENT decides with the boss whether to apply it (the "Update
  //    lead?" prompt). Nothing is written.
  //  - updateCrm: the ticked "listed client" box (invoices). The tick IS the
  //    consent, so this door writes in one atomic motion after the send:
  //    ONE match → pin the email to that lead's timeline; NO match → the
  //    client is added as a new lead with the send recorded; TWO+ matches →
  //    NOTHING is touched, no guessing in the boss's pipeline. Ever.
  // A matching or CRM stumble never fails the send that already went out.
  const wantsMatch = body.matchLead === true || body.updateCrm === true
  let leadMatch: LeadMatch | null = wantsMatch
    ? await matchLead(userId, to, typeof body.leadName === 'string' ? body.leadName : null)
    : null

  let crm: { linked?: boolean; created?: boolean; ambiguous?: boolean; lead?: { id: string; company: string; stage: string }; error?: string } | null = null
  if (body.updateCrm === true && leadMatch) {
    try {
      if (leadMatch.kind === 'ONE') {
        await db.emailLog.update({ where: { id: email.id }, data: { leadId: leadMatch.lead.id } })
        crm = { linked: true, lead: { id: leadMatch.lead.id, company: leadMatch.lead.company, stage: leadMatch.lead.stage } }
      } else if (leadMatch.kind === 'NONE') {
        const project = await resolveProject(userId, typeof body.projectId === 'string' ? body.projectId : null)
        const label = (typeof body.leadName === 'string' && body.leadName.trim()) || to.split('@')[0]
        const lead = await db.lead.create({
          data: {
            userId,
            projectId: project.id,
            company: label,
            email: to,
            stage: 'CONTACTED',
            source: 'MANUAL',
            value: Number(body.dealValue) > 0 ? Number(body.dealValue) : 0,
            notes: `Added from ${typeof body.docLabel === 'string' ? body.docLabel : 'an emailed document'} — "${subject}" sent to ${to}.`,
          },
        })
        await db.emailLog.update({ where: { id: email.id }, data: { leadId: lead.id } })
        crm = { created: true, lead: { id: lead.id, company: lead.company, stage: lead.stage } }
      } else {
        crm = { ambiguous: true }
      }
    } catch (e) {
      // The email went out; the CRM write failing is a note, never an error page.
      crm = { error: e instanceof Error ? e.message : 'CRM update failed' }
    }
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
  return NextResponse.json({ email, notice: result.notice || null, sentFrom: result.ok ? (result.from || null) : null, freeRemaining: freeRemaining ?? null, bundleRemaining: bundleRemaining ?? null, spend, leadMatch, crm })
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
