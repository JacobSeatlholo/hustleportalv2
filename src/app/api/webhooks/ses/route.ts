import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Amazon SES feedback, the SES lane's ears. SNS posts bounce and complaint
 * events here and every permanent bounce or complaint lands the address on
 * the Suppression list, the same law the Resend lane obeys. A domain that
 * keeps its complaint rate far under 0.3% keeps its seat in the inbox.
 *
 * Setup (once AWS grants production access):
 *   SES → Configuration sets → create one (e.g. hustle-campaigns)
 *     → Event destination → Amazon SNS topic → HTTPS endpoint:
 *       https://www.hustleportal.online/api/webhooks/ses?key=<SES_WEBHOOK_SECRET>
 *   Send mail on that set by setting SES_CONFIG_SET in the environment, the
 *   mailer stamps X-SES-CONFIGURATION-SET on every SES-lane send.
 * SubscriptionConfirmation is answered automatically (the SubscribeURL must
 * point at amazonaws.com, nothing else is fetched).
 */
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const secret = process.env.SES_WEBHOOK_SECRET?.trim()
  if (secret) {
    const key = req.nextUrl.searchParams.get('key') || req.headers.get('x-webhook-secret') || ''
    if (key !== secret) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { Type?: string; Message?: string; SubscribeURL?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.Type === 'SubscriptionConfirmation' || body.Type === 'UnsubscribeConfirmation') {
    const url = body.SubscribeURL || ''
    if (/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(url)) {
      try { await fetch(url) } catch { /* SNS retries until it sees the visit */ }
    }
    return NextResponse.json({ ok: true })
  }
  if (body.Type !== 'Notification') {
    return NextResponse.json({ ok: true, ignored: body.Type || 'unknown' })
  }

  let msg: {
    eventType?: string
    notificationType?: string
    mail?: { messageId?: string; destination?: string[] }
    bounce?: { bounceType?: string; bouncedRecipients?: { emailAddress?: string }[] }
    complaint?: { complainedRecipients?: { emailAddress?: string }[] }
  } = {}
  try {
    msg = JSON.parse(body.Message || '{}')
  } catch {
    return NextResponse.json({ error: 'Invalid SNS Message' }, { status: 400 })
  }

  const type = msg.eventType || msg.notificationType
  if (type !== 'Bounce' && type !== 'Complaint') {
    return NextResponse.json({ ok: true, ignored: type || 'none' })
  }

  const isComplaint = type === 'Complaint'
  // Transient bounces (mailbox full, greylisting) usually deliver on the
  // retry, they never suppress and never mark a send as bounced.
  const permanent = isComplaint || msg.bounce?.bounceType !== 'Transient'
  const providerId = msg.mail?.messageId?.trim() || ''
  const weekAgo = new Date(Date.now() - 7 * 24 * 3_600_000)
  const errorLine = isComplaint ? 'Spam complaint' : `Bounced (${msg.bounce?.bounceType || 'Permanent'})`

  let handled = 0
  const recipients = isComplaint
    ? msg.complaint?.complainedRecipients || []
    : msg.bounce?.bouncedRecipients || []
  for (const r of recipients) {
    const email = r?.emailAddress?.trim().toLowerCase()
    if (!email) continue
    if (!permanent) continue

    // Match the exact send by provider id first, then the same fallback the
    // Resend webhook uses: this address, sent recently, newest wins. An event
    // that matches nothing touches nothing, junk events can never poison the
    // suppression list, and every genuine engine bounce lands within minutes
    // so the 7 day window is generous.
    let log = providerId
      ? await db.emailLog.findFirst({ where: { providerId }, orderBy: { createdAt: 'desc' } })
      : null
    if (!log) {
      log = await db.emailLog.findFirst({
        where: { toEmail: email, status: 'SENT', sentAt: { gte: weekAgo } },
        orderBy: { sentAt: 'desc' },
      })
    }
    if (!log) continue
    await db.emailLog.update({
      where: { id: log.id },
      data: { status: 'BOUNCED', error: errorLine.slice(0, 500) },
    })
    await db.suppression.upsert({
      where: { email },
      update: {},
      create: { email, reason: isComplaint ? 'COMPLAINT' : 'BOUNCE', note: log.campaign || 'SES lane' },
    })
    handled++
  }

  return NextResponse.json({ ok: true, handled })
}
