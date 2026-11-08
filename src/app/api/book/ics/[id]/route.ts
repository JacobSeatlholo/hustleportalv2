import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildICS } from '@/lib/ics'

/**
 * GET /api/book/ics/<id> — the calendar file for a booking made through a
 * booking page. Public (the guest has no account) but scoped to booking-sourced
 * appointments only, and the id is an unguessable cuid. Any calendar app that
 * speaks .ics takes this; Google Calendar users get the one-tap template in
 * the confirmation email.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const appointment = await db.appointment.findFirst({
    where: { id: String(id || ''), bookingLinkId: { not: null } },
    include: {
      user: { select: { name: true, businessName: true } },
      bookingLink: { select: { location: true, description: true } },
    },
  })
  if (!appointment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ownerName = appointment.user.businessName?.trim() || appointment.user.name
  const ics = buildICS([
    {
      uid: appointment.id,
      title: `${appointment.title} · ${ownerName}`,
      description: appointment.notes || appointment.bookingLink?.description || `Booked with ${ownerName} via HustlePortal.`,
      location: appointment.bookingLink?.location || null,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
    },
  ])
  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="booking-${appointment.id.slice(-6)}.ics"`,
      'Cache-Control': 'no-store',
    },
  })
}
