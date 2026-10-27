import { NextResponse } from 'next/server'
import { getUserId, getUser } from '@/lib/auth'
import { getMailStatus, readLastSystemSend } from '@/lib/mailer'
import { db } from '@/lib/db'
import { planState, FREE_LIMITS } from '@/lib/limits'
import { ensureWallet } from '@/lib/wallet'
import { SPEND_ACTIONS, PLAN_SEND_BUNDLES, DEFAULT_SEND_BUNDLE, SEND_BUNDLE_WINDOW_DAYS } from '@/lib/spend'

/**
 * GET /api/emails/status → one call that tells the Mail UI everything:
 * engine state, the "from" address, LIVE Resend domain-verification status,
 * whether Gmail is connected, and the AIRTIME QUOTE for the next send
 * (what it costs right now and how much allowance is left). Powers the calm
 * status line, the setup cards, and the composer's spend chip.
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

    // Airtime quote — the composer chip shows the truth BEFORE the button:
    // what a send costs right now, how much of the allowance is left, and
    // the wallet balance that stands behind it.
    let spend: {
      action: string
      priceCents: number
      mode: 'ALLOWANCE' | 'AIRTIME' | 'EMPTY'
      allowance: number
      allowanceRemaining: number
      balanceCents: number
    } | null = null
    try {
      const { paid, plan } = await planState(userId)
      const priceCents = SPEND_ACTIONS.EMAIL_SEND.cents
      const allowance = paid ? (PLAN_SEND_BUNDLES[plan] ?? DEFAULT_SEND_BUNDLE) : FREE_LIMITS.emailSends
      const windowStart = paid ? new Date(Date.now() - SEND_BUNDLE_WINDOW_DAYS * 24 * 60 * 60 * 1000) : null
      const used = await db.emailLog.count({
        where: { userId, status: 'SENT', ...(windowStart ? { createdAt: { gte: windowStart } } : {}) },
      })
      const wallet = await ensureWallet(userId)
      const allowanceRemaining = Math.max(0, allowance - used)
      const mode = allowanceRemaining > 0 ? 'ALLOWANCE' : wallet.balance >= priceCents ? 'AIRTIME' : 'EMPTY'
      spend = { action: SPEND_ACTIONS.EMAIL_SEND.key, priceCents, mode, allowance, allowanceRemaining, balanceCents: wallet.balance }
    } catch { /* the chip is cosmetic — never block the status call on it */ }

    return NextResponse.json({ status, lastSend, spend })
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
