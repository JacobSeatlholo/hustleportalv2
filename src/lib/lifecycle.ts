import { db } from '@/lib/db'
import { sendSystemMail } from '@/lib/mailer'
import { sendPushToUser } from '@/lib/push'
import { getConfig, setConfig, CONFIG_KEYS } from '@/lib/config'
import { isProbeEmail, isInternalEmail } from '@/lib/probe'
import { isExecEmail } from '@/lib/admin'
import { getPlan } from '@/lib/plans'

/**
 * The lifecycle machine — the follow up the funnel was missing.
 *
 * The data said it plain: 13 of 27 real humans never touched a tool, one sat at
 * the Yoco till and nothing fired, and the campaign lane never once messaged our
 * own signups. This sweep closes that gap on the transactional lane:
 *
 *   day 3   — joined 3+ days ago, never used a tool, no plan        -> one nudge
 *   day 7   — joined 7+ days ago, still never used a tool           -> one offer
 *   checkout — subscription PENDING past 20 minutes, human, no nudge -> one email
 *
 * Laws: one email per milestone EVER (EmailLog campaign tag dedupe), suppression
 * checked before every send, probes/internals/exec never touched, a mail hiccup
 * never throws. The campaign-tick heartbeat calls this hourly; ?dry=1 reports
 * who WOULD hear from us without sending a thing.
 */

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://www.hustleportal.online'
const DAY = 86_400_000
const THROTTLE_MS = 55 * 60_000 // hourly against the 5 minute heartbeat

export interface LifecycleReport {
  ran: boolean
  checked: number
  day3: string[]
  day7: string[]
  checkout: string[]
  sent: number
  skippedThrottle?: boolean
}

async function welcomeRand(): Promise<number> {
  const cents = parseInt(await getConfig(CONFIG_KEYS.WELCOME_CREDIT_CENTS)) || 9900
  return Math.round(cents / 100)
}

/** True once the human has put ANYTHING in the machine: a lead, a client, an invoice, a project, an appointment, a pool arrival, a reveal spend or a topup. */
async function userIsActive(userId: string): Promise<boolean> {
  const [leads, clients, invoices, projects, appointments, pool, spent, topups] = await Promise.all([
    db.lead.count({ where: { userId } }),
    db.client.count({ where: { userId } }),
    db.invoice.count({ where: { userId } }),
    db.project.count({ where: { userId } }),
    db.appointment.count({ where: { userId } }),
    db.clientPoolLead.count({ where: { userId } }),
    db.creditTx.count({ where: { userId, type: { not: 'BONUS' } } }),
    db.topUp.count({ where: { userId } }),
  ])
  return leads + clients + invoices + projects + appointments + pool + spent + topups > 0
}

async function isSuppressed(email: string): Promise<boolean> {
  const row = await db.suppression.findUnique({ where: { email: email.toLowerCase() }, select: { email: true } })
  return Boolean(row)
}

async function alreadySent(userId: string, tag: string): Promise<boolean> {
  const row = await db.emailLog.findFirst({ where: { userId, campaign: tag }, select: { id: true } })
  return Boolean(row)
}

function firstName(name: string): string {
  return String(name).trim().split(/\s+/)[0] || 'there'
}

async function recordSend(userId: string, to: string, subject: string, body: string, tag: string, ok: boolean, error?: string) {
  await db.emailLog.create({
    data: {
      userId, toEmail: to, subject, body,
      status: ok ? 'SENT' : 'FAILED',
      provider: 'PLATFORM',
      campaign: tag,
      sentAt: new Date(),
      ...(error ? { error: error.slice(0, 200) } : {}),
    },
  })
}

async function sendMilestone(
  user: { id: string; name: string; email: string },
  subject: string,
  body: string,
  tag: string,
  push: { title: string; body: string; url: string },
): Promise<boolean> {
  if (await alreadySent(user.id, tag)) return false
  if (await isSuppressed(user.email)) {
    await db.emailLog.create({
      data: {
        userId: user.id, toEmail: user.email, subject, body: '(not sent: suppressed)',
        status: 'SKIPPED', provider: 'PLATFORM', campaign: tag, sentAt: new Date(),
        error: 'Suppressed: bounce, complaint or unsubscribe law',
      },
    })
    return false
  }
  const res = await sendSystemMail({ to: user.email, subject, body })
  await recordSend(user.id, user.email, subject, body, tag, res.ok, res.error)
  await sendPushToUser(user.id, { ...push, tag }).catch(() => {})
  return true
}

/** The heartbeat entry point. Dry mode reports the plan without sending or writing throttle state. */
export async function runLifecycleSweep(dry = false): Promise<LifecycleReport> {
  const report: LifecycleReport = { ran: false, checked: 0, day3: [], day7: [], checkout: [], sent: 0 }
  if (!dry) {
    const last = Number((await getConfig(CONFIG_KEYS.LIFECYCLE_LAST_RUN)) || '0')
    if (last && Date.now() - last < THROTTLE_MS) return { ...report, skippedThrottle: true }
  }

  const now = Date.now()
  const humans = await db.user.findMany({
    where: {
      accountStatus: 'ACTIVE',
      createdAt: { lte: new Date(now - 3 * DAY) },
      NOT: [
        { email: { endsWith: '@hustleqa.example.com' } },
        { email: { endsWith: '@probe.local' } },
        { email: { endsWith: '@diagcheck.local' } },
        { email: { endsWith: '@testmail.co.za' } },
        { email: { endsWith: '@hustletest.co.za' } },
        { email: { endsWith: '@example.com' } },
        { email: { endsWith: '@example.org' } },
        { email: { endsWith: '@example.net' } },
        { email: { endsWith: '@mailinator.com' } },
        { email: { endsWith: '@mailinator.local' } },
        { email: { endsWith: '@test.co.za' } },
        { email: { endsWith: '@hustleportal.co.za' } },
        { email: { endsWith: '@hustleportal.online' } },
      ],
    },
    select: { id: true, name: true, email: true, createdAt: true, subscription: { select: { status: true } } },
    take: 500,
    orderBy: { createdAt: 'desc' },
  })
  const people = humans.filter((u) => !isProbeEmail(u.email) && !isInternalEmail(u.email) && !isExecEmail(u.email))
  report.checked = people.length

  const rand = await welcomeRand()

  for (const u of people) {
    const first = firstName(u.name)
    const age = now - new Date(u.createdAt).getTime()
    const subStatus = u.subscription?.status ?? null
    // A live or paused plan means onboarding nudges are noise. A PENDING sub is
    // handled by the checkout lane below, never doubled with a day 3/7 mail.
    if (subStatus === 'ACTIVE' || subStatus === 'PAUSED') continue

    const inactive = !(await userIsActive(u.id))
    if (inactive && subStatus !== 'PENDING') {
      if (age >= 7 * DAY) {
        const subject = 'One search between you and your first customers'
        const body = [
          `Hi ${first},`,
          '',
          `A week ago you joined HustlePortal and your R${rand} in lead credits is still untouched.`,
          '',
          'No pressure and no expiry. Just one question: what would five real customers',
          'around you be worth this month?',
          '',
          'Reply to this email with your city and what you sell, and we will run the',
          'first search together and send you what we find.',
          '',
          `Or do it yourself in five minutes: ${APP_ORIGIN}/?view=leads`,
          '',
          'Go get paid,',
          'The HustlePortal team',
          'Business Hustle · businesshustle.co.za',
        ].join('\n')
        const sent = dry
          ? true
          : await sendMilestone(
              u, subject, body, 'lifecycle-day7',
              { title: 'Still there?', body: 'Reply with your city and trade and we run your first lead search together.', url: `${APP_ORIGIN}/?view=leads` },
            )
        report.day7.push(u.email)
        if (sent) report.sent++
        continue
      }
      const subject = `Your R${rand} in lead credits is still waiting`
      const body = [
        `Hi ${first},`,
        '',
        'Three days ago you opened the door. Your lead credits are sitting in your',
        'wallet, and not one search has run yet.',
        '',
        'It takes five minutes: type your city, pick your trade, and reveal the real',
        'businesses around you. Every lead is checked before you pay a cent. If a',
        'lead fails the check, you are not charged.',
        '',
        `Run your first search now: ${APP_ORIGIN}/?view=leads`,
        '',
        'Stuck on anything? Just reply to this email. A human reads every reply.',
        '',
        'Go get paid,',
        'The HustlePortal team',
        'Business Hustle · businesshustle.co.za',
      ].join('\n')
      const sent = dry
        ? true
        : await sendMilestone(
            u, subject, body, 'lifecycle-day3',
            { title: 'Your lead credits are waiting', body: `Your R${rand} is untouched. One search finds real businesses around you.`, url: `${APP_ORIGIN}/?view=leads` },
          )
      report.day3.push(u.email)
      if (sent) report.sent++
    }
  }

  // The till lane: a human left a checkout unfinished. One email per attempt.
  const pending = await db.subscription.findMany({
    where: { status: 'PENDING', createdAt: { lte: new Date(now - 20 * 60_000) } },
    include: { user: { select: { id: true, name: true, email: true } } },
    take: 50,
  })
  for (const sub of pending) {
    const u = sub.user
    if (!u || isProbeEmail(u.email) || isInternalEmail(u.email) || isExecEmail(u.email)) continue
    const plan = getPlan(sub.plan)
    const planName = plan?.name || sub.plan
    const reveals = plan ? Math.round(plan.revealCredits / 1500) : 5
    const tag = `checkout-nudge-${sub.reference}`
    const subject = `Your ${planName} subscription is one step from live`
    const body = [
      `Hi ${firstName(u.name)},`,
      '',
      `Your ${planName} subscription is created and waiting. No money has left your`,
      'card yet.',
      '',
      `Finish in one tap and your ${reveals} verified lead reveals plus every tool`,
      'go live right away:',
      `${APP_ORIGIN}/?view=grow`,
      '',
      'Renewal is always a fresh checkout. You are never auto charged.',
      '',
      'Go get paid,',
      'The HustlePortal team',
      'Business Hustle · businesshustle.co.za',
    ].join('\n')
    report.checkout.push(u.email)
    const sent = dry
      ? true
      : await sendMilestone(
          u, subject, body, tag,
          { title: 'One step from live', body: 'Your subscription is waiting. No money has left your card.', url: `${APP_ORIGIN}/?view=grow` },
        )
    if (sent) report.sent++
  }

  if (!dry) await setConfig(CONFIG_KEYS.LIFECYCLE_LAST_RUN, String(Date.now()))
  report.ran = true
  return report
}
