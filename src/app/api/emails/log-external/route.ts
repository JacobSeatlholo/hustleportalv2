import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { matchLead } from '@/lib/leadMatch'
import { MAX_BODY_CHARS } from '@/lib/mailinbound'

// ============ LOG AN EXTERNAL EMAIL (manual capture, no CC needed) ============
//
// The honest Today-door for mail sent from outside the portal (the old
// ceo@ box on the legacy domain, a personal Gmail): paste what was sent, and
// the log carries it. This is also the fallback when the CC pipeline misses
// an address. Rows are LOGGED, provider EXTERNAL — they record real mail the
// sender really sent; the platform never charges airtime for them and the
// engine never sends from them. The From address must belong to the account
// (login email or a connected alias) — the log stays honest about whose name
// the email wore.

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // A human logging mail by hand never hits 120 in an hour.
  const gate = rateLimit(`emails:log:${userId}`, 120, 60 * 60 * 1000)
  if (!gate.ok) return NextResponse.json(tooMany(gate.retryAfterSec), { status: 429 })

  const body = await req.json().catch(() => ({}))
  const to = String(body.to || '').trim()
  const cc = String(body.cc || '').trim()
  const subject = String(body.subject || '').trim() || '(no subject)'
  const mailBody = String(body.body || '').trim()
  const fromEmail = String(body.fromEmail || '').trim().toLowerCase()

  if (!to || !to.includes('@')) return NextResponse.json({ error: 'A valid recipient email is required.' }, { status: 400 })
  if (!mailBody) return NextResponse.json({ error: 'The email body is required — paste what you sent.' }, { status: 400 })

  // Whose name did the email wear? Only addresses this account really owns:
  // the login email or one of its connected aliases. Anything else is a lie
  // in the log, and the log does not lie.
  const me = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let from = me.email.toLowerCase()
  if (fromEmail && fromEmail !== from) {
    const alias = await db.emailAlias.findUnique({ where: { address: fromEmail }, select: { userId: true } })
    if (!alias || alias.userId !== userId) {
      return NextResponse.json(
        { error: 'That sending address is not connected to your account. Connect it first (the "From" list) — the log only records mail you actually own.' },
        { status: 400 },
      )
    }
    from = fromEmail
  }

  // When did it go out? A past moment is history; anything beyond a day
  // ahead is not a sent email, it is a scheduling fantasy.
  let sentAt = new Date()
  if (typeof body.sentAt === 'string' && body.sentAt) {
    const d = new Date(body.sentAt)
    if (!isNaN(d.getTime())) {
      if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        return NextResponse.json({ error: 'Sent-on date is in the future.' }, { status: 400 })
      }
      sentAt = d
    }
  }

  // If the recipient is already a pipeline contact, the record carries the
  // relationship (exact email, ONE match — never a guess).
  let leadId: string | null = null
  try {
    const m = await matchLead(userId, to, null)
    if (m.kind === 'ONE') leadId = m.lead.id
  } catch { /* linking is a bonus */ }

  const email = await db.emailLog.create({
    data: {
      userId,
      leadId,
      direction: 'OUT',
      status: 'LOGGED',
      provider: 'EXTERNAL',
      fromEmail: from,
      toEmail: to,
      ccEmail: cc || null,
      subject,
      body: mailBody.length > MAX_BODY_CHARS ? `${mailBody.slice(0, MAX_BODY_CHARS)}… [truncated]` : mailBody,
      sentAt,
    },
  })

  return NextResponse.json({ email, leadLinked: Boolean(leadId) })
}
