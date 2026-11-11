import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { resolveProject } from '@/lib/workspace'
import { jitsiMeetLink } from '@/lib/meet'
import { gcalInsert } from '@/lib/gcal'
import { sendAppointmentInvite, validInviteEmail } from '@/lib/appointmentInvite'

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
  // The guest's inbox: optional, but if it is set it must be real — the
  // whole point of the field is that the link lands there the moment this
  // appointment saves.
  const clientEmail = validInviteEmail(String(body.clientEmail || ''))
  if (body.clientEmail && body.clientEmail.trim() && !clientEmail) {
    return NextResponse.json({ error: "That email doesn't look right — check it or leave the field empty." }, { status: 400 })
  }
  const project = await resolveProject(userId, body.projectId)
  const meetLink = body.meetLink || jitsiMeetLink(title)
  const appointment = await db.appointment.create({
    data: {
      userId,
      projectId: project.id,
      title,
      clientName: body.clientName || null,
      clientEmail,
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
  // The instant invite: an email on the appointment means the meeting link
  // is in the guest's inbox before the save dialog even closes. The booking
  // is already safe, so a mail failure reports honestly instead of failing.
  let invite: { sent: boolean; error?: string; to: string } | null = null
  if (clientEmail) {
    try {
      invite = await sendAppointmentInvite(userId, appointment.id)
    } catch (e) {
      invite = { sent: false, error: e instanceof Error ? e.message : 'Invite failed to send.', to: clientEmail }
    }
  }
  return NextResponse.json({ appointment: { ...appointment, gcalEventId }, gcalSynced: !!gcalEventId, invite }, { status: 201 })
}

function notes_body(notes: unknown, meetLink: string) {
  const n = typeof notes === 'string' && notes.trim() ? notes.trim() + '\n\n' : ''
  return `${n}Join the meeting: ${meetLink}`
}
