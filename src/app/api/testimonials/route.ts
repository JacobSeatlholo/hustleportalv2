import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { getStrategist } from '@/lib/corporate'
import { getSessionUser } from '@/lib/auth'
import { sendSystemMail, TEAM_INBOX } from '@/lib/mailer'

// ============ TESTIMONIALS (Task 219, owner) ============
// Members and prospects tell their story; the desk approves; the doors and the
// landing show the approved wall. Laws:
//  - Nothing renders publicly before a human yes: this route only ever serves
//    approved rows, and POST always creates approved=false.
//  - Task 213 law holds ("no invented testimonials"): every quote on the walls
//    comes from a real submission in this table.
//  - Rate limited per IP, honeypotted, length-capped — the wall cannot be
//    flooded, and the desk sees every submission in the exec dashboard.

export const maxDuration = 15

function clean(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const slugRaw = clean(url.searchParams.get('slug'), 60)
  const slug = slugRaw && getStrategist(slugRaw) ? slugRaw : null
  const rows = await db.testimonial.findMany({
    where: { approved: true, ...(slug ? { refSlug: slug } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { id: true, name: true, business: true, location: true, body: true, rating: true, refSlug: true, createdAt: true },
  })
  return NextResponse.json({ testimonials: rows })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // Honeypot, same law as every public form: bots fill every input they find.
  if (clean(body.companyWebsite, 160)) {
    return NextResponse.json({ ok: true })
  }

  const name = clean(body.name, 80)
  const business = clean(body.business, 120)
  const location = clean(body.location, 80)
  const story = clean(body.body, 600)
  const ratingRaw = Number(body.rating)
  const rating = Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : 5
  const slugRaw = clean(body.slug, 60)
  const refSlug = slugRaw && getStrategist(slugRaw) ? slugRaw : null

  const errors: string[] = []
  if (name.length < 2) errors.push('Tell us your name as you want it shown.')
  if (story.length < 20) errors.push('Your story needs at least a sentence or two (20+ characters).')
  if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ipGate = rateLimit(`testimonial:ip:${ip}`, 3, 60 * 60 * 1000)
  if (!ipGate.ok) return NextResponse.json(tooMany(ipGate.retryAfterSec), { status: 429 })

  // If a member is logged in, the story ties to their account (setnull on delete).
  const session = await getSessionUser().catch(() => null)

  const row = await db.testimonial.create({
    data: {
      name, body: story, rating,
      business: business || null,
      location: location || null,
      refSlug,
      userId: session?.id ?? null,
    },
  })

  // The bell, never the gate: a failed notify never fails the submission.
  const notify = await sendSystemMail({
    to: TEAM_INBOX,
    subject: `New testimonial awaiting approval: ${name}`,
    body: [
      'A testimonial was submitted and is waiting for your yes in the exec dashboard.',
      '',
      `Name: ${name}`,
      business ? `Business: ${business}` : '',
      location ? `Location: ${location}` : '',
      `Rating: ${rating}/5`,
      `Door: ${refSlug ?? 'main site'}`,
      '',
      `Story: ${story}`,
      '',
      `Testimonial id: ${row.id}`,
      'Next step: approve or delete it in the exec dashboard testimonials card.',
    ].filter((l) => l !== '').join('\n'),
    headline: 'New testimonial',
    title: `${name} shared their story`,
    value: { text: 'Approve or delete in the exec dashboard', caption: 'Nothing shows publicly before your yes' },
    ctaLabel: 'Open the exec dashboard',
    ctaUrl: 'https://www.hustleportal.online/',
    preheader: 'A testimonial is waiting for approval.',
  })
  if (!notify.ok) console.error('[testimonials] stored but team notify failed:', notify.error)

  return NextResponse.json({ ok: true, id: row.id })
}
