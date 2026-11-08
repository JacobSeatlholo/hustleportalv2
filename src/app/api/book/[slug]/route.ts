import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseAvail, computeSlots, humanSlot } from '@/lib/booking'
import { rateLimit, clientIp, tooMany } from '@/lib/ratelimit'
import { sendSystemMail } from '@/lib/mailer'
import { gcalInsert } from '@/lib/gcal'
import { gcalTemplateLink } from '@/lib/ics'

/**
 * POST /api/book/<slug> — a guest claims a slot on a booking page.
 *
 * Public by necessity (the guest has no account), defended by rate limit and
 * by re-deriving the slots server side at the moment of booking: the slot the
 * guest clicked must still be free RIGHT NOW, inside published availability,
 * at least the lead time ahead. The booking lands on the owner's calendar as
 * a CONFIRMED appointment — no approval step, that is the whole point: the
 * doctor knows the client is coming before the client leaves the page.
 * Owner notification + guest confirmation ride the transactional lane.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const verdict = rateLimit(`book:${clientIp(req)}`, 6, 10 * 60_000)
  if (!verdict.ok) return NextResponse.json(tooMany(verdict.retryAfterSec), { status: 429 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const link = await db.bookingLink.findUnique({
    where: { slug: String(slug || '') },
    include: { user: { select: { id: true, email: true, name: true, businessName: true } } },
  })
  // An inactive or missing page answers the same honest "no" — slugs are
  // unguessable, saying which half failed only helps an enumerator.
  if (!link || !link.active) {
    return NextResponse.json({ error: 'This booking page is not available.' }, { status: 404 })
  }

  const name = String(body.name || '').trim().slice(0, 80)
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120)
  const phone = String(body.phone || '').trim().slice(0, 30)
  const notes = String(body.notes || '').trim().slice(0, 500)
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  if (name.length < 2) return NextResponse.json({ error: 'Your name is required.' }, { status: 400 })
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'A real email address is required — your confirmation goes there.' }, { status: 400 })
  const slotStart = new Date(String(body.slotStart || ''))
  if (Number.isNaN(slotStart.getTime())) return NextResponse.json({ error: 'Pick a time slot first.' }, { status: 400 })

  // Re-derive the offer fresh: the slot must be in the CURRENT free set.
  const avail = parseAvail(link.avail)
  const durationMs = link.durationMin * 60_000
  const slotEnd = new Date(slotStart.getTime() + durationMs)
  const dayPadMs = 26 * 60 * 60 * 1000
  const busy = await db.appointment.findMany({
    where: {
      userId: link.userId,
      startsAt: { lt: new Date(slotStart.getTime() + dayPadMs) },
      OR: [{ endsAt: { gt: new Date(slotStart.getTime() - dayPadMs) } }, { endsAt: null, startsAt: { gt: new Date(slotStart.getTime() - dayPadMs) } }],
    },
    select: { startsAt: true, endsAt: true },
  })
  const days = computeSlots({
    avail,
    durationMin: link.durationMin,
    bufferMin: link.bufferMin,
    busy: busy.map((b) => ({ start: b.startsAt, end: b.endsAt || new Date(b.startsAt.getTime() + 60 * 60_000) })),
    from: new Date(),
    days: 15,
  })
  const stillFree = days.some((d) => d.slots.some((s) => s.start === slotStart.toISOString()))
  if (!stillFree) {
    return NextResponse.json({ error: 'That time was just taken or is no longer offered. Please pick another slot.' }, { status: 409 })
  }

  const ownerName = link.user.businessName?.trim() || link.user.name
  const venue = link.location?.trim() || ''
  const notesLine = [notes, phone ? `Phone: ${phone}` : '', venue ? `Venue: ${venue}` : ''].filter(Boolean).join(' · ')

  const appointment = await db.appointment.create({
    data: {
      userId: link.userId,
      title: `${link.title} — ${name}`.slice(0, 160),
      clientName: name,
      notes: notesLine || null,
      startsAt: slotStart,
      endsAt: slotEnd,
      source: 'BOOKING',
      bookingLinkId: link.id,
    },
  })
  await db.bookingLink.update({ where: { id: link.id }, data: { bookings: { increment: 1 } } })

  // Google Calendar sync if the owner connected it (same as manual appointments).
  let gcalSynced = false
  try {
    const inserted = await gcalInsert(link.userId, {
      title: appointment.title,
      startsAt: slotStart,
      endsAt: slotEnd,
      description: notesLine || undefined,
      location: venue || undefined,
    })
    if (inserted.ok) {
      await db.appointment.update({ where: { id: appointment.id }, data: { gcalEventId: inserted.eventId } })
      gcalSynced = true
    }
  } catch {
    // sync is a bonus, never the source of truth — the calendar row is
  }

  const when = humanSlot(slotStart.toISOString())
  const detailsLink = gcalTemplateLink({
    uid: appointment.id,
    title: `${link.title} — ${ownerName}`,
    startsAt: slotStart,
    endsAt: slotEnd,
    description: `Booked with ${ownerName} via HustlePortal.${notes ? ` Note: ${notes}` : ''}`,
    location: venue || undefined,
  })
  const icsUrl = `https://www.hustleportal.online/api/book/ics/${appointment.id}`

  // Owner: the whole point. A booking exists BEFORE the guest hangs up the page.
  const ownerMail = sendSystemMail({
    to: link.user.email,
    subject: `New booking: ${link.title} — ${when}`,
    headline: 'NEW BOOKING',
    title: `${link.title} — ${when}`,
    body: [
      `${name} just booked through your booking page.${venue ? ` Venue: ${venue}.` : ''}`,
      `Guest: ${name} · ${email}${phone ? ` · ${phone}` : ''}`,
      notes ? `They said: ${notes}` : '',
      'It is already on your calendar in HustlePortal — nothing to confirm.',
    ].filter(Boolean).join('\n'),
    ctaLabel: 'Open HustlePortal',
    ctaUrl: 'https://www.hustleportal.online',
    preheader: `${name} booked ${link.title} for ${when}`,
  })

  // Guest: the confirmation they can put in their own calendar.
  const guestMail = sendSystemMail({
    to: email,
    subject: `Confirmed: ${link.title} with ${ownerName} — ${when}`,
    headline: 'BOOKING CONFIRMED',
    title: `${link.title} with ${ownerName}`,
    value: { text: when, caption: venue || 'Time in South African time (SAST)' },
    body: [
      `Hi ${name.split(/\s+/)[0]}, your booking is in ${ownerName}'s calendar.`,
      link.description || '',
      'Tap below to add it to Google Calendar, or download the calendar file for any other app.',
    ].filter(Boolean).join('\n'),
    ctaLabel: 'Add to Google Calendar',
    ctaUrl: detailsLink,
    preheader: `${link.title} confirmed for ${when}`,
  })
  const [ownerSent, guestSent] = await Promise.all([ownerMail, guestMail])

  return NextResponse.json({
    ok: true,
    appointment: { id: appointment.id, startsAt: appointment.startsAt, endsAt: appointment.endsAt },
    when,
    gcalLink: detailsLink,
    icsUrl,
    ownerNotified: ownerSent.ok,
    guestNotified: guestSent.ok,
  })
}
