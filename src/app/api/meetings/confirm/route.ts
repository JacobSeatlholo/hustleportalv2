import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendSystemMail, TEAM_INBOX } from '@/lib/mailer'
import {
  confirmedEmail,
  confirmedExecEmail,
  confirmPage,
  confirmedPage,
  alreadyConfirmedPage,
  invalidTokenPage,
  HTML_HEADERS,
  meetingWhen,
  memberLabel,
  guestLabel,
} from '@/lib/meeting'

export const dynamic = 'force-dynamic'

// GET /api/meetings/confirm?token=… — the page the invite email opens.
// Side effect free: the actual confirm is a form POST, so email scanners that
// prefetch links can never confirm anything by accident.
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')?.trim() || ''
  if (!token) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  const meeting = await db.meeting.findUnique({ where: { confirmToken: token } })
  if (!meeting) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  if (meeting.status === 'CONFIRMED') {
    return new NextResponse(alreadyConfirmedPage(meeting), { headers: HTML_HEADERS })
  }
  if (meeting.status !== 'PROPOSED') {
    return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  }
  return new NextResponse(confirmPage(meeting), { headers: HTML_HEADERS })
}

// POST /api/meetings/confirm — the one tap lands here. Confirms the meeting,
// emails BOTH parties the final details, and drops a note to the team inbox.
export async function POST(req: NextRequest) {
  let token = ''
  try {
    const form = await req.formData()
    token = String(form.get('token') || '').trim()
  } catch {
    token = new URL(req.url).searchParams.get('token')?.trim() || ''
  }
  if (!token) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  const meeting = await db.meeting.findUnique({ where: { confirmToken: token } })
  if (!meeting) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  if (meeting.status === 'CONFIRMED') {
    return new NextResponse(alreadyConfirmedPage(meeting), { headers: HTML_HEADERS })
  }
  if (meeting.status !== 'PROPOSED') {
    return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  }

  await db.meeting.update({
    where: { id: meeting.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  })

  // Final details to BOTH parties. Each send is independent: one rejection
  // never silences the other.
  const toMember = confirmedEmail(meeting, meeting.memberName)
  const toGuest = confirmedEmail(meeting, meeting.guestName || meeting.guestEmail)
  const [a, b] = await Promise.all([
    sendSystemMail({ to: meeting.memberEmail, ...toMember }),
    sendSystemMail({ to: meeting.guestEmail, ...toGuest }),
  ])
  await db.meeting
    .update({ where: { id: meeting.id }, data: { emailsSentAt: new Date() } })
    .catch(() => {})

  // Quiet note so the team hears it the moment it happens (best effort).
  const execNote = confirmedExecEmail(meeting)
  await sendSystemMail({ to: TEAM_INBOX, ...execNote }).catch(() => {})

  console.log(
    `[meetings] confirmed: ${memberLabel(meeting)} and ${guestLabel(meeting)} — ${meetingWhen(meeting.startsAt)} · member mail ${a.ok ? 'sent' : 'FAILED'} · guest mail ${b.ok ? 'sent' : 'FAILED'}`,
  )

  return new NextResponse(confirmedPage(meeting), { headers: HTML_HEADERS })
}
