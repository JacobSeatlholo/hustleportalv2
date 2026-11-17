import { NextRequest, NextResponse } from 'next/server'
import { getStrategist, STRATEGISTS } from '@/lib/corporate'
import { computePartnerDigest, type PartnerDigest } from '@/lib/partnerDigest'
import { sendSystemMail } from '@/lib/mailer'
import { globalCooldown } from '@/lib/ratelimit'

export const maxDuration = 60

// ============ PARTNER DIGEST — background analytics (Task 215) ============
// Kelo asked for "background analytics to monitor client onboarding". The
// partner dashboard page already answers the on-demand half; this cron is the
// background half: every Monday morning (08:00 SAST, vercel.json) each
// strategist gets their funnel numbers in the inbox, with a straight CTA into
// their gated dashboard.
//
// Auth, three ways:
//   1. Vercel Cron: `Authorization: Bearer $CRON_SECRET` (when the env is
//      configured) → digests for EVERY strategist. Without the env configured
//      the bearer is accepted too — same law as daily-reminders; the per-slug
//      cooldown below keeps a stranger's hammering honest.
//   2. The partner's own dashboard key as `?key=` → exactly ONE digest, theirs
//      (the key IS their credential). This is also the self-serve "email me my
//      numbers now" hook and the QA path.
//   3. Anything else → 401, indistinguishable from a dead route.
//
// The per-partner cooldown (10 min) bounds repeat sends no matter who calls.

function bearerOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return true // no secret configured; cooldown keeps abuse bounded
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

function rands(cents: number): string {
  return `R${Math.round(cents / 100).toLocaleString('en-ZA')}`
}

function digestBody(d: PartnerDigest): string {
  const lines = [
    `Corporate accounts opened through your door: ${d.accounts}`,
    `New this week: ${d.newAccountsWeek}`,
    `Activated — already revealing leads: ${d.activated}`,
    `Managed leads delivered, all accounts: ${d.managedLeads}`,
    `Your accrued share (R50 per managed lead): ${rands(d.shareCents)}`,
    `Top-ups this week: ${rands(d.topupsWeekCents)}`,
  ]
  if (d.closeNow.length > 0) {
    lines.push(``, `Close now — balance below one managed lead, the top-up conversation is due: ${d.closeNow.join(', ')}.`)
  }
  if (d.warming.length > 0) {
    lines.push(``, `Warming up — under three leads of credit left: ${d.warming.join(', ')}.`)
  }
  if (d.lastActivity) lines.push(``, `Most recent account activity on the platform: ${d.lastActivity} (SAST).`)
  lines.push(
    ``,
    `The full picture, live: your partner dashboard (button below).`,
    `This digest arrives every Monday morning; reply to this email for anything that needs a human.`,
  )
  return lines.join('\n')
}

async function sendOne(d: PartnerDigest, origin: string): Promise<{ emailed: boolean; emailError?: string }> {
  if (!d.contactEmail) return { emailed: false, emailError: 'no contact email configured' }
  const mail = await sendSystemMail({
    to: d.contactEmail,
    subject: `Your partner digest — ${d.accounts} account${d.accounts === 1 ? '' : 's'}, ${rands(d.shareCents)} accrued`,
    body: `Hi,\n\nYour ${d.company} funnel, live from the platform:\n\n${digestBody(d)}`,
    title: 'Client onboarding, in the background',
    headline: 'Your weekly partner digest',
    value: {
      text: `${rands(d.shareCents)} accrued at R50 per managed lead`,
      caption: `${d.accounts} account${d.accounts === 1 ? '' : 's'} through your door · ${d.activated} activated · ${d.managedLeads} managed lead${d.managedLeads === 1 ? '' : 's'} delivered`,
    },
    ctaLabel: 'Open your partner dashboard',
    ctaUrl: `${origin}${d.dashboardUrlPath}`,
    preheader: 'Your sign-ups, their credit and your accrual — Monday numbers',
  })
  return { emailed: mail.ok, emailError: mail.ok ? undefined : mail.error }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  let slugs: string[]
  if (key) {
    const partner = STRATEGISTS.find((s) => s.dashboardKey === key)
    if (!partner) return NextResponse.json({ error: 'Not found.' }, { status: 401 })
    slugs = [partner.slug]
  } else if (bearerOk(req)) {
    slugs = STRATEGISTS.map((s) => s.slug)
  } else {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const origin = `${url.protocol}//${url.host}`
  const results: Array<{ slug: string; to?: string; emailed: boolean; emailError?: string; skipped?: string; metrics?: PartnerDigest }> = []
  for (const slug of slugs) {
    const cooldown = globalCooldown(`cron:partner-digest:${slug}`, 10 * 60 * 1000)
    if (!cooldown.ran) {
      results.push({ slug, emailed: false, skipped: 'cooldown', retryAfterSec: cooldown.retryAfterSec })
      continue
    }
    const digest = await computePartnerDigest(slug)
    if (!digest) {
      results.push({ slug, emailed: false, emailError: 'unknown slug' })
      continue
    }
    const sent = await sendOne(digest, origin)
    results.push({ slug, to: digest.contactEmail, ...sent, metrics: digest })
  }
  return NextResponse.json({ ok: true, results }, { headers: { 'Cache-Control': 'no-store' } })
}
