/**
 * Email sending — PLUG & PLAY.
 * Resolution order:
 *   1. USER'S OWN Gmail (optional, Integrations hub) — their voice, replies land in their inbox.
 *      Skipped automatically for 10 minutes after an auth failure (circuit breaker) so one
 *      bad password never blocks sends.
 *   2. PLATFORM sending via Resend (server env RESEND_API_KEY) — works for everyone, zero setup.
 *      Sends from the branded address (noreply@hustleportal.online) and falls back to the
 *      Resend test sender while the domain is still verifying — no RESEND_FROM env needed.
 *      Replies go to the user's account email via Reply-To.
 * HustlePortal never forces users to create app passwords or OAuth grants.
 */
import { db } from '@/lib/db'
import { ensureRefCode } from '@/lib/referral'

/**
 * Distribution engine: every email sent through HustlePortal carries a branded
 * signature with the SENDER's referral link. Mail is the product's biggest
 * organic surface — each client touch recruits the next member.
 */
async function buildSignature(userId: string): Promise<string> {
  try {
    const code = await ensureRefCode(userId)
    return `\n\n— Sent with HustlePortal · the Business OS for South African businesses\nOutsell, outlast, outperform. Start free: https://hustleportal.online/?ref=${code}`
  } catch {
    return '\n\n— Sent with HustlePortal · hustleportal.online'
  }
}

export type MailCreds = { user: string; appPassword: string }

export type MailSendResult =
  | { ok: true; provider: 'GMAIL' | 'PLATFORM'; notice?: string }
  | { ok: false; error: string }

/** Branded sender — works the moment hustleportal.online verifies in Resend. */
const BRANDED_FROM = 'HustlePortal <noreply@hustleportal.online>'
/** Resend's test sender — delivers to the account's own inbox while the domain verifies. */
const SANDBOX_FROM = 'HustlePortal <onboarding@resend.dev>'

/** The domain sends are labelled from (RESEND_FROM wins if the operator set one). */
export function sendingDomain(): string {
  const from = process.env.RESEND_FROM?.trim()
  const m = from?.match(/<[^>]*@([^>]+)>|@([\w.-]+)\s*$/)
  return (m && (m[1] || m[2])) || 'hustleportal.online'
}

// ---------------------------------------------------------------- status

export type MailDomainRow = { name: string; status: string }
export type MailStatus = {
  platformConfigured: boolean
  fromAddress: string
  sendingDomain: string
  domainStatus: 'verified' | 'pending' | 'not_started' | 'failed' | 'unknown'
  domains: MailDomainRow[]
  gmailConfigured: boolean
}

let domainCache: { at: number; rows: MailDomainRow[] } | null = null
const DOMAIN_TTL_MS = 60_000

async function fetchResendDomains(apiKey: string): Promise<MailDomainRow[]> {
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return domainCache?.rows || []
    const json = (await res.json()) as { data?: { name?: string; status?: string }[] }
    const rows = (json.data || [])
      .filter((d) => d.name)
      .map((d) => ({ name: d.name as string, status: d.status || 'unknown' }))
    domainCache = { at: Date.now(), rows }
    return rows
  } catch {
    return domainCache?.rows || []
  }
}

/** One-call status for the Mail UI — engine state, sender address, live Resend domain verification. */
export async function getMailStatus(userId: string): Promise<MailStatus> {
  const apiKey = process.env.RESEND_API_KEY?.trim() || ''
  const rows = apiKey ? await fetchResendDomains(apiKey) : []
  const domain = sendingDomain()
  const own = rows.find((r) => r.name === domain)
  const status: MailStatus['domainStatus'] = own
    ? (own.status as MailStatus['domainStatus'])
    : rows.some((r) => r.status === 'verified')
      ? 'verified'
      : rows.length
        ? 'pending'
        : 'unknown'
  const creds = await getUserMailCreds(userId)
  return {
    platformConfigured: !!apiKey,
    fromAddress: process.env.RESEND_FROM?.trim() || BRANDED_FROM,
    sendingDomain: domain,
    domainStatus: status,
    domains: rows,
    gmailConfigured: !!creds,
  }
}

// ------------------------------------------------------- gmail circuit breaker

/** After an auth rejection, stop retrying Gmail for 10 min — platform engine takes over. */
const gmailBlockedUntil = new Map<string, number>()
const GMAIL_COOLDOWN_MS = 10 * 60_000

export function flagGmailFailure(userId: string): void {
  gmailBlockedUntil.set(userId, Date.now() + GMAIL_COOLDOWN_MS)
}
export function clearGmailFailure(userId: string): void {
  gmailBlockedUntil.delete(userId)
}
function gmailOnCooldown(userId: string): boolean {
  const until = gmailBlockedUntil.get(userId) || 0
  if (until && Date.now() >= until) {
    gmailBlockedUntil.delete(userId)
    return false
  }
  return until > 0
}

/** Trim Google SMTP's debug wall to one readable line. */
function firstLine(s: string): string {
  const cut = s.split(/https:\/\/|\s-\s+gsmtp|\n/)[0].trim()
  return (cut || s.trim()).slice(0, 180)
}

/** Auth-class Gmail failure (normal password instead of an App Password, etc.). */
const GMAIL_AUTH_RE = /535|BadCredentials|Username and Password not accepted|Invalid login|EAUTH/i
export function isGmailAuthError(msg: string): boolean {
  return GMAIL_AUTH_RE.test(msg)
}

/**
 * Translate raw SMTP/transport failures into one actionable line.
 * The classic case: 535 BadCredentials — Gmail refuses NORMAL passwords for
 * sending; only App Passwords work (2-Step Verification required).
 */
export function classifyGmailError(msg: string): string {
  if (GMAIL_AUTH_RE.test(msg)) {
    return 'Gmail rejected your login — it needs an App Password, not your normal password. Integrations → Gmail → Test connection walks you through it in about a minute.'
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|socket|timeout/i.test(msg)) {
    return 'Could not reach Gmail\'s mail servers from here — check this deployment\'s outbound network, or remove your Gmail under Integrations to let the HustlePortal engine send instead.'
  }
  return `Gmail rejected the send: ${firstLine(msg)}`
}

/** Resend's sandbox restricts sends until the sender domain is verified. */
function classifyPlatformError(msg: string): string {
  const domain = sendingDomain()
  if (/testing emails|only send.*own email|403/i.test(msg)) {
    return `${domain} is still verifying in Resend — until it completes, sends can only reach your own account inbox. Nothing to configure: it opens up automatically the moment you hit Verify at resend.com/domains.`
  }
  if (/422|"from"|validation/i.test(msg)) {
    return `The sending address isn't accepted yet — ${domain} must finish verifying at resend.com/domains (DNS can take up to a few hours).`
  }
  return `HustlePortal engine error: ${firstLine(msg)}`
}

export async function getUserMailCreds(userId: string): Promise<MailCreds | null> {
  const rows = await db.userSetting.findMany({
    where: { userId, key: { in: ['GMAIL_USER', 'GMAIL_APP_PASSWORD'] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  if (!map.GMAIL_USER || !map.GMAIL_APP_PASSWORD) return null
  return { user: map.GMAIL_USER, appPassword: map.GMAIL_APP_PASSWORD }
}

async function sendViaUserGmail(
  creds: MailCreds,
  mail: { to: string; subject: string; body: string },
): Promise<{ ok: true; provider: 'GMAIL' } | { ok: false; error: string }> {
  try {
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: creds.user, pass: creds.appPassword },
    })
    await transport.sendMail({
      from: `"HustlePortal" <${creds.user}>`,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
    })
    return { ok: true, provider: 'GMAIL' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to send email'
    return { ok: false, error: classifyGmailError(msg) }
  }
}

async function resendSend(
  apiKey: string,
  from: string,
  userId: string,
  mail: { to: string; subject: string; body: string },
): Promise<{ ok: true } | { ok: false; raw: string }> {
  // Reply-To the sender's real account so client responses reach THEM
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.body,
        ...(user?.email ? { reply_to: user.email } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      return { ok: false, raw: `Email service error ${res.status}: ${detail}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, raw: e instanceof Error ? e.message : 'Failed to send email' }
  }
}

/**
 * Platform engine, zero-config:
 *   attempt 1 → branded from (noreply@hustleportal.online) — works once the domain verifies;
 *   attempt 2 → Resend test sender — keeps own-inbox delivery working while DNS is pending.
 * No RESEND_FROM env var is ever required.
 */
async function sendViaPlatform(
  userId: string,
  mail: { to: string; subject: string; body: string },
): Promise<{ ok: true; provider: 'PLATFORM'; viaFallback?: boolean } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Email is not switched on yet — HustlePortal mail is warming up. Try again soon, or connect your Gmail under Integrations to send from your own address.',
    }
  }
  const branded = process.env.RESEND_FROM?.trim() || BRANDED_FROM
  const first = await resendSend(apiKey, branded, userId, mail)
  if (first.ok) return { ok: true, provider: 'PLATFORM' }
  // From-domain rejection (unverified) → retry once with the test sender
  if (/from|domain|verif|422|403/i.test(first.raw)) {
    const second = await resendSend(apiKey, SANDBOX_FROM, userId, mail)
    if (second.ok) return { ok: true, provider: 'PLATFORM', viaFallback: true }
    return { ok: false, error: classifyPlatformError(second.raw) }
  }
  return { ok: false, error: classifyPlatformError(first.raw) }
}

/**
 * One-call send used by /api/emails.
 * Tries the user's own Gmail first (their voice) — unless it just failed auth
 * (10-min circuit breaker). Falls back to the platform engine so the send still
 * happens, and says so honestly via `notice`. When BOTH fail, the error names
 * the two causes + their fixes.
 */
export async function sendMail(
  userId: string,
  mail: { to: string; subject: string; body: string },
): Promise<MailSendResult> {
  const signature = await buildSignature(userId)
  const payload = { ...mail, body: mail.body + signature }
  const creds = await getUserMailCreds(userId)
  if (creds && !gmailOnCooldown(userId)) {
    const r = await sendViaUserGmail(creds, payload)
    if (r.ok) {
      clearGmailFailure(userId)
      return r
    }
    if (isGmailAuthError(r.error)) flagGmailFailure(userId)
    // their Gmail failed — fall through to platform so the send still happens
    const fb = await sendViaPlatform(userId, payload)
    if (fb.ok) {
      return {
        ok: true,
        provider: 'PLATFORM',
        notice: fb.viaFallback
          ? 'Sent via HustlePortal\'s test sender — your Gmail login was rejected AND the sending domain is still verifying, so replies route to your account email. Both fixes are one-tap: Integrations (Gmail) + resend.com/domains.'
          : 'Sent via the HustlePortal engine — your Gmail login was rejected, so replies route to your account email. Fix it in about a minute under Integrations → Test Gmail connection.',
      }
    }
    return {
      ok: false,
      error: `${r.error}\n\nThe HustlePortal engine couldn't take over either: ${fb.error}`,
    }
  }
  const fb = await sendViaPlatform(userId, payload)
  if (fb.ok && creds && fb.viaFallback) {
    return { ...fb, notice: 'Sent via HustlePortal\'s test sender — your Gmail login is cooling down and the sending domain is still verifying, so this reached only your own account inbox. Both fixes: Integrations (Gmail) + resend.com/domains.' }
  }
  return fb
}

/** The Business Hustle team inbox (service requests land here). Override with TEAM_INBOX_EMAIL env. */
export const TEAM_INBOX = process.env.TEAM_INBOX_EMAIL?.trim() || 'team@businesshustle.co.za'

/**
 * Internal team notification (e.g. service requests) — platform delivery only,
 * NO referral signature, Reply-To the requesting user so the team can answer
 * straight from their inbox.
 */
export async function sendTeamMail(
  userId: string,
  mail: { subject: string; body: string },
): Promise<{ ok: true; provider: 'PLATFORM'; to: string } | { ok: false; error: string; to: string }> {
  const r = await sendViaPlatform(userId, { to: TEAM_INBOX, subject: mail.subject, body: mail.body })
  if (r.ok) return { ...r, to: TEAM_INBOX }
  return { ok: false, error: r.error, to: TEAM_INBOX }
}
