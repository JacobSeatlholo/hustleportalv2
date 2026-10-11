import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { sendSystemMail } from '@/lib/mailer'

// POST /api/emails/test → sends a system mail to the caller's own account
// email through the EXACT path password resets use (sendSystemMail, branded
// from, no referral signature). Closes the fix loop: one tap proves the
// engine end-to-end — or surfaces the precise, actionable error.
export async function POST() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  })
  if (!user?.email) {
    return NextResponse.json({ error: 'Your account has no email address on file.' }, { status: 400 })
  }
  const r = await sendSystemMail({
    to: user.email,
    subject: 'HustlePortal engine test',
    body:
      'This is a test email from your HustlePortal.\n\n' +
      'If you are reading this, the built-in email engine is delivering from\n' +
      'noreply@hustleportal.online — the same path password resets and receipts use.\n\n' +
      "Didn't see it in your inbox? Check spam, then mark the sender as trusted.",
  })
  if (r.ok) {
    return NextResponse.json({
      ok: true,
      notice: `Test email sent to ${user.email} — check your inbox AND spam folder.`,
    })
  }
  return NextResponse.json({ ok: false, error: r.error || 'Test send failed.' }, { status: 400 })
}
