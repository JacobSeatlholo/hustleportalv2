/**
 * Win-back engine: find the members who went quiet and bring them home.
 *
 * The login stamp (User.lastLoginAt, set on every createSession) is the primary
 * signal. Accounts that last logged in before the stamp shipped have no value,
 * so the audience falls back to their latest everyday activity rows (leads,
 * invoices, pool arrivals, projects, sent mail). Whatever the newest signal is,
 * a member counts as quiet only when it is older than the quiet window. A member
 * who has been working the app inside a long-lived session (no fresh login, but
 * fresh activity) is NOT quiet and never gets a "we miss you" mail.
 *
 * The audience excludes: suspended accounts, probe/QA seats, house internal
 * accounts, the exec seats, and everyone on the Suppression list (that list is
 * law for anything leaving the platform).
 */
import { db } from '@/lib/db'
import { isProbeEmail, isInternalEmail } from '@/lib/probe'
import { isExecEmail } from '@/lib/admin'

export const WINBACK_CAMPAIGN = 'winback-2026-10'
export const WINBACK_QUIET_DAYS = 7
const QUIET_MS = WINBACK_QUIET_DAYS * 86_400_000
/** Hard ceiling per run: a first send is small, this is a runaway brake. */
export const WINBACK_MAX_PER_RUN = 300

export interface WinbackMember {
  id: string
  name: string
  businessName: string | null
  email: string
  city: string | null
  lastActivityAt: string | null
  daysQuiet: number | null
  loginKnown: boolean
}

export interface WinbackDraft {
  subject: string
  body: string
}

/** First name for the greeting, falls back through business name to "there". */
function firstName(name: string, businessName: string | null): string {
  const n = (name || '').trim().split(/\s+/)[0]
  if (n && n.length > 1 && n.toLowerCase() !== 'there') return n
  const b = (businessName || '').trim().split(/\s+/)[0]
  if (b) return b
  return 'there'
}

/**
 * The win-back email, in the boss's voice. Dash free, no fake urgency, no made
 * up numbers. The legal footer is appended by the platform send path itself.
 */
export function buildWinbackEmail(user: { name: string; businessName: string | null }): WinbackDraft {
  const hi = firstName(user.name, user.businessName)
  return {
    subject: `We have been busy, ${hi}. Come and see`,
    body: [
      `Hi ${hi},`,
      '',
      'It has been a while since you were last in the app, and HustlePortal has grown since then. New muscle, same idea: one login, everything your business needs to find work and get paid. Here is what is waiting for you:',
      '',
      '1. The project management system. A board for your jobs and tasks, due dates, reminders, and a calendar that shows your whole month at a glance. Move a card and your week makes sense again.',
      '',
      '2. The lead pipeline. Every lead moves from New to Won with notes, follow ups and next steps attached, so nothing slips and you always know what to chase today.',
      '',
      '3. Lead search that hunts the internet for you. Describe your customer, say "medical practices in Johannesburg that need contract cleaning" or "tattoo studios that buy supplies", and the engine goes through business directories and maps, scores every result against your trade, verifies phone numbers and websites, and drops the good ones straight into your pipeline. It got a lot smarter recently: leads that have nothing to do with your trade are thrown out before you ever see them.',
      '',
      'How we work: you bring the hustle, we build the tools. Your leads, your clients, your invoices and your data live in one place and belong to you, never sold, never shared. The free plan costs nothing, needs no card, and everything above works on it.',
      '',
      'Log in and have a look: https://www.hustleportal.online',
      '',
      'Something broken, or something you hate? Reply to this email and it comes straight to the team. We would rather hear it from you than lose you quietly.',
      '',
      'The HustlePortal team',
    ].join('\n'),
  }
}

/** Newest activity timestamp per user across the everyday tables. */
async function latestActivityByUser(): Promise<Map<string, Date>> {
  const [leads, invoices, poolRows, projects, mails, credits] = await Promise.all([
    db.lead.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.invoice.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.clientPoolLead.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.project.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.emailLog.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.creditTx.groupBy({ by: ['userId'], _max: { createdAt: true } }),
  ])
  const latest = new Map<string, Date>()
  for (const row of [...leads, ...invoices, ...poolRows, ...projects, ...mails, ...credits]) {
    const at = row._max.createdAt
    if (!at) continue
    const prev = latest.get(row.userId)
    if (!prev || at > prev) latest.set(row.userId, at)
  }
  return latest
}

/**
 * The quiet list, computed fresh on every call. Members are already sorted by
 * days quiet, longest absence first.
 */
export async function getWinbackAudience(): Promise<WinbackMember[]> {
  const cutoff = new Date(Date.now() - QUIET_MS)
  const [users, activity, suppressed] = await Promise.all([
    db.user.findMany({
      where: { accountStatus: 'ACTIVE' },
      select: { id: true, name: true, businessName: true, email: true, city: true, lastLoginAt: true, createdAt: true },
    }),
    latestActivityByUser(),
    db.suppression.findMany({ select: { email: true } }),
  ])
  const dead = new Set(suppressed.map((r) => r.email.toLowerCase().trim()))
  const now = Date.now()
  const out: WinbackMember[] = []
  for (const u of users) {
    const email = u.email.toLowerCase().trim()
    if (dead.has(email)) continue // bounced, complained or unsubscribed: the list is law
    if (isProbeEmail(email) || isInternalEmail(email) || isExecEmail(email)) continue
    const activityAt = activity.get(u.id) || null
    // The newest truth wins: a fresh login counts even when the tables are empty,
    // fresh work inside an old session counts even when the stamp is missing.
    const candidates = [u.lastLoginAt, activityAt, u.createdAt].filter((d): d is Date => !!d)
    if (candidates.length === 0) continue
    const last = candidates.reduce((a, b) => (a > b ? a : b))
    if (last.getTime() >= cutoff.getTime()) continue // active, leave them alone
    out.push({
      id: u.id,
      name: u.name,
      businessName: u.businessName,
      email: u.email,
      city: u.city,
      lastActivityAt: last.toISOString(),
      daysQuiet: Math.max(1, Math.floor((now - last.getTime()) / 86_400_000)),
      loginKnown: !!u.lastLoginAt,
    })
  }
  out.sort((a, b) => (b.daysQuiet ?? 0) - (a.daysQuiet ?? 0))
  return out
}

/** Emails already sent for this campaign, so a re-run never double sends. */
export async function alreadySentThisCampaign(): Promise<Set<string>> {
  const rows = await db.emailLog.findMany({
    where: { campaign: WINBACK_CAMPAIGN, status: { in: ['SENT', 'QUEUED'] } },
    select: { toEmail: true },
  })
  return new Set(rows.map((r) => r.toEmail.toLowerCase().trim()))
}
