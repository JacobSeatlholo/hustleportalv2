import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'
import { sendCampaignMail } from '@/lib/mailer'
import { unsubscribeUrl } from '@/lib/campaignqueue'
import {
  getWinbackAudience, alreadySentThisCampaign, buildWinbackEmail,
  WINBACK_CAMPAIGN, WINBACK_QUIET_DAYS, WINBACK_MAX_PER_RUN,
} from '@/lib/winback'

const APP_BASE = 'https://www.hustleportal.online'

// The win-back door, exec only.
//
// GET  → the quiet list plus the exact email each member would receive, nothing
//        leaves the platform. The draft review step is the whole point: nobody
//        sends a word of this until the boss has read it and pressed the button.
// POST → { confirm: true } sends the win-back to the quiet list. Skips anyone
//        already emailed in this campaign, anyone on the Suppression list, and
//        logs every send (good or failed) into EmailLog under the campaign tag
//        so the archive shows exactly what went out.
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

  const [audience, sent] = await Promise.all([getWinbackAudience(), alreadySentThisCampaign()])
  // The draft preview is the same email the first member would get.
  const sample = buildWinbackEmail({ name: audience[0]?.name || 'there', businessName: audience[0]?.businessName ?? null })

  return NextResponse.json({
    campaign: WINBACK_CAMPAIGN,
    quietDays: WINBACK_QUIET_DAYS,
    count: audience.length,
    alreadySent: sent.size,
    audience: audience.map((m) => ({ ...m, sentThisCampaign: sent.has(m.email.toLowerCase().trim()) })),
    draft: sample,
  })
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
  let sentN = 0
  let failedN = 0
  let skippedN = audience.length - slice.length
  const failures: string[] = []

  for (const m of slice) {
    const email = m.email.toLowerCase().trim()
    if (sent.has(email)) { skippedN += 1; continue }
    const mail = buildWinbackEmail({ name: m.name, businessName: m.businessName })
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
