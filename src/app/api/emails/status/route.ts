import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { getMailStatus } from '@/lib/mailer'

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
    return NextResponse.json({ status })
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
