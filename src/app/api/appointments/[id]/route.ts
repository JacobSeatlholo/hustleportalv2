import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { jitsiMeetLink } from '@/lib/meet'
import { gcalInsert } from '@/lib/gcal'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/appointments/[id] → reschedule / edit / regenerate meet link
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await db.appointment.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim()
  if ('clientName' in body) data.clientName = body.clientName || null
  if ('notes' in body) data.notes = body.notes || null
  if (body.startsAt) {
    const d = new Date(body.startsAt)
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid date.' }, { status: 400 })
    data.startsAt = d
  }
  if ('endsAt' in body) data.endsAt = body.endsAt ? new Date(body.endsAt) : null
  if (body.regenerateMeetLink) data.meetLink = jitsiMeetLink(body.title || existing.title)
  const appointment = await db.appointment.update({ where: { id }, data })

  // If the user moved the event and GCal was previously synced, push the update (best-effort)
  if ((data.startsAt || data.title) && existing.gcalEventId) {
    try {
      const tokenRow = await db.userSetting.findUnique({
        where: { userId_key: { userId, key: 'GCAL_OAUTH_TOKEN' } },
      })
      if (tokenRow?.value) {
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${existing.gcalEventId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${tokenRow.value}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: appointment.title,
            start: { dateTime: appointment.startsAt.toISOString() },
            end: { dateTime: (appointment.endsAt || new Date(appointment.startsAt.getTime() + 3600000)).toISOString() },
          }),
          signal: AbortSignal.timeout(10_000),
        })
      }
    } catch {
      // non-fatal
    }
  }
  return NextResponse.json({ appointment })
}

// DELETE /api/appointments/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await db.appointment.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.appointment.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

// POST /api/appointments/[id], kept for symmetry: force a Google Calendar sync now
export async function POST(_req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await db.appointment.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const inserted = await gcalInsert(userId, {
    title: existing.title,
    description: existing.notes,
    location: existing.meetLink,
    startsAt: existing.startsAt,
    endsAt: existing.endsAt,
  })
  if (!inserted.ok) return NextResponse.json({ error: inserted.error }, { status: 400 })
  const appointment = await db.appointment.update({
    where: { id },
    data: { gcalEventId: inserted.eventId },
  })
  return NextResponse.json({ appointment })
}
