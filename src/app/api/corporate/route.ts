import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { sendSystemMail, TEAM_INBOX } from '@/lib/mailer'
import { getStrategist, getStrategistMember } from '@/lib/corporate'
import { resolveAccessCode, consumeAccessCode } from '@/lib/corporateAccess'

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
// (and the row here), sets the account up by hand, applies the door's credit
// via the exec wallet tools, and puts the managed rate R110 on the account.
// Task 216 law (offer asymmetry): the credit follows the door. A claim that
// attributes to a strategist (slug context) carries the R550 exact-five
// credit. Task 217 (owner, Trinity Direct verdict): an access-code claim
// without strategist attribution carries the R120 code credit, so the ladder
// reads R550 strategist > R120 code > R99 bare fallback — circumvention lands
// on a cheaper rung, never a better one. The email states which one applies
// so the desk never has to guess. No self-serve magic, no auto-grants — money
// moves by human hands.

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
  const industry = clean(body.industry, 80)
  const leadsNeeded = clean(body.leadsNeeded, 60)

  // Referral attribution (Task 208): the strategist door posts refSlug, an
  // enrolled member's outreach link adds refMember (?via=<code>). Unknown
  // slugs/codes are dropped silently, never guessed — a payout trail must
  // point at real people from the registry, not at whatever a URL claims.
  const refSlugRaw = clean(body.refSlug, 60)
  const refMemberRaw = clean(body.refMember, 60)
  const strategist = refSlugRaw ? getStrategist(refSlugRaw) : undefined
  const member = strategist && refMemberRaw ? getStrategistMember(strategist.slug, refMemberRaw) : undefined

  // THE ACCESS GATE (Task 215): corporate is a closed channel. A claim needs
  // an access code — a team member's code (validated against the registry
  // with the door's slug context) or an exec-minted code. The code's own
  // attribution outranks whatever the URL claims: it is the credential that
  // actually opened the door.
  const access = await resolveAccessCode(body.accessCode, strategist?.slug ?? null)
  if (!access.ok) {
    return NextResponse.json(
      { error: 'This corporate door is locked. An access code from our team is required, or apply for an invitation.' },
      { status: 403 },
    )
  }
  const refSlug = access.slug ?? strategist?.slug ?? null
  const refMember = access.viaCode ?? member?.code ?? null
  const refStrategist = refSlug ? getStrategist(refSlug) : undefined
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

  // One use burned per accepted claim (minted codes only; member codes are
  // links, not tickets). Consumed after every gate so a fumbled form never
  // wastes the boss's hand-out.
  await consumeAccessCode(access)

  const row = await db.corporateLead.create({
    data: {
      business, contactName, email,
      phone: phone || null, teamSize: teamSize || null, message: message || null,
      industry: industry || null, leadsNeeded: leadsNeeded || null,
      source, refSlug, refMember,
    },
  })

  // Task 216/217: the credit follows the door, on a three-rung ladder — R550
  // only when the claim attributes to a strategist; an access-code claim
  // without strategist attribution carries the R120 code credit (the owner's
  // call at the Trinity Direct verdict); the R99 welcome stays the bare
  // fallback (no code ever touched the claim).
  const creditRands = refSlug ? 550 : access.kind ? 120 : 99
  const creditLine = refSlug
    ? `Referred by: ${refStrategist!.company} (${refStrategist!.slug})${refMember ? `, sourced by member code ${refMember}` : ''}${access.kind === 'minted' && access.label ? ` — access code "${access.label}"` : ''}\nReferral law: at the R110 corporate rate, R50 per managed lead is the Consortium's share${refMember ? ' (R25 strategist / R25 member split)' : ''}.`
    : `Access-code claim${access.kind === 'minted' && access.label ? ` ("${access.label}")` : ''}: no strategist attribution, so the R120 code credit applies. The R550 five lead credit is the strategist door credit — upgrade by owner decision only.`
  const notify = await sendSystemMail({
    to: TEAM_INBOX,
    subject: `Corporate claim: ${business}${refSlug ? ` via ${refStrategist!.company}` : ''} (R${creditRands} credit)`,
    body: [
      refSlug ? 'A corporate account claim came in from a strategist door.' : 'A corporate account claim came in from the corporate page.',
      '',
      `Business: ${business}`,
      `Contact: ${contactName}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : '',
      teamSize ? `Team size: ${teamSize}` : '',
      industry ? `Industry: ${industry}` : '',
      leadsNeeded ? `Leads needed: ${leadsNeeded}` : '',
      message ? `Message: ${message}` : '',
      creditLine,
      '',
      `Claim id: ${row.id}`,
      refSlug
        ? 'Next step: onboard by hand (account setup, R550 starting credit = 5 managed leads, managed rate R110).'
        : 'Next step: onboard by hand (account setup, R120 access-code starting credit, managed rate R110).',
    ].filter((l) => l !== '').join('\n'),
    headline: refSlug ? 'Corporate claim (strategist)' : 'Corporate claim',
    title: `${business} wants in`,
    value: { text: `R${creditRands} starting credit to apply`, caption: 'Onboard by hand: account, credit, managed rate R110' },
    ctaLabel: 'Open HustlePortal',
    ctaUrl: 'https://www.hustleportal.online/',
    preheader: 'New corporate account claim from the corporate landing page.',
  })
  if (!notify.ok) console.error('[corporate] claim stored but team notify failed:', notify.error)

  return NextResponse.json({ ok: true, id: row.id })
}
