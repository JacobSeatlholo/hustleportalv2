import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { buildICS } from '@/lib/ics'
import { bookingVenueFromNotes } from '@/lib/whatsapp'

type Params = { params: Promise<{ id: string }> }

// GET /api/appointments/ics/[id] → this one meeting as a text/calendar file.
// The Apple Calendar door the boss asked for: set the meeting, tap the chip,
// Calendar (Mac or iPhone) offers to add it — no Google account, no copy-paste,
// no blob-download flakiness on iOS. The owner's session is the key; anyone
// else gets a 401/404 that reveals nothing.
export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const a = await db.appointment.findFirst({ where: { id, userId } })
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The venue rides the notes line on booking-sourced rows ("Venue: …") —
  // surface it as a real LOCATION so Apple Calendar offers tap-to-navigate.
  const venue = bookingVenueFromNotes(a.notes)
  const descParts: string[] = []
  if (a.notes) descParts.push(a.notes)
  if (a.meetLink && !(a.notes || '').includes(a.meetLink)) descParts.push(`Join online: ${a.meetLink}`)

  const ics = buildICS([
    {
      uid: a.id,
      title: a.title,
      description: descParts.join('\n') || null,
      location: venue,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
    },
  ])
  const fname =
    a.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'meeting'
  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}.ics"`,
      'Cache-Control': 'no-store',
    },
  })
}
