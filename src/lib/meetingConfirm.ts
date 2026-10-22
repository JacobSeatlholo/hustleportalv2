/**
 * Shared "confirm a meeting and tell everyone" engine.
 *
 * Used by two paths that must behave identically:
 *  - the member's one tap confirm (POST /api/meetings/confirm?token=…)
 *  - the exec recording an in-person confirmation on the member's behalf
 *    (PATCH /api/meetings with confirm: true)
 *
 * Flips the meeting to CONFIRMED, emails BOTH parties the final details
 * (each send is independent, one rejection never silences the other) and
 * drops a quiet note to the team inbox.
 */
import { db } from '@/lib/db'
import { sendSystemMail, TEAM_INBOX } from '@/lib/mailer'
import {
  confirmedEmail,
  confirmedExecEmail,
  meetingWhen,
  memberLabel,
  guestLabel,
  type MeetingLike,
} from '@/lib/meeting'

export async function confirmAndNotify(meeting: MeetingLike & { id: string }) {
  await db.meeting.update({
    where: { id: meeting.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  })

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
  await sendSystemMail({ to: TEAM_INBOX, ...confirmedExecEmail(meeting) }).catch(() => {})

  console.log(
    `[meetings] confirmed: ${memberLabel(meeting)} and ${guestLabel(meeting)}, ${meetingWhen(meeting.startsAt)} · member mail ${a.ok ? 'sent' : 'FAILED'} · guest mail ${b.ok ? 'sent' : 'FAILED'}`,
  )

  return { member: a, guest: b }
}
