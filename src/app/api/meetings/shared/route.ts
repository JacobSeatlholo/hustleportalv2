import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { sendSystemMail, TEAM_INBOX } from '@/lib/mailer'
import { confirmAndNotify } from '@/lib/meetingConfirm'
import {
  meetingNoteEmail,
  meetingMovedEmail,
  meetingSharedExecEmail,
  meetingWhen,
  sharedUrl,
  invalidTokenPage,
  HTML_HEADERS,
  type MeetingLike,
} from '@/lib/meeting'

export const dynamic = 'force-dynamic'

// POST /api/meetings/shared, actions from the shared meeting page
// (/m/<shareToken>). The token is the credential: only someone the owner sent
// the link to has it. Three actions, all plain HTML form posts so the page
// works on any phone with zero JavaScript:
//   comment , a note both sides and the team see; the other side is emailed
//   propose , a new time; the meeting flips back to PROPOSED and both sides
//              are emailed to confirm
//   confirm , one tap confirm of a proposed time (same engine as the invite
//              email, so the same final-details emails go out)
// Every action ends with a redirect back to the page, so the visitor always
// lands on the current truth.

function authorNameFor(m: MeetingLike, side: string): string {
  return side === 'GUEST' ? m.guestName || 'The guest' : m.memberName
}

function otherSideEmail(m: MeetingLike, side: string): string {
  return side === 'GUEST' ? m.memberEmail : m.guestEmail
}

function otherSideName(m: MeetingLike, side: string): string {
  return side === 'GUEST' ? m.memberName : m.guestName || m.guestEmail
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  }
  const token = String(form.get('token') || '').trim()
  const action = String(form.get('action') || '').trim()
  const side = String(form.get('side') || '').trim() === 'GUEST' ? 'GUEST' : 'MEMBER'

  if (!token) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  const meeting = await db.meeting.findUnique({ where: { shareToken: token } })
  if (!meeting) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })

  // A human pace: plenty for two parties coordinating one appointment, tight
  // enough that a leaked link cannot be turned into a mail cannon.
  const gate = rateLimit(`meetingshared:${token}`, 20, 60 * 60 * 1000)
  if (!gate.ok) {
    return NextResponse.redirect(new URL(`/m/${encodeURIComponent(token)}?msg=slow`, req.url), 303)
  }

  const back = (msg: string) =>
    NextResponse.redirect(new URL(`/m/${encodeURIComponent(token)}?msg=${msg}`, req.url), 303)
  const link = sharedUrl(token)
  const author = authorNameFor(meeting, side)

  if (action === 'comment') {
    const body = String(form.get('body') || '').trim().slice(0, 2000)
    if (!body) return back('error')
    await db.meetingComment.create({
      data: { meetingId: meeting.id, side, authorName: author, body },
    })
    // The other side hears it the moment it lands (best effort, a mail hiccup
    // never blocks the note itself). The poster does not email themselves.
    const to = otherSideEmail(meeting, side)
    const name = otherSideName(meeting, side)
    await sendSystemMail({ to, ...meetingNoteEmail(meeting, name, author, body, link) }).catch(() => {})
    await sendSystemMail({
      to: TEAM_INBOX,
      ...meetingSharedExecEmail(meeting, 'A note was posted', author, `"${body}"`),
    }).catch(() => {})
    return back('posted')
  }

  if (action === 'propose') {
    const date = String(form.get('date') || '').trim()
    const time = String(form.get('time') || '').trim()
    // South Africa stays on UTC+2 all year, so the fixed offset is safe.
    const startsAt = date && time ? new Date(`${date}T${time}:00+02:00`) : null
    if (!startsAt || Number.isNaN(startsAt.getTime())) return back('error')
    if (startsAt.getTime() < Date.now() - 60_000) return back('past')
    const durationMin = Math.min(
      Math.max(
        meeting.endsAt ? Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000) : 60,
        15,
      ),
      240,
    )
    const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)
    await db.meeting.update({
      where: { id: meeting.id },
      data: { startsAt, endsAt, status: 'PROPOSED', confirmedAt: null, emailsSentAt: null },
    })
    const when = meetingWhen(startsAt)
    await db.meetingComment.create({
      data: {
        meetingId: meeting.id,
        side,
        authorName: author,
        body: `Proposed moving this meeting to ${when}.`,
      },
    })
    const updated = { ...meeting, startsAt, endsAt }
    await Promise.all([
      sendSystemMail({
        to: meeting.memberEmail,
        ...meetingMovedEmail(updated, meeting.memberName, author, link),
      }).catch(() => {}),
      sendSystemMail({
        to: meeting.guestEmail,
        ...meetingMovedEmail(updated, meeting.guestName || meeting.guestEmail, author, link),
      }).catch(() => {}),
    ])
    await sendSystemMail({
      to: TEAM_INBOX,
      ...meetingSharedExecEmail(updated, 'A new time was proposed', author, `Proposed: ${when}. The meeting now waits for a fresh confirm.`),
    }).catch(() => {})
    return back('moved')
  }

  if (action === 'confirm') {
    if (meeting.status === 'CONFIRMED') return back('already')
    if (meeting.status === 'DECLINED') return back('declined')
    await confirmAndNotify(meeting)
    return back('confirmed')
  }

  return back('error')
}
