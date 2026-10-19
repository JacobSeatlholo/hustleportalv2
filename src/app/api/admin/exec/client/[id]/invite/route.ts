import { NextRequest, NextResponse } from 'next/server'
import { isExecUser, requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { sendSystemMail } from '@/lib/mailer'
import { createHash, randomBytes } from 'node:crypto'

type Ctx = { params: Promise<{ id: string }> }

const INVITE_TTL_MS = 24 * 60 * 60 * 1000

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex')
}

function cleanEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

/**
 * POST /api/admin/exec/client/[id]/invite — point a member account at their
 * real inbox and send the system invitation that gets them to sign in.
 *
 * Body: { email?: string } — pass an email to move the account's login email
 * first (the old one stops working), or omit it to re-send the invitation to
 * the email already on the account.
 *
 * The invitation carries a single use set password link (24 hour window) that
 * reuses the platform's reset machinery, so the member signs in, lands on
 * their pipeline and nothing about the master account or exec seats changes.
 *
 * Guard rails: exec gate, exec and admin accounts can never be re pointed,
 * email uniqueness, and the lead count line in the invitation is only sent
 * when it is true.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const target = await db.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, businessName: true, role: true,
      platformAdmin: true, accountStatus: true, _count: { select: { leads: true } },
    },
  })
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
  if (isExecUser(target)) {
    return NextResponse.json({ error: 'Admin and executive accounts cannot be re pointed or invited this way.' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  let emailChanged = false
  let email = target.email

  const wanted = cleanEmail(body?.email)
  if (wanted) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wanted)) {
      return NextResponse.json({ error: 'That email does not look right.' }, { status: 400 })
    }
    if (wanted !== target.email.toLowerCase()) {
      const clash = await db.user.findUnique({ where: { email: wanted }, select: { id: true } })
      if (clash && clash.id !== id) {
        return NextResponse.json({ error: 'Another account already uses that email.' }, { status: 409 })
      }
      await db.user.update({
        where: { id },
        data: { email: wanted, resetTokenHash: null, resetTokenExpiry: null },
      })
      email = wanted
      emailChanged = true
    }
  }

  // Single use invite token, only its sha256 is stored. The existing reset
  // endpoint validates it and signs the member straight in after they set a
  // password, so one link takes them from zero to inside their pipeline.
  const raw = randomBytes(32).toString('hex')
  await db.user.update({
    where: { id },
    data: { resetTokenHash: sha256(raw), resetTokenExpiry: new Date(Date.now() + INVITE_TTL_MS) },
  })

  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://hustleportal.online'
  const inviteUrl = `${base}/reset?token=${raw}`

  const first = (target.name || '').trim().split(' ')[0] || 'there'
  const business = target.businessName || 'your business'
  const leadCount = target._count.leads
  const leadsLine =
    leadCount > 0
      ? `The Business Hustle team has hand picked ${leadCount} verified ${leadCount === 1 ? 'lead' : 'leads'} for you. They are waiting in your pipeline right now.`
      : 'Sign in to meet your dashboard, your pipeline and every tool inside.'

  const sent = await sendSystemMail({
    to: email,
    subject: `Your HustlePortal account is ready${first !== 'there' ? `, ${first}` : ''}`,
    body: [
      `Hi ${first},`,
      '',
      `Your HustlePortal account for ${business} is live and ready.`,
      '',
      leadsLine,
      '',
      'Set your password and sign in with this link if it is your first time, or use it to get back in. It works for 24 hours and can be used once:',
      inviteUrl,
      '',
      `Your login email is ${email}. Keep it handy for every sign in.`,
      '',
      'The sooner you sign in, the sooner the pipeline starts working for you.',
      '',
      'HustlePortal · the Business OS for South African businesses',
    ].join('\n'),
  })

  return NextResponse.json({
    ok: true,
    client: { id, email, accountStatus: target.accountStatus },
    emailChanged,
    inviteSent: sent.ok,
    ...(sent.ok ? {} : { inviteError: sent.error || 'The invitation email failed to send.' }),
    inviteWindowHours: 24,
    leads: leadCount,
    message: emailChanged
      ? `Login email moved to ${email}. ${sent.ok ? `Invitation email sent — ${first} can set a password and sign in.` : 'The invitation email failed to send — check the mail engine.'}`
      : `Email unchanged. ${sent.ok ? 'Invitation email sent again.' : 'The invitation email failed to send — check the mail engine.'}`,
  })
}
