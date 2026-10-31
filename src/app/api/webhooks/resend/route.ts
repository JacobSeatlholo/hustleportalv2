import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordBounce } from '@/lib/leadfeedback'

export const maxDuration = 30

/**
 * Resend webhooks, the honesty feed of the sending lane.
 * email.bounced / email.complained -> the address never hears from us again
 * (Suppression) and the log row shows the truth (BOUNCED).
 *
 * Match is by provider message id, captured at send time. If RESEND_WEBHOOK_
 * SECRET is set, the caller must carry ?key= or x-webhook-secret.
 * Register at resend.com -> Webhooks -> events: email.bounced, email.complained.
 *
 * Hardening (QA 2026-10-31): without a secret this endpoint used to be fully
 * open, and the address-only fallback let anyone suppress ANY address we
 * emailed in the last 7 days with one forged POST (suppression poisoning).
 * Now: no secret configured => provider-id matches ONLY. A forged event that
 * names just an address touches nothing. Real provider events always carry
 * the id, so genuine bounce processing is unaffected. Set the secret (and
 * register the webhook with ?key=) to re-enable the address fallback.
 */

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (secret) {
    const key = req.nextUrl.searchParams.get('key') || req.headers.get('x-webhook-secret') || ''
    if (key !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Unauthenticated callers (no secret configured) must prove the event is
  // about a send WE made: provider id or nothing. Address-spray dies here.
  const providerIdOnly = !secret

  let payload: { type?: string; data?: { id?: string; email_id?: string; to?: string[] | string } }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const type = payload.type || ''
  if (type !== 'email.bounced' && type !== 'email.complained') {
    return NextResponse.json({ ok: true, handled: 0, note: 'event ignored' })
  }

  const providerId = payload.data?.id || payload.data?.email_id || ''
  const toRaw = payload.data?.to
  const to = Array.isArray(toRaw) ? toRaw[0] : toRaw

  const log = providerId
    ? await db.emailLog.findFirst({ where: { providerId }, select: { id: true, toEmail: true, campaign: true, leadId: true } })
    : to && !providerIdOnly
      ? await db.emailLog.findFirst({
          where: { toEmail: String(to).toLowerCase(), status: 'SENT', sentAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
          orderBy: { sentAt: 'desc' },
          select: { id: true, toEmail: true, campaign: true, leadId: true },
        })
      : null

  if (!log) return NextResponse.json({ ok: true, handled: 0, note: 'no matching send' })

  await db.emailLog.update({
    where: { id: log.id },
    data: { status: 'BOUNCED', error: (type === 'email.complained' ? 'Marked as spam by recipient' : 'Bounced') },
  })
  await db.suppression.upsert({
    where: { email: log.toEmail },
    update: { reason: type === 'email.complained' ? 'COMPLAINT' : 'BOUNCE', note: log.campaign || undefined },
    create: { email: log.toEmail, reason: type === 'email.complained' ? 'COMPLAINT' : 'BOUNCE', note: log.campaign || undefined },
  })

  // The lead quality loop hears it too: the bounced address is marked on the
  // pipeline row (and every copy of it) and on the shared pool face, so a
  // provably dead address never serves again and never costs a reveal.
  // A spam complaint is not a reachability fact, only real bounces mark it.
  const reach = type === 'email.bounced' ? await recordBounce(log.toEmail, { leadId: log.leadId }) : { leadMarked: false, poolMatched: false }

  return NextResponse.json({ ok: true, handled: 1, email: log.toEmail, leadMarked: reach.leadMarked, poolMatched: reach.poolMatched })
}
