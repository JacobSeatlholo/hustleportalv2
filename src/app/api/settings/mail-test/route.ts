import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { getUserMailCreds, classifyGmailError } from '@/lib/mailer'

export const maxDuration = 30

/**
 * POST /api/settings/mail-test → SMTP handshake against the SAVED Gmail creds.
 * Verifies the login without sending an email — instant feedback for the
 * App Password loop (normal passwords fail here exactly like a real send).
 */
export async function POST() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creds = await getUserMailCreds(userId)
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: 'No Gmail connection saved yet — add your Gmail address and app password above.' },
      { status: 400 }
    )
  }

  try {
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: creds.user, pass: creds.appPassword },
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
    })
    await transport.verify()
    try { transport.close() } catch {}
    return NextResponse.json({
      ok: true,
      message: `Gmail connection verified for ${creds.user} — sends from your address will work.`,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to reach Gmail'
    return NextResponse.json({ ok: false, error: classifyGmailError(msg) }, { status: 400 })
  }
}
