/**
 * The appointment invite — the meeting link lands in the guest's inbox the
 * moment the appointment is saved. No copy-paste, no WhatsApp chase, no
 * "I never got the link".
 *
 * Lane law: the invite is the MEMBER'S voice to THEIR client, so it rides
 * sendMail — their connected Gmail when they have one, the HustlePortal
 * engine otherwise, Reply-To their account email either way. The sender's
 * workspace (projectId) is passed through so a multi-business account mails
 * each client from the business the appointment actually belongs to. The
 * look is boardroom (the meeting-confirmation chrome) wearing the standard
 * character — a member-owned send never carries BH chrome (Task 190 law).
 *
 * Transactional, not bulk: no airtime gate, no open pixel, no unsubscribe —
 * the same law the booking confirmations and meeting confirms ride. The
 * appointment row itself is the receipt (inviteSentAt).
 */
import { db } from '@/lib/db'
import { sendMail } from '@/lib/mailer'
import { meetingWhen, meetingLength } from '@/lib/meeting'
import type { MailThemeId } from '@/lib/mailthemes'

export const INVITE_THEME: MailThemeId = 'boardroom'

const CAMPAIGN_LOGO_KEY = 'CAMPAIGN_LOGO'

export interface InviteAppt {
  title: string
  clientName: string | null
  clientEmail: string
  notes: string | null
  startsAt: Date
  endsAt: Date | null
  meetLink: string | null
}

export interface InviteSendResult {
  sent: boolean
  error?: string
  to: string
}

/** The email-light check the invite trusts. Optional field, but if it is set
 *  it must be an honest address — a bounced invite is a no-show. */
export function validInviteEmail(raw: string): string | null {
  const email = String(raw || '').trim()
  if (!email) return null
  if (email.length > 254) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null
}

/** The invite words: the member's voice, one screen, the link impossible to miss. */
export function appointmentInviteEmail(
  appt: InviteAppt,
  sender: { businessName: string; senderName?: string | null },
): { subject: string; body: string } {
  const who = appt.clientName ? firstName(appt.clientName) : 'there'
  const business = sender.businessName || 'HustlePortal'
  const from = sender.senderName ? `${sender.senderName} at ${business}` : business
  const link = appt.meetLink || 'The meeting link will follow shortly.'
  const lines: string[] = [
    `Hi ${who},`,
    '',
    `${from} has booked you for ${appt.title}.`,
    '',
    `WHEN: ${meetingWhen(appt.startsAt)}, ${meetingLength(appt.startsAt, appt.endsAt)}`,
    'WHERE: online — join with the link below',
    '',
    'JOIN THE MEETING:',
    link,
    '',
  ]
  if (appt.notes && appt.notes.trim()) {
    lines.push(`NOTES: ${appt.notes.trim().slice(0, 400)}`, '')
  }
  lines.push(
    'Need to move it or can no longer make it? Just reply to this email and we will sort you out.',
  )
  return {
    subject: `Meeting invite: ${appt.title.slice(0, 80)}`,
    body: lines.join('\n'),
  }
}

/** Send the invite for an appointment and stamp the row. Never throws: the
 *  appointment is already saved by the time this runs — a mail hiccup must
 *  never undo the booking, it only reports honestly. */
export async function sendAppointmentInvite(userId: string, apptId: string): Promise<InviteSendResult> {
  const appt = await db.appointment.findUnique({ where: { id: apptId } })
  if (!appt || appt.userId !== userId) return { sent: false, error: 'Appointment not found.', to: '' }
  const email = validInviteEmail(appt.clientEmail || '')
  if (!email) return { sent: false, error: 'No valid email on this appointment.', to: '' }
  if (!appt.meetLink) return { sent: false, error: 'This appointment has no meeting link yet.', to: '' }

  const user = await db.user.findUnique({ where: { id: userId }, select: { businessName: true, name: true, email: true } })
  const business = user?.businessName?.trim() || user?.name?.trim() || ''
  // The brand law (Task 185/190): when the member uploaded a campaign logo,
  // their client gets mail that looks like it came from THAT business — their
  // logo on the banner, their name as the wordmark, one quiet platform credit
  // in the footer. No logo → the neutral standard chrome, still never BH.
  let brand: { name: string; logoUrl: string } | undefined
  if (business) {
    const logo = await db.userSetting.findUnique({
      where: { userId_key: { userId, key: CAMPAIGN_LOGO_KEY } },
      select: { value: true },
    })
    if (logo?.value) brand = { name: business, logoUrl: `/api/campaign-logo/${userId}` }
  }
  const { subject, body } = appointmentInviteEmail(
    { ...appt, clientEmail: email, meetLink: appt.meetLink },
    { businessName: business, senderName: user?.name },
  )
  const result = await sendMail(userId, {
    to: email,
    subject,
    body,
    theme: INVITE_THEME,
    ...(brand ? { brand } : {}),
    ...(appt.projectId ? { projectId: appt.projectId } : {}),
  })
  if (result.ok) {
    await db.appointment
      .update({ where: { id: apptId }, data: { inviteSentAt: new Date() } })
      .catch(() => {})
    return { sent: true, to: email }
  }
  return { sent: false, error: result.error, to: email }
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0]
  return first || 'there'
}
