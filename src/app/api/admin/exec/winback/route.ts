import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'
import { sendCampaignMail } from '@/lib/mailer'
import { unsubscribeUrl } from '@/lib/campaignqueue'
import {
  getWinbackAudience, alreadySentThisCampaign, renderWinbackEmail,
  readWinbackOverride, saveWinbackOverride, clearWinbackOverride,
  readWinbackExclusions,
  WINBACK_CAMPAIGN, WINBACK_QUIET_DAYS, WINBACK_MAX_PER_RUN,
} from '@/lib/winback'

const APP_BASE = 'https://www.hustleportal.online'

// The win-back door, exec only.
//
// GET    → the quiet list plus the exact email each member would receive,
//          the editable template ({firstName} tokens) and whether an edited
//          draft is saved. Also the addresses the boss removed from this
//          campaign with one click (restorable). Nothing leaves the platform.
//          The draft review step is the whole point: nobody sends a word of
//          this until the boss has read it and pressed the button.
// PUT    → { subject, body } saves the boss's edited draft. Every send after
//          that uses his words until he resets.
// DELETE → back to the verbatim copy in code.
// POST   → { confirm: true } sends the win-back to the quiet list. Skips anyone
//          already emailed in this campaign, anyone on the Suppression list, and
//          logs every send (good or failed) into EmailLog under the campaign tag
//          so the archive shows exactly what went out.
//
// The send rides the campaign lane (sendCampaignMail), not the system lane:
// bulk mail carries the one click unsubscribe law, and the log-first row binds
// the open pixel so open counts are finally measured. The row starts as DRAFT
// (not counted by the one touch guard), flips to SENT or FAILED after the
// provider answers — a FAILED row is a retry target, a crash leaves a harmless
// DRAFT behind.

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const [audience, sent, override, excluded] = await Promise.all([
    getWinbackAudience(), alreadySentThisCampaign(), readWinbackOverride(), readWinbackExclusions(),
  ])
  // The draft preview is the same email the first member would get.
  const sample = renderWinbackEmail({ name: audience[0]?.name || 'there', businessName: audience[0]?.businessName ?? null }, override)
  // The editor's copy: what is in the box when the boss opens the editor —
  // his saved edit, or the original with {firstName} tokens in the greeting.
  const template = override
    ? { subject: override.subject, body: override.body }
    : renderWinbackEmail({ name: '{firstName}', businessName: null }, null)

  return NextResponse.json({
    campaign: WINBACK_CAMPAIGN,
    quietDays: WINBACK_QUIET_DAYS,
    count: audience.length,
    alreadySent: sent.size,
    audience: audience.map((m) => ({ ...m, sentThisCampaign: sent.has(m.email.toLowerCase().trim()) })),
    draft: sample,
    template,
    override: override ? { subject: override.subject, body: override.body, savedAt: override.savedAt } : null,
    excluded,
  })
}

/** Save the boss's edited draft. His words win; the tokens do the personalising. */
export async function PUT(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const subject = String(b?.subject || '').trim()
  const body = String(b?.body || '').trim()
  if (!subject) return NextResponse.json({ error: 'The subject line is required.' }, { status: 400 })
  if (subject.length > 200) return NextResponse.json({ error: 'Keep the subject under 200 characters.' }, { status: 400 })
  if (body.length < 40) return NextResponse.json({ error: 'That body is too short to be the win-back email.' }, { status: 400 })
  if (body.length > 12000) return NextResponse.json({ error: 'The body is over 12,000 characters — trim it down first.' }, { status: 400 })
  const saved = await saveWinbackOverride(subject, body)
  return NextResponse.json({ ok: true, override: saved })
}

/** Reset: the verbatim copy in code is the draft again. */
export async function DELETE() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  await clearWinbackOverride()
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({}))
  if (body?.confirm !== true) {
    return NextResponse.json({ error: 'Not confirmed. Sending a win-back takes an explicit confirm.' }, { status: 400 })
  }

  const [audience, sent] = await Promise.all([getWinbackAudience(), alreadySentThisCampaign()])
  if (audience.length === 0) {
    return NextResponse.json({ message: 'Nobody is quiet right now. Nothing sent.', sent: 0, failed: 0, skipped: 0 })
  }

  const slice = audience.slice(0, WINBACK_MAX_PER_RUN)
  // One read for the whole batch: the boss's edited draft (or null) decides
  // every email in this run, greeting personalised per member.
  const override = await readWinbackOverride()
  let sentN = 0
  let failedN = 0
  let skippedN = audience.length - slice.length
  const failures: string[] = []

  for (const m of slice) {
    const email = m.email.toLowerCase().trim()
    if (sent.has(email)) { skippedN += 1; continue }
    const mail = renderWinbackEmail({ name: m.name, businessName: m.businessName }, override)
    // Log first so the open pixel and the one tap unsubscribe link can carry
    // the row id. DRAFT is invisible to the one touch guard until the send
    // actually lands.
    const log = await db.emailLog.create({
      data: {
        userId: m.id,
        toEmail: m.email,
        subject: mail.subject.slice(0, 180),
        body: mail.body.slice(0, 4000),
        status: 'DRAFT',
        provider: 'PLATFORM',
        campaign: WINBACK_CAMPAIGN,
      },
      select: { id: true },
    })
    const sendOnce = () =>
      sendCampaignMail({
        to: m.email,
        subject: mail.subject,
        body: mail.body,
        // The branded look: Gold Rush chrome, the honey badger hero, the
        // boss's own closing line as the caps headline, his "come see" line
        // as the button. Copy stays verbatim; the chrome only frames it.
        theme: 'goldrush',
        headline: 'GOOD TO HAVE YOU BACK',
        ctaLabel: "Come see what we've been building",
        ctaUrl: APP_BASE,
        preheader: 'One login for your whole business. Quite a bit has changed.',
        pixelUrl: `${APP_BASE}/api/mail/open/${log.id}`,
        unsubscribeUrl: unsubscribeUrl(log.id),
      })
    // The provider counts requests per second; a back to back loop trips it
    // and drops live mail as FAILED. Breathe between sends, retry a 429 once.
    let r = await sendOnce()
    if (!r.ok && (r.error || '').includes('429')) {
      await new Promise((resolve) => setTimeout(resolve, 1_600))
      r = await sendOnce()
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
    await db.emailLog.update({
      where: { id: log.id },
      data: {
        status: r.ok ? 'SENT' : 'FAILED',
        error: r.ok ? null : (r.error || 'Send failed').slice(0, 500),
        sentAt: r.ok ? new Date() : null,
      },
    })
    if (r.ok) sentN += 1
    else { failedN += 1; failures.push(`${m.email}: ${r.error || 'unknown error'}`) }
  }

  return NextResponse.json({
    message: `Win-back done: ${sentN} sent, ${failedN} failed, ${skippedN} skipped.`,
    sent: sentN,
    failed: failedN,
    skipped: skippedN,
    campaign: WINBACK_CAMPAIGN,
    failures: failures.slice(0, 10),
  })
}
