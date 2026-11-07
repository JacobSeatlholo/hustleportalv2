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

/**
 * The boss's edited draft, kept in PlatformConfig (runtime editable, no
 * redeploy). The stored copy is a TEMPLATE: wherever it says {firstName}, the
 * member's greeting name is substituted at send time. The verbatim copy below
 * stays in code as the original of record — the override sits on top of it and
 * a DELETE (reset) falls straight back to it.
 */
export const WINBACK_DRAFT_KEY = 'WINBACK_DRAFT_OVERRIDE'
export const WINBACK_NAME_TOKEN = '{firstName}'

export interface WinbackOverride {
  subject: string
  body: string
  savedAt: string
}

/** The saved override, or null when the boss never edited (or reset) the draft. */
export async function readWinbackOverride(): Promise<WinbackOverride | null> {
  try {
    const row = await db.platformConfig.findUnique({ where: { key: WINBACK_DRAFT_KEY } })
    if (!row?.value) return null
    const v = JSON.parse(row.value) as { subject?: unknown; body?: unknown; savedAt?: unknown }
    if (typeof v.subject !== 'string' || typeof v.body !== 'string') return null
    if (!v.subject.trim() || !v.body.trim()) return null
    return { subject: v.subject, body: v.body, savedAt: typeof v.savedAt === 'string' ? v.savedAt : '' }
  } catch {
    return null
  }
}

/** Persist the boss's edited draft. Validation lives in the exec route; this
 *  is the one write, so read and send always agree on the shape. */
export async function saveWinbackOverride(subject: string, body: string): Promise<WinbackOverride> {
  const savedAt = new Date().toISOString()
  const value = JSON.stringify({ subject, body, savedAt })
  await db.platformConfig.upsert({
    where: { key: WINBACK_DRAFT_KEY },
    create: { key: WINBACK_DRAFT_KEY, value },
    update: { value },
  })
  return { subject, body, savedAt }
}

/** Back to the verbatim copy in code. */
export async function clearWinbackOverride(): Promise<void> {
  await db.platformConfig.deleteMany({ where: { key: WINBACK_DRAFT_KEY } })
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
 * The win-back email for ONE member: the boss's edited draft when he has saved
 * one, otherwise his verbatim rewrite carried word for word (Nov 7). One
 * phrase link on HustlePortal renders as a real anchor in html and flattens to
 * "HustlePortal (https://...)" in plain text. The override's {firstName} tokens
 * become the member's greeting name; a token the boss chose to leave out stays
 * out — his copy, his call. Dash free, no fake urgency, no made up numbers.
 * The legal footer is appended by the platform send path itself.
 */
export function renderWinbackEmail(
  user: { name: string; businessName: string | null },
  override: WinbackOverride | null,
): WinbackDraft {
  const hi = firstName(user.name, user.businessName)
  if (override) {
    return {
      subject: override.subject.split(WINBACK_NAME_TOKEN).join(hi),
      body: override.body.split(WINBACK_NAME_TOKEN).join(hi),
    }
  }
  return {
    subject: `It has been a while, ${hi}. Come and see what is new`,
    body: [
      `Hi ${hi},`,
      '',
      'You checked out HustlePortal a while back. Quite a bit has changed since then.',
      '',
      "The original idea remains the same: one login for everything you need to run your business. But the platform has grown considerably, and we'd like you to see what's new.",
      '',
      'First, the lead engine.',
      '',
      'Instead of spending hours searching for potential customers, you can now put [HustlePortal](https://www.hustleportal.online) to work.',
      '',
      "Tell it who you're looking for. For example: medical practices in Johannesburg that need contract cleaning.",
      '',
      'It searches business directories and maps, filters out irrelevant results, checks available contact information and websites, and brings matching businesses straight into your sales pipeline.',
      '',
      "Here's the best part:",
      '',
      '25 free searches per day. No credit card required.',
      '',
      'R0 for empty searches. If a search returns nothing, you pay nothing.',
      '',
      'R15 per verified lead when you want to unlock its contact details.',
      '',
      '50 cents per email delivered to a real inbox.',
      '',
      "And that's just the beginning.",
      '',
      'Your entire business workflow now lives in one place.',
      '',
      'Tasks & Projects: Organise jobs, assign due dates and keep track of everything with a monthly calendar.',
      '',
      'Sales Pipeline: Move prospects from New to Won, with notes and activity attached to every lead.',
      '',
      'Quotes & Invoices: Create, manage and update your business documents without the administrative headache.',
      '',
      'Team Collaboration: Tag teammates in tasks and send updates directly to their inboxes.',
      '',
      'No more jumping between disconnected tools just to keep your business moving.',
      '',
      "Your data stays yours. We don't sell or share it. And you can explore the free plan without entering payment details or committing to anything.",
      '',
      "Come see what we've been building:",
      '',
      'https://www.hustleportal.online',
      '',
      'Already have an account? Simply log in and pick up where you left off.',
      '',
      "Found something broken? Have an idea? Something you don't like? Just reply to this email. It goes straight to our team. We're building this to be genuinely useful, and your feedback helps us get there.",
      '',
      'Good to have you back.',
      '',
      'The HustlePortal Team',
    ].join('\n'),
  }
}

/** Convenience wrapper: reads the saved override itself. The exec routes read
 *  it once and call renderWinbackEmail directly, so a batch never re-reads. */
export async function buildWinbackEmail(user: { name: string; businessName: string | null }): Promise<WinbackDraft> {
  return renderWinbackEmail(user, await readWinbackOverride())
}

/** Newest activity timestamp per user across the everyday tables. */
async function latestActivityByUser(): Promise<Map<string, Date>> {
  const [leads, invoices, poolRows, projects, mails, credits] = await Promise.all([
    db.lead.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.invoice.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.clientPoolLead.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.project.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    db.emailLog.groupBy({
      by: ['userId'],
      _max: { createdAt: true },
      // Mail we sent TO a member is not the member working the app: winback
      // rows must never reset the quiet clock (the engine would blind itself
      // to exactly the people it exists to reach), and a staged DRAFT is not
      // work either. The member's own sends still count.
      where: {
        AND: [
          { status: { not: 'DRAFT' } },
          { OR: [{ campaign: null }, { campaign: { not: { startsWith: 'winback-' } } }] },
        ],
      },
    }),
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
