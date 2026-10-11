/**
 * Email sending — PLUG & PLAY.
 * Resolution order:
 *   1. USER'S OWN Gmail (optional, Integrations hub) — their voice, replies land in their inbox.
 *   2. PLATFORM sending via Resend (server env RESEND_API_KEY) — works for everyone, zero setup.
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

/** Trim Google SMTP's debug wall to one readable line. */
function firstLine(s: string): string {
  const cut = s.split(/https:\/\/|\s-\s+gsmtp|\n/)[0].trim()
  return (cut || s.trim()).slice(0, 180)
}

/**
 * Translate raw SMTP/transport failures into one actionable line.
 * The classic case: 535 BadCredentials — Gmail refuses NORMAL passwords for
 * sending; only App Passwords work (2-Step Verification required).
 */
export function classifyGmailError(msg: string): string {
  if (/535|BadCredentials|Username and Password not accepted|Invalid login|EAUTH/i.test(msg)) {
    return 'Google rejected your Gmail login. Gmail blocks normal passwords for sending — use an App Password: turn on 2-Step Verification (myaccount.google.com/security), create one at myaccount.google.com/apppasswords, and paste it under Integrations → Gmail app password (no spaces).'
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|socket|timeout/i.test(msg)) {
    return 'Could not reach Gmail\'s mail servers from here — check this deployment\'s outbound network, or remove your Gmail under Integrations to let the HustlePortal engine send instead.'
  }
  return `Gmail rejected the send: ${firstLine(msg)}`
}

/** Resend's sandbox restricts sends until the sender domain is verified. */
function classifyPlatformError(msg: string): string {
  if (/testing emails|only send.*own email|403/i.test(msg)) {
    return 'The HustlePortal engine is in Resend\'s sandbox until the sender domain is verified — it can only deliver to your own account email right now. Operator: verify businesshustle.co.za at resend.com/domains and set RESEND_FROM.'
  }
  if (/422|"from"|validation/i.test(msg)) {
    return 'The HustlePortal engine\'s sender address is not accepted yet — operator must verify the sending domain at resend.com/domains.'
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

async function sendViaPlatform(
  userId: string,
  mail: { to: string; subject: string; body: string },
): Promise<{ ok: true; provider: 'PLATFORM' } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Email is not switched on yet — HustlePortal mail is warming up. Try again soon, or connect your Gmail under Integrations to send from your own address.',
    }
  }
  const from = process.env.RESEND_FROM?.trim() || 'HustlePortal <onboarding@resend.dev>'
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
      return { ok: false, error: classifyPlatformError(`Email service error ${res.status}: ${detail}`) }
    }
    return { ok: true, provider: 'PLATFORM' }
  } catch (e) {
    return { ok: false, error: classifyPlatformError(e instanceof Error ? e.message : 'Failed to send email') }
  }
}

/**
 * One-call send used by /api/emails.
 * Tries the user's own Gmail first (their voice); if Gmail is rejected it falls
 * back to the platform engine so the send still happens — and says so honestly
 * via `notice`. When BOTH fail, the error names the two causes + their fixes.
 */
export async function sendMail(
  userId: string,
  mail: { to: string; subject: string; body: string },
): Promise<MailSendResult> {
  const signature = await buildSignature(userId)
  const payload = { ...mail, body: mail.body + signature }
  const creds = await getUserMailCreds(userId)
  if (creds) {
    const r = await sendViaUserGmail(creds, payload)
    if (r.ok) return r
    // their Gmail failed — fall through to platform so the send still happens
    const fb = await sendViaPlatform(userId, payload)
    if (fb.ok) {
      return {
        ok: true,
        provider: 'PLATFORM',
        notice: `Sent via the HustlePortal engine — your Gmail login was rejected, so replies route to your account email. Fix it under Integrations (App Password).`,
      }
    }
    return {
      ok: false,
      error: `${r.error}\n\nAlso tried the HustlePortal engine: ${fb.error}`,
    }
  }
  return sendViaPlatform(userId, payload)
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
