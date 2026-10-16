import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { sendMail } from '@/lib/mailer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/admin/exec/clients/welcome — the owner's welcome pass.
//
// Sends a welcome email from the OWNER's own account (ceo@businesshustle.co.za)
// to every client imported from the owner's directory domain (default
// kloofstreet.online), and logs every send in the OWNER's email log, so the
// whole pass reflects in the owner's Mail section exactly like mail they sent
// themselves. Sends go out under the owner's sending identity with Reply-To
// pointed at the owner's inbox, so every reply lands with the owner.
//
// Idempotent: anyone who already has a welcome email logged (same owner, same
// recipient, welcome subject) is reported and NEVER resent. Reruns are always
// safe — that also makes the second call a free audit of the first.
const OWNER_EMAIL = 'ceo@businesshustle.co.za'
const MARKER = 'Welcome to HustlePortal'
const MAX_SENDS_PER_CALL = 40

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://www.hustleportal.online'

// Simple english, no hype, every claim true: the Time Out nod is the street's
// own press, every feature named ships today, the free plan is really free.
function welcomeBody(business: string, email: string, ownerName: string): string {
  return [
    'Hi there,',
    '',
    `Kloof Street was voted one of the coolest streets in the world, and ${business} is part of that story. Your listing lives on KloofStreet.online. Now there is more: a HustlePortal account has been set up for ${business}, ready for you.`,
    '',
    'HustlePortal is the Business OS for South African businesses. It puts your clients, leads, invoices, tasks and money in one simple place. You see what works, you follow up faster, and you get paid sooner.',
    '',
    'Your account is ready. Set your own password in under a minute:',
    '',
    `1. Open ${APP_ORIGIN}/reset`,
    `2. Enter this email address: ${email}`,
    '3. We send you a link. Choose your password and you are in.',
    '',
    'What you can do today, free:',
    '',
    '• Keep every client and deal in one place',
    '• Send invoices and see what is still owed',
    '• Scan a business card into a lead with your phone',
    '• Let the AI draft your client emails while you work',
    '',
    'No card needed. Start free and grow at your pace.',
    '',
    'Any questions? Just reply to this email. A real person reads every reply.',
    '',
    ownerName,
    'Business Hustle',
  ].join('\n')
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({}))
  const domain = String(body.domain || 'kloofstreet.online').toLowerCase().trim().replace(/^@/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return NextResponse.json({ error: 'A valid domain is required.' }, { status: 400 })
  }

  const owner = await db.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true, email: true, name: true },
  })
  if (!owner) {
    return NextResponse.json({ error: 'The owner account is not on this platform yet.' }, { status: 500 })
  }
  const ownerName = owner.name?.trim() || 'The Business Hustle team'

  // Everyone imported from this directory domain: MEMBER accounts only, so the
  // pass can never touch exec seats or QA probes.
  const clients = await db.user.findMany({
    where: { email: { endsWith: `@${domain}` }, role: 'MEMBER' },
    select: { id: true, email: true, name: true, businessName: true },
    orderBy: { createdAt: 'asc' },
  })

  const results: Array<Record<string, unknown>> = []
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const c of clients) {
    if (sent + failed >= MAX_SENDS_PER_CALL) {
      results.push({ email: c.email, ok: true, reason: 'deferred: batch cap reached, rerun to continue' })
      continue
    }
    // One welcome per client, ever. The dedupe reads the OWNER's log, which is
    // exactly what the Mail section shows — server side truth, not a flag.
    const prior = await db.emailLog.findFirst({
      where: { userId: owner.id, toEmail: c.email, subject: { contains: MARKER } },
      select: { id: true, status: true, createdAt: true },
    })
    if (prior) {
      skipped += 1
      results.push({ email: c.email, ok: true, reason: 'already welcomed', priorStatus: prior.status, priorAt: prior.createdAt })
      continue
    }
    const business = (c.businessName || c.name || c.email.split('@')[0]).trim()
    const subject = `${MARKER}, ${business}`
    const mailBody = welcomeBody(business, c.email, ownerName)
    const r = await sendMail(owner.id, { to: c.email, subject, body: mailBody })
    await db.emailLog.create({
      data: {
        userId: owner.id,
        toEmail: c.email,
        subject,
        body: mailBody,
        status: r.ok ? 'SENT' : 'FAILED',
        provider: r.ok ? r.provider : 'NONE',
        error: r.ok ? null : r.error,
      },
    })
    if (r.ok) {
      sent += 1
      results.push({ email: c.email, ok: true, reason: 'sent', provider: r.provider, notice: r.notice || null })
    } else {
      failed += 1
      results.push({ email: c.email, ok: false, reason: r.error })
    }
  }

  return NextResponse.json(
    { ok: true, domain, owner: owner.email, total: clients.length, sent, skipped, failed, results },
    { status: 200 },
  )
}
