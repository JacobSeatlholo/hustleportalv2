import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { sendSystemMail, TEAM_INBOX } from '@/lib/mailer'
import { getStrategist } from '@/lib/corporate'

// ============ CORPORATE INVITATION APPLICATION (Task 215) ============
// The locked corporate door's second path: apply for an invitation. The mini
// survey doubles as sales qualification — company, contact, size, what they
// sell, how many leads they need a month. Rows land in the SAME CorporateLead
// ledger the exec door already reads (source 'application'), so the boss
// reviews, mints an access code, and the applicant's next step is one code.
// No auto-grants: the code is a human decision.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function clean(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const business = clean(body.business, 120)
  const contactName = clean(body.contactName, 80)
  const email = clean(body.email, 160).toLowerCase()
  const phone = clean(body.phone, 30)
  const teamSize = clean(body.teamSize, 20)
  const industry = clean(body.industry, 80)
  const leadsNeeded = clean(body.leadsNeeded, 60)
  // Task 217 (owner): the desk already knows where the office operates.
  const location = clean(body.location, 80)
  const message = clean(body.message, 600)
  const refSlugRaw = clean(body.refSlug, 60)
  const refSlug = refSlugRaw && getStrategist(refSlugRaw) ? refSlugRaw : null

  const errors: string[] = []
  if (!business) errors.push('Tell us the business name.')
  if (!contactName) errors.push('Tell us your name.')
  if (!email || !EMAIL_RE.test(email)) errors.push('A working email address is required.')
  if (!industry) errors.push('Tell us what your business sells.')
  if (!leadsNeeded) errors.push('A rough monthly lead number helps us size your invitation.')
  if (!location) errors.push('Tell us where your business operates.')
  if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ipGate = rateLimit(`corporate-apply:ip:${ip}`, 6, 60 * 60 * 1000)
  if (!ipGate.ok) return NextResponse.json(tooMany(ipGate.retryAfterSec), { status: 429 })
  const emailGate = rateLimit(`corporate-apply:email:${email}`, 3, 24 * 60 * 60 * 1000)
  if (!emailGate.ok) return NextResponse.json(tooMany(emailGate.retryAfterSec), { status: 429 })

  // One application per email per day, same double-click proof as claims.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const existing = await db.corporateLead.findFirst({
    where: { email, source: 'application', createdAt: { gte: dayAgo } },
  })
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const row = await db.corporateLead.create({
    data: {
      business, contactName, email,
      phone: phone || null, teamSize: teamSize || null,
      industry, leadsNeeded, location: location || null, message: message || null,
      source: 'application', status: 'NEW',
      refSlug,
    },
  })

  const notify = await sendSystemMail({
    to: TEAM_INBOX,
    subject: `Corporate invitation application: ${business}${refSlug ? ` via ${refSlug}` : ''}`,
    body: [
      'A corporate invitation application came in from the locked corporate door.',
      '',
      `Business: ${business}`,
      `Contact: ${contactName}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : '',
      teamSize ? `Team size: ${teamSize}` : '',
      location ? `Location: ${location}` : '',
      `Industry: ${industry}`,
      `Leads needed per month: ${leadsNeeded}`,
      message ? `Message: ${message}` : '',
      refSlug ? `Attribution: the application named ${refSlug} as its door.` : '',
      '',
      `Application id: ${row.id}`,
      'Next step: review, mint an access code (exec corporate door, action mint-code), and send it with your personal touch.',
    ].filter((l) => l !== '').join('\n'),
    headline: 'Corporate invitation application',
    title: `${business} applied for an invitation`,
    value: { text: 'Review and mint their access code', caption: 'Applications wait for a human yes' },
    ctaLabel: 'Open HustlePortal',
    ctaUrl: 'https://www.hustleportal.online/',
    preheader: 'New corporate invitation application to review.',
  })
  if (!notify.ok) console.error('[corporate] application stored but team notify failed:', notify.error)

  return NextResponse.json({ ok: true, id: row.id })
}
