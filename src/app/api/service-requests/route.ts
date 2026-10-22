import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { sendTeamMail } from '@/lib/mailer'

export const maxDuration = 30

/**
 * POST /api/service-requests, the user requests a Business Hustle service
 * (web design, marketing, coaching…) from inside the platform.
 *
 * One request, three reliable outcomes:
 *   1. Email to team@businesshustle.co.za (platform delivery, Reply-To the user).
 *   2. A task on the USER's dashboard with an urgency level, so they can track it.
 *   3. An EmailLog row for full auditability.
 *
 * Body: { serviceTitle: string, serviceId?: string, urgency: 'ASAP'|'THIS_WEEK'|'PLANNING', message?: string }
 * Resp: { ok, ref, task, emailSent, emailTo? } | { error }
 */

const URGENCY = {
  ASAP: { priority: 'HIGH', dueInDays: 1, label: 'Urgent, ASAP' },
  THIS_WEEK: { priority: 'MEDIUM', dueInDays: 3, label: 'This week' },
  PLANNING: { priority: 'LOW', dueInDays: null, label: 'Just planning' },
} as const

type UrgencyKey = keyof typeof URGENCY

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const serviceTitle = String(body.serviceTitle || '').trim().slice(0, 120)
  const serviceId = String(body.serviceId || '').trim().slice(0, 60) || null
  // Normalize ONCE and use the normalized value everywhere: testing one string and
  // using another is exactly how `urgency` became "undefined" and 500'd the route.
  const urgencyRaw = String(body.urgency || 'THIS_WEEK').trim()
  const urgency: UrgencyKey = (urgencyRaw as UrgencyKey) in URGENCY ? (urgencyRaw as UrgencyKey) : 'THIS_WEEK'
  const message = String(body.message || '').trim().slice(0, 2000)

  if (!serviceTitle) {
    return NextResponse.json({ error: 'Which service do you need? Choose one first.' }, { status: 400 })
  }

  try {
    return await createServiceRequest(userId, serviceTitle, serviceId, urgency, message)
  } catch (e) {
    // Never leave the user with an opaque 500: name what broke, keep the response shape honest.
    console.error('[service-requests] failed:', e)
    return NextResponse.json(
      { error: 'We could not log your request just now. Please try again in a minute, or email team@businesshustle.co.za directly.', detail: e instanceof Error ? e.message.slice(0, 300) : 'unknown error' },
      { status: 500 },
    )
  }
}

async function createServiceRequest(
  userId: string,
  serviceTitle: string,
  serviceId: string | null,
  urgency: UrgencyKey,
  message: string,
) {

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, businessName: true, city: true, phone: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ref = `SR-${Date.now().toString(36).toUpperCase().slice(-6)}`
  const u = URGENCY[urgency]
  const dueDate = u.dueInDays ? new Date(Date.now() + u.dueInDays * 86_400_000) : null

  // 1) Trackable task on the user's dashboard, with the urgency as priority.
  const task = await db.task.create({
    data: {
      title: `Service request ${ref}: ${serviceTitle}`,
      notes:
        `Requested via HustlePortal Services · urgency: ${u.label}\n` +
        (message ? `\nYour brief: ${message}\n` : '') +
        `\nThe Business Hustle team has been emailed, they reply to ${user.email}. Mark this done once the project is delivered.`,
      priority: u.priority,
      dueDate,
      status: 'TODO',
      creatorId: userId,
      assigneeId: userId,
    },
  })

  // 2) Email the team, Reply-To the user so replies land in their inbox.
  const mailBody = [
    `New service request ${ref} (urgency: ${u.label})`,
    ``,
    `Service: ${serviceTitle}${serviceId ? ` [${serviceId}]` : ''}`,
    `From: ${user.name || '—'} (${user.email})`,
    user.businessName ? `Business: ${user.businessName}` : '',
    user.city ? `City: ${user.city}` : '',
    user.phone ? `Phone: ${user.phone}` : '',
    ``,
    message ? `Brief:\n${message}` : '(No extra brief provided)',
    ``,
    `A matching task is already on ${user.name || 'the user'}'s dashboard (${task.title}).`,
  ]
    .filter((l) => l !== '')
    .join('\n')

  const mail = await sendTeamMail(userId, {
    subject: `[Service request · ${u.label}] ${serviceTitle}, ${ref}`,
    body: mailBody,
  })

  // 3) Audit trail regardless of delivery outcome.
  await db.emailLog.create({
    data: {
      userId,
      toEmail: 'to' in mail ? mail.to : 'team@businesshustle.co.za',
      subject: `[Service request · ${u.label}] ${serviceTitle}, ${ref}`,
      body: mailBody,
      status: mail.ok ? 'SENT' : 'FAILED',
      provider: 'PLATFORM',
      error: mail.ok ? null : mail.error.slice(0, 500),
    },
  })

  return NextResponse.json({
    ok: true,
    ref,
    task,
    emailSent: mail.ok,
    emailTo: 'to' in mail ? mail.to : undefined,
    ...(mail.ok ? {} : { emailWarning: 'Your request is tracked in Tasks. The email gateway hiccuped, our team can also see it next time you contact us; no action needed.' }),
  })
}
