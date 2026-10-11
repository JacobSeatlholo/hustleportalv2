/**
 * Email sending via the USER'S OWN Gmail account (SMTP with an app password).
 * Credentials live in UserSetting (set in the Integrations hub):
 *   GMAIL_USER / GMAIL_APP_PASSWORD
 * HustlePortal never sends from its own domain — it's the user's Gmail, their voice.
 */
import { db } from '@/lib/db'

export type MailCreds = { user: string; appPassword: string }

export async function getUserMailCreds(userId: string): Promise<MailCreds | null> {
  const rows = await db.userSetting.findMany({
    where: { userId, key: { in: ['GMAIL_USER', 'GMAIL_APP_PASSWORD'] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  if (!map.GMAIL_USER || !map.GMAIL_APP_PASSWORD) return null
  return { user: map.GMAIL_USER, appPassword: map.GMAIL_APP_PASSWORD }
}

export async function sendViaUserGmail(
  userId: string,
  mail: { to: string; subject: string; body: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const creds = await getUserMailCreds(userId)
  if (!creds) {
    return { ok: false, error: 'Gmail is not connected yet — add your address and app password in Integrations.' }
  }
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
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to send email' }
  }
}
