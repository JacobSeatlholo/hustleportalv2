import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { normalizeCampaignFrom, isSesConfigured } from '@/lib/mailer'
import { readCampaignStates, writeCampaignState, type CampaignState } from '@/lib/campaignqueue'
import { fillMergeTags } from '@/lib/audience'
import { tokenizeDraft } from '@/lib/campaignpersonal'

/**
 * Abandoned checkouts, the exec follow-up lane.
 *
 * Every Yoco checkout creates a PENDING TopUp row the moment it opens; if the
 * payment never completes, the row sits there PENDING forever — that IS the
 * abandoned-checkout list, no new table needed.
 *
 * GET   the PENDING TopUps (30+ minutes old, so a payer mid-card-entry is not
 *       mistaken for an abandoner), with the account owner's email, the amount
 *       and the age. Plus a 30-day PAID sidecount for context.
 * POST  queue the follow-up blast: stages every abandoned address as QUEUED
 *       rows under campaign `abandoned-cart-<month>`, born PAUSED. These are
 *       real accounts, so {name} merge tags fill properly here. Suppression
 *       and per-tag dedupe laws hold. Nothing sends until Start is pressed.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const INFLIGHT_MINUTES = 30
const MAX_QUEUE = 5000

const DEFAULT_SUBJECT = 'Your top-up is still open — nothing was charged'
const DEFAULT_BODY = `Hi {name},

Quick one — you started loading your HustlePortal wallet and the checkout never finished. No money left your card.

Two doors, your pick:

• Finish the top-up — your credits land the moment you pay: HustlePortal Wallet (https://www.hustleportal.online)
• Or just log in and keep working — the free tools stay open either way: HustlePortal (https://www.hustleportal.online)

If the card gave you trouble, reply to this email and a human will sort it out by hand.

The Business Hustle team`

function monthTag(d = new Date()): string {
  return `abandoned-cart-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const cutoff = new Date(Date.now() - INFLIGHT_MINUTES * 60_000)
  const [pending, inflight, paid30d] = await Promise.all([
    db.topUp.findMany({
      where: { status: 'PENDING', createdAt: { lte: cutoff } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true, userId: true, packageId: true, amountCents: true, creditCents: true,
        reference: true, createdAt: true,
        user: { select: { email: true, name: true, businessName: true } },
      },
    }),
    db.topUp.count({ where: { status: 'PENDING', createdAt: { gt: cutoff } } }),
    db.topUp.count({ where: { status: 'PAID', paidAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ])

  // Which addresses are already queued/sent under the current month's tag, so
  // the readout is honest about what a blast would actually add.
  const tag = monthTag()
  const existing = await db.emailLog.findMany({
    where: { campaign: tag, toEmail: { in: pending.map((p) => p.user.email) }, status: { in: ['QUEUED', 'SENT'] } },
    select: { toEmail: true },
  })
  const already = new Set(existing.map((e) => e.toEmail))

  return NextResponse.json({
    ok: true,
    campaignTag: tag,
    inflight: inflight,
    paidLast30d: paid30d,
    abandoned: pending.map((p) => ({
      id: p.id,
      email: p.user.email,
      name: p.user.name || p.user.businessName || '',
      amountRands: p.amountCents / 100,
      creditRands: p.creditCents / 100,
      packageId: p.packageId,
      reference: p.reference,
      ageHours: Math.round((Date.now() - p.createdAt.getTime()) / 3_600_000),
      alreadyQueued: already.has(p.user.email),
    })),
    alreadyQueuedCount: pending.filter((p) => already.has(p.user.email)).length,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let payload: { subject?: string; body?: string; from?: string; perHour?: number; theme?: string; provider?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tag = monthTag()
  // The greeting law rides here too: a flattened salutation in the operator's
  // draft ("Hi Michael") is re-tokenized to {first_name} before the per-row
  // fill, so one name can never spread to every abandoned-checkout row.
  const draftSrc = tokenizeDraft(payload.subject?.trim() || DEFAULT_SUBJECT, payload.body || DEFAULT_BODY)
  const subject = draftSrc.subject
  const body = draftSrc.body
  if (body.trim().length < 20) return NextResponse.json({ error: 'Body is required.' }, { status: 400 })

  const cutoff = new Date(Date.now() - INFLIGHT_MINUTES * 60_000)
  const pending = await db.topUp.findMany({
    where: { status: 'PENDING', createdAt: { lte: cutoff } },
    select: { user: { select: { email: true, name: true, businessName: true } } },
  })

  const wanted = new Map<string, string>()
  for (const p of pending) {
    const email = p.user.email.trim().toLowerCase()
    if (email && EMAIL_RE.test(email) && !wanted.has(email)) {
      wanted.set(email, (p.user.name || '').trim().split(/\s+/)[0] || (p.user.businessName || '').trim() || 'there')
    }
  }
  if (wanted.size === 0) {
    return NextResponse.json({ ok: true, campaign: tag, queued: 0, note: 'No abandoned checkouts to follow up — the list is empty.' })
  }
  if (wanted.size > MAX_QUEUE) {
    return NextResponse.json({ error: `That is ${wanted.size} recipients; one queue carries at most ${MAX_QUEUE}.` }, { status: 400 })
  }

  const emails = [...wanted.keys()]
  const [suppressedRows, existingRows] = await Promise.all([
    db.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    db.emailLog.findMany({ where: { campaign: tag, toEmail: { in: emails }, status: { in: ['QUEUED', 'SENT'] } }, select: { toEmail: true } }),
  ])
  const suppressed = new Set(suppressedRows.map((r) => r.email))
  const already = new Set(existingRows.map((r) => r.toEmail))
  const toQueue = emails.filter((e) => !suppressed.has(e) && !already.has(e))

  if (toQueue.length === 0) {
    return NextResponse.json({
      ok: true, campaign: tag, queued: 0,
      skippedSuppressed: suppressedRows.length, skippedDuplicate: existingRows.length,
      note: 'Everyone on the abandoned list already has a follow-up queued or sent, or is suppressed.',
    })
  }

  await db.emailLog.createMany({
    data: toQueue.map((e) => ({
      userId: gate.me.id,
      toEmail: e,
      subject: fillMergeTags(subject, wanted.get(e)!, e).slice(0, 180),
      body: fillMergeTags(body, wanted.get(e)!, e).slice(0, 4000),
      status: 'QUEUED',
      provider: 'PLATFORM',
      campaign: tag,
    })),
  })

  const states = await readCampaignStates()
  const existingState: CampaignState | undefined = states[tag]
  const perHour = payload.perHour == null
    ? Math.max(1, Math.min(600, existingState?.perHour || 45))
    : Math.max(1, Math.min(600, Math.round(Number(payload.perHour) || 45)))
  const from = normalizeCampaignFrom(payload.from)
  const provider: 'RESEND' | 'SES' =
    payload.provider === 'SES' ? 'SES' : payload.provider === 'RESEND' ? 'RESEND' : existingState?.provider || 'RESEND'
  if (provider === 'SES' && !isSesConfigured()) {
    return NextResponse.json({ error: 'SES lane is not configured yet; re-queue without the SES lane.' }, { status: 400 })
  }

  const state: CampaignState = existingState || {
    status: 'PAUSED',
    perHour,
    from,
    createdAt: new Date().toISOString(),
  }
  state.perHour = perHour
  state.from = from
  state.provider = provider
  if (payload.theme) state.theme = String(payload.theme)
  await writeCampaignState(tag, state)

  return NextResponse.json({
    ok: true,
    campaign: tag,
    queued: toQueue.length,
    personalized: true,
    skippedSuppressed: suppressedRows.filter((r) => !already.has(r.email)).length,
    skippedDuplicate: existingRows.length,
    state,
    note: 'Rows are QUEUED, campaign born PAUSED. Edit the draft on the campaign card, then press Start.',
  })
}
