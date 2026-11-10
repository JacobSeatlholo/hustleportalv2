import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { sendSystemMail } from '@/lib/mailer'
import { getConfig, setConfig } from '@/lib/config'
import { PLAN_SEND_BUNDLES } from '@/lib/spend'

// One-shot door (Task 146/181 precedent): exists ONLY so the platform can send
// member Kabir Singh the "what changed on your account" notification the boss
// ordered live on their call (Task 184). Two tokens:
//   READ token → dry run: returns the member facts + the EXACT copy that would
//                go out. Sends nothing, writes nothing.
//   SEND token → single use: sends that copy via sendSystemMail (platform
//                engine, branded from, no pixel, reply-to team inbox) and locks
//                itself with a platformConfig marker so it can never send twice.
// Deleted in the same task once the send lands; the token lives only in the path.

const READ_TOKEN = 'aa72225e3e58fc156b03aae93b77677fb59fae9ac5209351'
const SEND_TOKEN = 'ffd4ec47b6008c1a99100699a6bd167550eeebe0f8afa0e1'
const MARKER_KEY = 'member_changes_email_kabir_2026_11'

type Ctx = { params: Promise<{ token: string }> }

async function findKabir() {
  return db.user.findFirst({
    where: {
      platformAdmin: false,
      OR: [
        { name: { contains: 'kabir', mode: 'insensitive' } },
        { businessName: { contains: 'kabir', mode: 'insensitive' } },
        { email: { contains: 'kabir', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, email: true, name: true, businessName: true, city: true, createdAt: true,
      projects: { select: { name: true }, orderBy: { createdAt: 'asc' } },
      subscription: {
        select: { plan: true, status: true, billingCycle: true, amountCents: true, startedAt: true, renewsAt: true },
      },
    },
  })
}

function buildMail(user: NonNullable<Awaited<ReturnType<typeof findKabir>>>) {
  const firstName = (user.name || 'there').trim().split(/\s+/)[0]
  const sub = user.subscription || null
  const plan = sub?.plan && sub.plan !== 'FREE' ? sub.plan : null
  const roster = Array.from(new Set([user.businessName, ...user.projects.map((p) => p.name)].filter((n): n is string => !!n && n.trim().length > 0)))
  const rosterLine = roster.length ? roster.join(', ') : ''
  const bundle = plan ? (PLAN_SEND_BUNDLES[plan] ?? 150) : null

  const subject = 'New on your account: campaigns, read receipts and who you send as'
  const preheader = 'Begin a campaign, see when emails are read, and always choose who you send as.'
  const body = [
    `Hi ${firstName},`,
    '',
    `Good news. Your HustlePortal account was upgraded, and today three new tools went live on it. Here is what they do and where to find them.`,
    '',
    `1. CAMPAIGNS`,
    `Open Mail and you will see a new card with a Begin campaign button. Pick the contacts you already keep in HustlePortal, or paste a list of addresses. Write one email, choose a look, and press Start when you are ready. Nothing sends until you press Start.${bundle ? ` Your plan includes ${bundle} emails every 30 days, and if you ever go past that the app shows you the exact airtime cost before anything goes out.` : ''}`,
    '',
    `2. WHO YOU SEND AS`,
    `Every email you write now starts with a question: who is this from? A Sending from selector lists the names on your account${rosterLine ? ` (${rosterLine})` : ''} and shows the exact name and address your contact will see in their inbox, before you press send. Replies still come straight back to your email. You told us how important this is, so now the choice is always in your hands.`,
    '',
    `3. READ RECEIPTS`,
    `Your mail log now shows when an email was opened, and how many times. It rides on emails sent from your HustlePortal addresses, right next to every send. No more guessing about the follow up call: the green read badge tells you when they saw it.`,
    '',
    `Log in and open your Mail section. Begin campaign is waiting for you.`,
    '',
    `If anything looks off, just reply to this email. A human reads it.`,
    '',
    `The HustlePortal team`,
  ].join('\n')

  return {
    to: user.email,
    subject,
    preheader,
    body,
    headline: 'MEMBER NEWS',
    title: 'Your account just got three new tools',
    value: {
      text: 'Campaigns, read receipts and your sending name are live on your account today.',
      caption: 'Open your Mail section and they are right there.',
    },
    ctaLabel: 'Open HustlePortal',
    ctaUrl: 'https://hustleportal.online',
    mascot: 'thumbs' as const,
  }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params

  if (token === READ_TOKEN) {
    const user = await findKabir()
    if (!user) return Response.json({ found: false })
    const mail = buildMail(user)
    return Response.json({
      found: true,
      facts: {
        email: user.email, name: user.name, businessName: user.businessName, city: user.city,
        memberSince: user.createdAt,
        subscription: user.subscription || null,
        projects: user.projects.map((p) => p.name),
      },
      wouldSend: mail,
    })
  }

  if (token === SEND_TOKEN) {
    const user = await findKabir()
    if (!user) return Response.json({ ok: false, error: 'recipient not found, nothing sent' }, { status: 500 })
    const prior = await getConfig(MARKER_KEY)
    if (prior) {
      return Response.json({ ok: true, alreadySent: true, marker: prior, skipped: true })
    }
    const mail = buildMail(user)
    const result = await sendSystemMail(mail)
    if (result.ok) {
      await setConfig(MARKER_KEY, JSON.stringify({ to: user.email, at: new Date().toISOString(), subject: mail.subject }))
    }
    return Response.json({ ok: result.ok, error: result.error ?? null, sentTo: user.email, subject: mail.subject })
  }

  return new Response('not found', { status: 404 })
}
