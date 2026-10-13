import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { hashPassword, createSession, verifyPassword } from '@/lib/auth'
import { ensureWallet, addCredits } from '@/lib/wallet'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import { awardXp, bumpChallenge } from '@/lib/gamification'
import { attributeSignup } from '@/lib/referral'
import { sendSystemMail, recordNoAccountReset } from '@/lib/mailer'

const RESET_TTL_MS = 30 * 60 * 1000

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'register') {
      const { email, password, name, businessName, industry, city, phone } = body
      if (!email || !password || !name) {
        return NextResponse.json({ error: 'Name, email and password are required.' }, { status: 400 })
      }
      if (String(password).length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
      }
      const normalized = String(email).toLowerCase().trim()
      const exists = await db.user.findUnique({ where: { email: normalized } })
      if (exists) {
        return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
      }
      const userCount = await db.user.count()
      const user = await db.user.create({
        data: {
          email: normalized,
          passwordHash: await hashPassword(String(password)),
          name: String(name),
          businessName: businessName || null,
          industry: industry || null,
          city: city || null,
          phone: phone || null,
          role: userCount === 0 ? 'ADMIN' : 'MEMBER',
        },
      })
      await createSession(user.id)
      await ensureWallet(user.id)
      // welcome bonus — R99 in lead credits: enough for real teaser reveals,
      // the taste that sells the R199 Operator plan
      const welcomeCents = parseInt(await getConfig(CONFIG_KEYS.WELCOME_CREDIT_CENTS)) || 9900
      if (welcomeCents > 0) {
        await addCredits(user.id, welcomeCents, 'BONUS', `Welcome bonus — R${Math.round(welcomeCents / 100)} in lead credits`)
      }
      await awardXp(user.id, 'SIGNUP', 50, 'Joined HustlePortal')
      await bumpChallenge(user.id, 'login')
      // Referral attribution (teams invite teams) — R10 to the referrer on signup.
      try {
        await attributeSignup(user.id, normalized, body.refCode)
      } catch { /* attribution must never block registration */ }
      // Welcome email — the first branded message of the relationship. Awaited
      // (serverless freezes unawaited promises after the response) but wrapped
      // so a failed send can never block registration.
      try {
        const first = String(name).trim().split(/\s+/)[0] || 'there'
        const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://hustleportal.online'
        const creditRand = Math.round(welcomeCents / 100)
        await sendSystemMail({
          to: normalized,
          subject: `Welcome${first !== 'there' ? ` ${first}` : ''}, your R${creditRand} lead credit is ready`,
          body: [
            `Hi ${first},`,
            '',
            'Welcome to HustlePortal. Your Business OS is live.',
            '',
            `Your wallet is already loaded with R${creditRand} in lead credits. That is real`,
            'finding power: open the AI Lead Finder, type your city, and reveal verified',
            "businesses around you. If a lead can't be verified, you're not charged for it.",
            'No gimmicks. Only leads that answer back.',
            '',
            'Three quick moves to make this week:',
            '',
            '1. Complete your profile. The more the AI knows about your business,',
            '   the sharper your leads and emails get. Two minutes, biggest pay-off.',
            '2. Run your first Lead Finder search. Pick your city and industry,',
            '   then reveal the businesses that fit what you sell.',
            '3. Save your best find to the pipeline. Invoices, tasks and finance',
            '   all hang off that pipeline.',
            '',
            `Start here, it drops you straight into the Lead Finder:`,
            `${base}/?view=leads`,
            '',
            'Stuck on anything? Just reply to this email. A human reads every reply.',
            '',
            'Go get paid,',
            'The HustlePortal team',
            'Business Hustle · businesshustle.co.za',
          ].join('\n'),
        })
      } catch (e) {
        console.error('[auth] welcome email failed for', normalized, e)
      }
      // Seamless teams: any pending invites for this email attach the new account
      // to those teams automatically — no "ask them to register first, then invite".
      const joinedTeams: string[] = []
      try {
        const pending = await db.teamInvite.findMany({
          where: { email: normalized, acceptedAt: null },
          include: { team: { select: { name: true } } },
        })
        for (const inv of pending) {
          const already = await db.teamMember.findUnique({
            where: { teamId_userId: { teamId: inv.teamId, userId: user.id } },
          })
          if (!already) {
            await db.teamMember.create({ data: { teamId: inv.teamId, userId: user.id, role: inv.role } })
            joinedTeams.push(inv.team.name)
          }
          await db.teamInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } })
        }
      } catch { /* team attach must never block registration */ }
      return NextResponse.json({ ok: true, joinedTeams })
    }

    if (action === 'login') {
      const { email, password } = body
      if (!email || !password) {
        return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
      }
      const user = await db.user.findUnique({ where: { email: String(email).toLowerCase().trim() } })
      if (!user || !(await verifyPassword(String(password), user.passwordHash))) {
        return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
      }
      await createSession(user.id)
      await ensureWallet(user.id)
      await bumpChallenge(user.id, 'login')
      return NextResponse.json({ ok: true })
    }

    if (action === 'forgot') {
      const email = String(body.email || '').toLowerCase().trim()
      if (!email || !email.includes('@')) {
        return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
      }
      const user = await db.user.findUnique({ where: { email } })
      if (!user) {
        // Diagnostic truth-stamp: the request happened, but no account matches —
        // the #1 cause of "the reset email never arrived". Admins see it in
        // Integrations → Mail; the requester still gets the same neutral reply.
        await recordNoAccountReset(email).catch(() => {})
      }
      if (user) {
        // Single-use token: only its sha256 is stored, 30-minute window.
        const token = crypto.randomBytes(32).toString('hex')
        await db.user.update({
          where: { id: user.id },
          data: {
            resetTokenHash: sha256(token),
            resetTokenExpiry: new Date(Date.now() + RESET_TTL_MS),
          },
        })
        const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://hustleportal.online'
        const resetUrl = `${base}/reset?token=${token}`
        const sent = await sendSystemMail({
          to: user.email,
          subject: 'Reset your HustlePortal password',
          body: [
            `Hi ${user.name || 'there'},`,
            '',
            'Someone (hopefully you) asked to reset the password for your HustlePortal account.',
            '',
            'Reset it here — the link works for 30 minutes and can be used once:',
            resetUrl,
            '',
            'If you didn\'t ask for this, ignore this email — your password stays as it was.',
            '',
            '— HustlePortal · the Business OS for South African businesses',
          ].join('\n'),
        })
        if (!sent.ok) console.error('[auth] reset email failed for', email)
      }
      // Same response whether or not the account exists — no account enumeration.
      return NextResponse.json({
        ok: true,
        message: 'If an account exists for that email, a reset link is on its way — check your inbox (and spam, just in case).',
      })
    }

    if (action === 'reset') {
      const token = String(body.token || '').trim()
      const password = String(body.password || '')
      if (!token) return NextResponse.json({ error: 'Reset link is missing its token.' }, { status: 400 })
      if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
      }
      const user = await db.user.findFirst({
        where: { resetTokenHash: sha256(token), resetTokenExpiry: { gt: new Date() } },
      })
      if (!user) {
        return NextResponse.json({ error: 'This reset link is invalid or has expired — request a fresh one.' }, { status: 400 })
      }
      await db.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(password),
          resetTokenHash: null,
          resetTokenExpiry: null,
        },
      })
      // Sign them straight in — one less step on a small screen.
      await createSession(user.id)
      await ensureWallet(user.id)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    console.error('auth error', e)
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
  }
}
