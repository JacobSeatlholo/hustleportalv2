import { NextResponse } from 'next/server'
import { getUserId, getUser } from '@/lib/auth'
import { getMailStatus, readLastSystemSend } from '@/lib/mailer'

/**
 * GET /api/emails/status → one call that tells the Mail UI everything:
 * engine state, the "from" address, LIVE Resend domain-verification status,
 * and whether Gmail is connected. Powers the calm status line + setup cards.
 */
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const status = await getMailStatus(userId)
    // The last system send is a PLATFORM-wide record (reset emails name their
    // recipient). Admins get it for diagnostics; regular users don't need
    // another user's email address on their screen.
    const me = await getUser()
    const lastSend = me?.role === 'ADMIN' ? await readLastSystemSend() : null
    return NextResponse.json({ status, lastSend })
  } catch {
    // Never block the Mail screen on a status hiccup
    return NextResponse.json({
      status: {
        platformConfigured: !!process.env.RESEND_API_KEY?.trim(),
        fromAddress: 'HustlePortal <noreply@hustleportal.online>',
        sendingDomain: 'hustleportal.online',
        domainStatus: 'unknown',
        domains: [],
        gmailConfigured: false,
      },
    })
  }
}
