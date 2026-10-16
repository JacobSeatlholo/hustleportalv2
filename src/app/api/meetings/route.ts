import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { getUserId, hashPassword } from '@/lib/auth'
import { isExecUser } from '@/lib/admin'
import { ensureWallet, addCredits } from '@/lib/wallet'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import { awardXp } from '@/lib/gamification'
import { sendSystemMail } from '@/lib/mailer'
import { jitsiMeetLink } from '@/lib/meet'
import { welcomeEmail, inviteEmail, meetingWhen } from '@/lib/meeting'
import { confirmAndNotify } from '@/lib/meetingConfirm'

export const dynamic = 'force-dynamic'

const RESET_TTL_MS = 48 * 60 * 60 * 1000 // the welcome link gets 48 hours, not 30 minutes

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function normalizeEmail(v: unknown): string {
  return String(v || '').toLowerCase().trim()
}

// GET /api/meetings — exec sees every facilitated meeting; a member sees the
// ones they are part of (so their own views can surface them later). Every row
// carries its share link token (generated on the spot for meetings set before
// sharing existed) so the owner can copy the /m/<token> link straight out of
// the Meetings card, plus the note count from the shared page.
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, platformAdmin: true },
  })
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const exec = isExecUser(me)
  const meetings = await db.meeting.findMany({
    where: exec ? {} : { memberUserId: me.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { _count: { select: { comments: true } } },
  })
  // Meetings set before sharing existed get their token on first sight —
  // idempotent, and the token only ever reaches the owner and the parties.
  const rows = await Promise.all(
    meetings.map(async (m) => {
      let shareToken = m.shareToken
      if (!shareToken) {
        shareToken = crypto.randomBytes(16).toString('base64url')
        await db.meeting.update({ where: { id: m.id }, data: { shareToken } }).catch(() => {})
      }
      const { _count, ...rest } = m
      return { ...rest, shareToken, comments: _count.comments }
    }),
  )
  return NextResponse.json({ meetings: rows })
}

// POST /api/meetings — exec only: set a facilitated meeting.
// Creates the member's account when it does not exist yet (with the standard
// welcome credit), sends the welcome email (password link + Google Calendar
// how to), then the proposal email with the one tap confirm link.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, platformAdmin: true },
  })
  if (!me || !isExecUser(me)) {
    return NextResponse.json({ error: 'Exec access required.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const memberName = String(body.memberName || '').trim()
  const memberEmail = normalizeEmail(body.memberEmail)
  const guestEmail = normalizeEmail(body.guestEmail)
  const guestName = String(body.guestName || '').trim() || null
  const memberBusiness = String(body.memberBusiness || '').trim() || null
  const memberPhone = String(body.memberPhone || '').trim() || null
  const memberCity = String(body.memberCity || '').trim() || null
  const memberIndustry = String(body.memberIndustry || '').trim() || null
  const notes = String(body.notes || '').trim() || null
  // A physical venue means the meeting is in person: no Jitsi link is created,
  // and every page and email shows the venue instead of "Online".
  const location = String(body.location || '').trim().slice(0, 200) || null
  let title = String(body.title || '').trim()
  const startsAt = body.startsAt ? new Date(body.startsAt) : null
  const durationMin = Math.min(Math.max(Number(body.durationMin) || 60, 15), 240)

  if (!memberName || !memberEmail.includes('@') || !guestEmail.includes('@')) {
    return NextResponse.json({ error: 'Member name, member email and guest email are required.' }, { status: 400 })
  }
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: 'A valid date and time is required.' }, { status: 400 })
  }
  if (startsAt.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: 'The meeting time is in the past.' }, { status: 400 })
  }
  if (!title) {
    title = `Introduction: ${memberName} and ${guestName || guestEmail}`
  }
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)

  // Member account: reuse it when the email already exists, otherwise set one
  // up exactly like a signup would (wallet, welcome credit) minus the session
  // — the operator is creating it, so nobody gets signed in here.
  let member = await db.user.findUnique({ where: { email: memberEmail } })
  let accountCreated = false
  let passwordUrl: string | null = null
  if (!member) {
    const tempPassword = crypto.randomBytes(18).toString('base64url')
    member = await db.user.create({
      data: {
        email: memberEmail,
        passwordHash: await hashPassword(tempPassword),
        name: memberName,
        businessName: memberBusiness,
        industry: memberIndustry,
        city: memberCity,
        phone: memberPhone,
        role: 'MEMBER',
      },
    })
    await ensureWallet(member.id)
    const welcomeCents = parseInt(await getConfig(CONFIG_KEYS.WELCOME_CREDIT_CENTS)) || 9900
    if (welcomeCents > 0) {
      await addCredits(member.id, welcomeCents, 'BONUS', `Welcome bonus — R${Math.round(welcomeCents / 100)} in lead credits`)
    }
    await awardXp(member.id, 'SIGNUP', 50, 'Joined HustlePortal').catch(() => {})
    // Direct "choose your password" link (48 hour window) — friendlier than
    // asking a brand new member to find the Forgot password button.
    const token = crypto.randomBytes(32).toString('hex')
    await db.user.update({
      where: { id: member.id },
      data: { resetTokenHash: sha256(token), resetTokenExpiry: new Date(Date.now() + RESET_TTL_MS) },
    })
    passwordUrl = `${process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://hustleportal.online'}/reset?token=${token}`
    accountCreated = true
  }

  const meeting = await db.meeting.create({
    data: {
      ownerId: me.id,
      memberUserId: member.id,
      title,
      memberName,
      memberEmail,
      memberBusiness,
      memberPhone,
      guestName,
      guestEmail,
      startsAt,
      endsAt,
      meetLink: location ? null : jitsiMeetLink(title),
      location,
      confirmToken: crypto.randomBytes(24).toString('hex'),
      shareToken: crypto.randomBytes(16).toString('base64url'),
      notes,
      invitedAt: new Date(),
    },
  })

  // Welcome email goes only to a brand new account; the invite goes always.
  let welcomeError: string | null = null
  if (accountCreated) {
    const w = welcomeEmail({
      memberName,
      memberBusiness,
      passwordUrl: passwordUrl as string,
      proposedWhen: meetingWhen(startsAt),
    })
    const sent = await sendSystemMail({ to: memberEmail, ...w })
    if (!sent.ok) welcomeError = sent.error || 'Welcome email failed'
  }
  const inv = inviteEmail(meeting)
  const invite = await sendSystemMail({ to: memberEmail, ...inv })

  return NextResponse.json(
    {
      meeting,
      accountCreated,
      welcomeSent: accountCreated && !welcomeError,
      welcomeError,
      inviteSent: invite.ok,
      inviteError: invite.ok ? null : invite.error,
    },
    { status: 201 },
  )
}

// PATCH /api/meetings — exec only: reschedule a proposed meeting and/or
// record a confirmation on the member's behalf (she confirmed in person).
// Confirmation runs through the same engine as the member's own one tap, so
// both parties get the identical final-details email with the new time.
export async function PATCH(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, platformAdmin: true },
  })
  if (!me || !isExecUser(me)) {
    return NextResponse.json({ error: 'Exec access required.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Meeting id is required.' }, { status: 400 })
  const meeting = await db.meeting.findUnique({ where: { id } })
  if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })

  let current = meeting

  if (body.startsAt) {
    if (meeting.status !== 'PROPOSED') {
      return NextResponse.json({ error: 'Only a proposed meeting can be rescheduled.' }, { status: 400 })
    }
    const startsAt = new Date(String(body.startsAt))
    if (Number.isNaN(startsAt.getTime())) {
      return NextResponse.json({ error: 'A valid date and time is required.' }, { status: 400 })
    }
    if (startsAt.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: 'The meeting time is in the past.' }, { status: 400 })
    }
    // Keep the existing duration unless the operator asks for a new one.
    const durationMin = Math.min(
      Math.max(
        Number(body.durationMin) ||
          (meeting.endsAt
            ? Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000)
            : 60),
        15,
      ),
      240,
    )
    const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)
    current = await db.meeting.update({ where: { id }, data: { startsAt, endsAt } })
  }

  if (body.notes !== undefined) {
    const notes = String(body.notes || '').trim() || null
    current = await db.meeting.update({ where: { id }, data: { notes } })
  }

  // Venue fix: set a physical location ("Medispa, 99 Kloof Street") or clear
  // it to fall back to the online join link. The meet link itself can also be
  // replaced or cleared the same way, so the owner can flip a meeting between
  // in person and online without touching the database.
  if (body.location !== undefined) {
    const location = String(body.location || '').trim().slice(0, 200) || null
    current = await db.meeting.update({ where: { id }, data: { location } })
  }

  if (body.meetLink !== undefined) {
    const raw = String(body.meetLink || '').trim()
    const meetLink = raw && /^https?:\/\//.test(raw) ? raw : null
    current = await db.meeting.update({ where: { id }, data: { meetLink } })
  }

  if (body.confirm) {
    if (current.status === 'DECLINED') {
      return NextResponse.json({ error: 'This meeting was declined.' }, { status: 400 })
    }
    if (current.status === 'CONFIRMED') {
      return NextResponse.json({ meeting: current, alreadyConfirmed: true, emails: null })
    }
    const emails = await confirmAndNotify(current)
    current = (await db.meeting.findUnique({ where: { id } })) || current
    return NextResponse.json({
      meeting: current,
      alreadyConfirmed: false,
      emails: { member: emails.member.ok, guest: emails.guest.ok },
    })
  }

  return NextResponse.json({ meeting: current })
}
