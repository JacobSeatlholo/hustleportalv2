import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { resolveProject } from '@/lib/workspace'
import { jitsiMeetLink } from '@/lib/meet'
import { gcalInsert } from '@/lib/gcal'

// GET /api/appointments?scope=upcoming|past
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scope = new URL(req.url).searchParams.get('scope') || 'upcoming'
  const where = scope === 'past' ? { userId, startsAt: { lt: new Date() } } : { userId, startsAt: { gte: new Date() } }
  const appointments = await db.appointment.findMany({
    where,
    orderBy: { startsAt: scope === 'past' ? 'desc' : 'asc' },
    take: 100,
  })
  return NextResponse.json({ appointments })
}

// POST /api/appointments → create with auto Jitsi link (+ optional immediate GCal sync)
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  if (!title) return NextResponse.json({ error: 'Give the appointment a title.' }, { status: 400 })
  const startsAt = body.startsAt ? new Date(body.startsAt) : null
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: 'A valid date & time is required.' }, { status: 400 })
  }
  const endsAt = body.endsAt ? new Date(body.endsAt) : null
  const project = await resolveProject(userId, body.projectId)
  const meetLink = body.meetLink || jitsiMeetLink(title)
  const appointment = await db.appointment.create({
    data: {
      userId,
      projectId: project.id,
      title,
      clientName: body.clientName || null,
      notes: body.notes || null,
      startsAt,
      endsAt,
      meetLink,
      source: body.source === 'VOICE' ? 'VOICE' : 'MANUAL',
    },
  })
  // Best-effort Google Calendar sync if the user connected a token
  let gcalEventId: string | null = appointment.gcalEventId
  try {
    const inserted = await gcalInsert(userId, {
      title,
      description: notes_body(body.notes, meetLink),
      location: meetLink,
      startsAt,
      endsAt,
    })
    if (inserted.ok) {
      await db.appointment.update({ where: { id: appointment.id }, data: { gcalEventId: inserted.eventId } })
      gcalEventId = inserted.eventId
    }
  } catch {
    // sync is optional, the ICS/template link fallbacks always work
  }
  return NextResponse.json({ appointment: { ...appointment, gcalEventId }, gcalSynced: !!gcalEventId }, { status: 201 })
}

function notes_body(notes: unknown, meetLink: string) {
  const n = typeof notes === 'string' && notes.trim() ? notes.trim() + '\n\n' : ''
  return `${n}Join the meeting: ${meetLink}`
}
