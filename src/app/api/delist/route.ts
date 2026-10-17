import { NextRequest, NextResponse } from 'next/server'
import { createSuppression } from '@/lib/suppression'
import { sendSystemMail, TEAM_INBOX } from '@/lib/mailer'

export const maxDuration = 30

// Light in-memory throttle: six requests per address per hour is far more
// than any honest owner needs and blunts automated abuse.
const hits = new Map<string, { n: number; at: number }>()
const WINDOW_MS = 60 * 60_000
const LIMIT = 6

function throttled(ip: string): boolean {
  const now = Date.now()
  const rec = hits.get(ip)
  if (!rec || now - rec.at > WINDOW_MS) {
    hits.set(ip, { n: 1, at: now })
    return false
  }
  rec.n += 1
  return rec.n > LIMIT
}

/**
 * POST /api/delist — the public "remove my business" endpoint (POPIA).
 *
 * No auth on purpose: the requester is a business owner, not an app user.
 * It records a listing suppression (enforced within a minute everywhere the
 * lead index flows) and alerts the team inbox so a human can confirm.
 * Idempotent: a repeat request is honoured, never an error.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (throttled(ip)) {
    return NextResponse.json(
      { error: 'Too many requests from this address. Try again later, or email the team directly.' },
      { status: 429 }
    )
  }
  let body: { business?: string; city?: string; contact?: string; reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const business = String(body.business || '').trim()
  if (business.length < 2) {
    return NextResponse.json({ error: 'Tell us the business name as it appears in the listing.' }, { status: 400 })
  }
  const contact = String(body.contact || '').trim()
  const contactOk =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || contact.replace(/\D/g, '').length >= 9
  if (!contactOk) {
    return NextResponse.json(
      { error: 'Add an email address or phone number so the team can confirm the removal with you.' },
      { status: 400 }
    )
  }
  const city = String(body.city || '').trim().slice(0, 80)
  const reason = String(body.reason || '').trim().slice(0, 500)

  await createSuppression({ name: business, city, contact, reason, source: 'WEB' })

  // Team alert — a human sees every removal request. Best effort: the
  // suppression itself is already live, the mail only informs.
  try {
    await sendSystemMail({
      to: TEAM_INBOX,
      subject: `Listing removal request: ${business}`,
      body:
        'A business asked to leave the HustlePortal lead index via /remove-listing.\n\n' +
        `Business: ${business}\n` +
        (city ? `City: ${city}\n` : '') +
        `Contact: ${contact}\n` +
        (reason ? `Reason: ${reason}\n` : '') +
        '\nThe suppression is already active. Reply to the contact to confirm, and delete the listing from the directories where it also appears.',
    })
  } catch {
    /* the request is recorded regardless */
  }

  return NextResponse.json({
    ok: true,
    message:
      'Request received. Your listing leaves the lead index within the hour, and the team will confirm at the contact you gave.',
  })
}
