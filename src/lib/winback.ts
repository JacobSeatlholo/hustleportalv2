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

export const WINBACK_CAMPAIGN = 'winback-2026-11'
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
    subject: `It has been a while, ${hi}. Come and see what is new`,
    body: [
      `Hi ${hi},`,
      '',
      'You checked in a while back and I wanted you to know the app has moved since then. The idea never changed, one login for the whole hustle, but the tools got a lot better.',
      '',
      'Here is what is new. The lead engine now hunts the internet for you. Tell it who your customer is, something like medical practices in Johannesburg that need contract cleaning, and it goes through directories and maps, throws out anything that has nothing to do with your trade, checks the phone numbers and websites, and drops the good ones in your pipeline. The free plan gives you 25 searches a day, and a search that comes back empty costs you nothing. When you want the contact details of a verified lead it is R15, and 50 cents lands an email in a real inbox.',
      '',
      'The rest of the app grew around that. A board for your jobs and tasks with due dates and a calendar for the month. A pipeline that moves every lead from New to Won with notes attached. Invoices and quotes you can fix with a click. And if you work with a team, you can tag each other inside a task and it lands in their inbox.',
      '',
      'Your data stays yours, never sold, never shared. The free plan needs no card, so nothing here is a gamble.',
      '',
      'Log in and have a look: https://www.hustleportal.online',
      '',
      'Something broken or something you hate? Reply to this mail and it comes straight to the team. We would rather hear it from you than lose you quietly.',
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
