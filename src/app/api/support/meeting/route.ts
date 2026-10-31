import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { isExecEmail } from '@/lib/admin'
import { sendSystemMail } from '@/lib/mailer'
import { meetingWhen, meetingLength } from '@/lib/meeting'
import { rateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/support/meeting — the member side of "talk to a human".
 *
 * The Support view lets a member book a call with the founder. The meeting
 * happens on Discord, so the row carries the Discord invite as its meet link.
 * Nothing is auto-confirmed: the request waits PROPOSED until the owner takes
 * it (one tap on the Exec Dashboard's Meetings card), then the standard
 * confirm engine emails both sides the final details. A member can only have
 * one request waiting at a time, and exec accounts are refused — the founder
 * does not book meetings with himself.
 *
 * The email law holds: the founder always sends messages himself; this only
 * places a request on his desk, it never sends anything to anyone else.
 */

const DISCORD_INVITE = 'https://discord.gg/kTnDEr7s7'
const SUPPORT_DURATION_MIN = 30

/** The house account the meeting belongs to (the founder's desk). */
async function founderUser() {
  return (
    (await db.user.findFirst({ where: { email: 'ceo@businesshustle.co.za' }, select: { id: true, email: true } })) ||
    (await db.user.findFirst({ where: { email: 'ops@hustleqa.example.com' }, select: { id: true, email: true } }))
  )
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, businessName: true, phone: true },
  })
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (isExecEmail(me.email)) {
    return NextResponse.json({ error: 'This desk is for members — the founder already sits next to you.' }, { status: 403 })
  }

  // Rate door: 3 requests a day per member, and only one waiting at a time.
  if (!rateLimit(`support-meeting:${me.id}`, 3, 24 * 60 * 60 * 1000).ok) {
    return NextResponse.json(
      { error: 'You have sent a few of these today. Give us a moment to catch up — or ping us on Discord right now.' },
      { status: 429 }
    )
  }
  const pending = await db.meeting.count({ where: { memberUserId: me.id, status: 'PROPOSED' } })
  if (pending > 0) {
    return NextResponse.json(
      { error: 'You already have a support call waiting to be confirmed. We have not forgotten you — give it a moment.' },
      { status: 429 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const topic = String(body?.topic || '').trim().slice(0, 120)
  const note = String(body?.note || '').trim().slice(0, 600)
  if (topic.length < 2) {
    return NextResponse.json({ error: 'Tell us what the call is about (a few words is enough).' }, { status: 400 })
  }

  // Preferred time: what the member asked for, or a sensible default
  // (tomorrow 09:00 South African time, UTC+2 all year) when flexible.
  let startsAt: Date
  const pref = body?.preferredAt ? new Date(String(body.preferredAt)) : null
  if (pref && !Number.isNaN(pref.getTime()) && pref.getTime() > Date.now() + 30 * 60_000) {
    startsAt = pref
  } else {
    startsAt = new Date()
    startsAt.setUTCDate(startsAt.getUTCDate() + 1)
    startsAt.setUTCHours(7, 0, 0, 0) // 09:00 SAST
  }
  const endsAt = new Date(startsAt.getTime() + SUPPORT_DURATION_MIN * 60_000)

  const founder = await founderUser()
  if (!founder) {
    return NextResponse.json({ error: 'The support desk is not set up right now — please use Discord.' }, { status: 503 })
  }

  const meeting = await db.meeting.create({
    data: {
      ownerId: founder.id,
      memberUserId: me.id,
      title: `Support call: ${topic}`,
      memberName: me.name || 'Member',
      memberEmail: me.email,
      memberBusiness: me.businessName,
      memberPhone: me.phone,
      guestName: 'The Founder — Business Hustle',
      guestEmail: founder.email,
      startsAt,
      endsAt,
      meetLink: DISCORD_INVITE,
      confirmToken: crypto.randomBytes(24).toString('hex'),
      shareToken: crypto.randomBytes(16).toString('base64url'),
      notes: note ? `The member's note: ${note}` : null,
      invitedAt: new Date(),
    },
  })

  // Receipt to the member: honest about what happens next, Discord for the impatient.
  const memberMail = await sendSystemMail({
    to: me.email,
    subject: `Support request received: ${topic}`,
    body: [
      `Hi ${me.name || 'there'},`,
      '',
      `Your support call request is in. Here is what we have:`,
      '',
      `WHAT: ${topic}`,
      `WHEN: ${meetingWhen(startsAt)}, ${meetingLength(startsAt, endsAt)}`,
      ...(note ? ['', `YOUR NOTE: ${note}`] : []),
      '',
      'What happens next: the founder locks the time from his desk (usually within a day) and you get an email with the final details. The call happens on Discord:',
      DISCORD_INVITE,
      '',
      'Cannot wait? The Discord is the fastest way to reach a human:',
      DISCORD_INVITE,
      '',
      'The time does not suit you? Reply to this email or say so on Discord and we will move it.',
      '',
      'Talk soon,',
      'The HustlePortal team',
      'Business Hustle · businesshustle.co.za',
    ].join('\n'),
  })

  // Request on the founder's desk (his inbox + the Meetings card).
  const founderMail = await sendSystemMail({
    to: founder.email,
    subject: `Support call requested: ${me.name || me.email} — ${topic}`,
    body: [
      `A member booked a support call with you.`,
      '',
      `Member: ${me.name || '—'}${me.businessName ? ` (${me.businessName})` : ''}`,
      `Email: ${me.email}${me.phone ? ` · Phone: ${me.phone}` : ''}`,
      `Topic: ${topic}`,
      `Requested time: ${meetingWhen(startsAt)} (${SUPPORT_DURATION_MIN} min)`,
      ...(note ? ['', `Their note: ${note}`] : []),
      '',
      `The meeting happens on Discord: ${DISCORD_INVITE}`,
      'Confirm it with one tap on the Meetings card of your Exec Dashboard (that emails them the final details), or reschedule it there first.',
    ].join('\n'),
  })

  return NextResponse.json(
    {
      ok: true,
      meetingId: meeting.id,
      startsAt: meeting.startsAt,
      discord: DISCORD_INVITE,
      memberEmailed: memberMail.ok,
      founderNotified: founderMail.ok,
    },
    { status: 201 },
  )
}
