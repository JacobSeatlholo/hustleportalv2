import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { sendSystemMail, TEAM_INBOX } from '@/lib/mailer'
import { getStrategist, getStrategistMember } from '@/lib/corporate'

// ============ CORPORATE CLAIM (Task 207) ============
//
// The corporate landing page (corporate.hustleportal.online → /corporate)
// posts here. The claim is stored first (the durable fact), then the team
// inbox is notified (the bell). A failed notification NEVER fails the claim:
// the row is the source of truth, the mail is only the bell. Duplicate claims
// by the same email inside 24h answer ok without a second row or a second
// email, so a double click never double-fires onboarding.
//
// Onboarding is a human act: the corporate team reads the claim in the inbox
// (and the row here), sets the account up by hand, applies the R550 starting
// credit via the exec wallet tools, and puts the managed rate R108 on the
// account. No self-serve magic, no auto-grants — money moves by human hands.

export const maxDuration = 15

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
  const message = clean(body.message, 600)

  // Referral attribution (Task 208): the strategist door posts refSlug, an
  // enrolled member's outreach link adds refMember (?via=<code>). Unknown
  // slugs/codes are dropped silently, never guessed — a payout trail must
  // point at real people from the registry, not at whatever a URL claims.
  const refSlugRaw = clean(body.refSlug, 60)
  const refMemberRaw = clean(body.refMember, 60)
  const strategist = refSlugRaw ? getStrategist(refSlugRaw) : undefined
  const member = strategist && refMemberRaw ? getStrategistMember(strategist.slug, refMemberRaw) : undefined
  const refSlug = strategist?.slug ?? null
  const refMember = member?.code ?? null
  const source = refSlug ? 'strategist-lp' : 'corporate-lp'

  const errors: string[] = []
  if (!business) errors.push('Tell us the business name.')
  if (!contactName) errors.push('Tell us your name.')
  if (!email || !EMAIL_RE.test(email)) errors.push('A working email address is required.')
  if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 })

  // The IP gate counts VALID claims only (it sits after validation), so an
  // office worker who fumbles the form never locks their whole building out;
  // only real submissions burn the quota.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ipGate = rateLimit(`corporate:ip:${ip}`, 6, 60 * 60 * 1000)
  if (!ipGate.ok) return NextResponse.json(tooMany(ipGate.retryAfterSec), { status: 429 })

  const emailGate = rateLimit(`corporate:email:${email}`, 3, 24 * 60 * 60 * 1000)
  if (!emailGate.ok) return NextResponse.json(tooMany(emailGate.retryAfterSec), { status: 429 })

  // Double-click proof: one row per email per day.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const existing = await db.corporateLead.findFirst({ where: { email, createdAt: { gte: dayAgo } } })
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const row = await db.corporateLead.create({
    data: {
      business, contactName, email,
      phone: phone || null, teamSize: teamSize || null, message: message || null,
      source, refSlug, refMember,
    },
  })

  const creditLine = refSlug
    ? `Referred by: ${strategist!.company} (${strategist!.slug})${member ? `, sourced by member ${member.name} (${member.code})` : ''}\nReferral law: R50 per managed lead this account takes${member ? ' (R25 strategist / R25 member split)' : ''}.`
    : ''
  const notify = await sendSystemMail({
    to: TEAM_INBOX,
    subject: `Corporate claim: ${business}${refSlug ? ` via ${strategist!.company}` : ''} (R550 credit)`,
    body: [
      refSlug ? 'A corporate account claim came in from a strategist door.' : 'A corporate account claim came in from the corporate page.',
      '',
      `Business: ${business}`,
      `Contact: ${contactName}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : '',
      teamSize ? `Team size: ${teamSize}` : '',
      message ? `Message: ${message}` : '',
      creditLine,
      '',
      `Claim id: ${row.id}`,
      'Next step: onboard by hand (account setup, R550 starting credit, managed rate R108).',
    ].filter((l) => l !== '').join('\n'),
    headline: refSlug ? 'Corporate claim (strategist)' : 'Corporate claim',
    title: `${business} wants in`,
    value: { text: 'R550 starting credit to apply', caption: 'Onboard by hand: account, credit, managed rate R108' },
    ctaLabel: 'Open HustlePortal',
    ctaUrl: 'https://www.hustleportal.online/',
    preheader: 'New corporate account claim from the corporate landing page.',
  })
  if (!notify.ok) console.error('[corporate] claim stored but team notify failed:', notify.error)

  return NextResponse.json({ ok: true, id: row.id })
}
