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
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to send email' }
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
      return { ok: false, error: `Email service error ${res.status}: ${detail}` }
    }
    return { ok: true, provider: 'PLATFORM' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to send email' }
  }
}

/**
 * One-call send used by /api/emails.
 * Tries the user's own Gmail first (their voice); falls back to platform sending.
 */
export async function sendMail(
  userId: string,
  mail: { to: string; subject: string; body: string },
): Promise<{ ok: true; provider: 'GMAIL' | 'PLATFORM' } | { ok: false; error: string }> {
  const signature = await buildSignature(userId)
  const payload = { ...mail, body: mail.body + signature }
  const creds = await getUserMailCreds(userId)
  if (creds) {
    const r = await sendViaUserGmail(creds, payload)
    if (r.ok) return r
    // their Gmail failed — fall through to platform so the send still happens
    const fb = await sendViaPlatform(userId, payload)
    if (fb.ok) return fb
    return { ok: false, error: `Gmail: ${r.error}` }
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
