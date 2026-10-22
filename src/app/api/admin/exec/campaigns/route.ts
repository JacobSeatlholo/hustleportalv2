import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { normalizeCampaignFrom, isSesConfigured } from '@/lib/mailer'
import {
  readCampaignStates, writeCampaignState, unsubscribeUrl, type CampaignState,
} from '@/lib/campaignqueue'

/**
 * Campaign queues, the bulk path for outreach at real volume.
 *
 * POST   create a queue (recipients are staged as QUEUED rows; NOTHING sends
 *        until the operator presses Start, the draft gate is structural)
 * GET    every campaign with its queue state and honest counters
 * PATCH  start / pause / resume / cancel a queue
 *
 * Rows reuse EmailLog (status QUEUED | SENT | FAILED | BOUNCED | SKIPPED) so
 * the read receipts, open tracking and pipeline moves all keep working.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_QUEUE = 5000
const MAX_HOURLY = 600
const DEFAULT_HOURLY = 45

function slugTag(raw?: string): string {
  const s = (raw || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return s || 'campaign'
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let payload: { campaign?: string; subject?: string; body?: string; from?: string; perHour?: number; provider?: string; leads?: string[]; emails?: string[] }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tag = slugTag(payload.campaign)
  const subject = payload.subject?.trim() || ''
  const body = payload.body || ''
  if (!subject) return NextResponse.json({ error: 'Subject is required.' }, { status: 400 })
  if (body.trim().length < 20) return NextResponse.json({ error: 'Body is required.' }, { status: 400 })

  // A second batch joining a running campaign keeps the pace the operator
  // already chose, omitting perHour in the payload must never reset it.
  const states0 = await readCampaignStates()
  const existingState = states0[tag]
  const perHour = payload.perHour == null
    ? Math.max(1, Math.min(MAX_HOURLY, existingState?.perHour || DEFAULT_HOURLY))
    : Math.max(1, Math.min(MAX_HOURLY, Math.round(Number(payload.perHour) || DEFAULT_HOURLY)))
  const from = normalizeCampaignFrom(payload.from)

  // The transport lane. Omitted provider keeps the pace-preservation promise:
  // a second batch joining a live campaign never switches its pipe silently.
  const provider: 'RESEND' | 'SES' =
    payload.provider === 'SES' ? 'SES'
    : payload.provider === 'RESEND' ? 'RESEND'
    : existingState?.provider || 'RESEND'
  if (provider === 'SES' && !isSesConfigured()) {
    return NextResponse.json({ error: 'SES lane is not configured yet. Add the SES API keys to the environment first, or use the free lane.' }, { status: 400 })
  }

  // Recipients from pipeline leads, same access wall as every lead action.
  const leadIds = Array.isArray(payload.leads) ? payload.leads.filter((x) => typeof x === 'string' && x.length > 5) : []
  const memberships = await db.teamMember.findMany({ where: { userId: gate.me.id }, select: { teamId: true } })
  const teamIds = memberships.map((m) => m.teamId)
  const wanted = new Map<string, { email: string; leadId: string | null }>()
  if (leadIds.length > 0) {
    const leads = await db.lead.findMany({
      where: { id: { in: leadIds }, OR: [{ userId: gate.me.id }, { teamId: { in: teamIds } }] },
      select: { id: true, email: true },
    })
    for (const l of leads) {
      const email = l.email?.trim().toLowerCase()
      if (email && EMAIL_RE.test(email)) wanted.set(email, { email, leadId: l.id })
    }
  }
  // Raw pasted addresses, honest about the ones that never stood a chance.
  const invalid: string[] = []
  for (const raw of Array.isArray(payload.emails) ? payload.emails : []) {
    const email = String(raw || '').trim().toLowerCase()
    if (!email) continue
    if (!EMAIL_RE.test(email)) {
      invalid.push(email.slice(0, 120))
      continue
    }
    if (!wanted.has(email)) wanted.set(email, { email, leadId: null })
  }

  if (wanted.size === 0) {
    return NextResponse.json({ error: 'No valid recipients. Unlock contacts in Leads first, or paste addresses.' }, { status: 400 })
  }
  if (wanted.size > MAX_QUEUE) {
    return NextResponse.json({ error: `That is ${wanted.size} recipients. One queue carries at most ${MAX_QUEUE}.` }, { status: 400 })
  }

  const emails = [...wanted.keys()]
  const [suppressedRows, existingRows] = await Promise.all([
    db.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    db.emailLog.findMany({ where: { campaign: tag, toEmail: { in: emails }, status: { in: ['QUEUED', 'SENT'] } }, select: { toEmail: true } }),
  ])
  const suppressed = new Set(suppressedRows.map((r) => r.email))
  const already = new Set(existingRows.map((r) => r.toEmail))

  const toQueue = emails
    .filter((e) => !suppressed.has(e) && !already.has(e))
    .map((e) => ({ email: e, leadId: wanted.get(e)!.leadId }))

  if (toQueue.length === 0) {
    return NextResponse.json({
      ok: true,
      campaign: tag,
      queued: 0,
      skippedSuppressed: suppressedRows.filter((r) => !already.has(r.email)).length,
      skippedDuplicate: existingRows.length,
      invalid,
      note: 'Nothing new to queue, everyone on this list already has a send or a strike against them.',
    })
  }

  await db.emailLog.createMany({
    data: toQueue.map((r) => ({
      userId: gate.me.id,
      toEmail: r.email,
      subject: subject.slice(0, 180),
      body: body.slice(0, 4000),
      status: 'QUEUED',
      provider: 'PLATFORM',
      campaign: tag,
      leadId: r.leadId,
    })),
  })

  // Queues are born PAUSED. The draft gate lives in the structure of the thing:
  // nothing can move until Start is pressed by a human who saw the draft.
  const existing: CampaignState = existingState || {
    status: 'PAUSED',
    perHour,
    from,
    createdAt: new Date().toISOString(),
  }
  await writeCampaignState(tag, { ...existing, perHour, from, provider })

  return NextResponse.json({
    ok: true,
    campaign: tag,
    queued: toQueue.length,
    skippedSuppressed: suppressedRows.filter((r) => !already.has(r.email)).length,
    skippedDuplicate: existingRows.length,
    invalid,
    state: { ...existing, perHour, from, provider },
  })
}

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const [rows, states] = await Promise.all([
    db.emailLog.findMany({
      where: { campaign: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true, campaign: true, toEmail: true, subject: true, status: true, error: true,
        openedAt: true, openCount: true, sentAt: true, createdAt: true,
        lead: { select: { id: true, company: true, stage: true } },
      },
    }),
    readCampaignStates(),
  ])

  // Signed unsubscribe link per row, exec eyes only. The link every
  // recipient actually gets is baked into their email at send time.
  const rowsOut = rows.map((r) => ({ ...r, unsubUrl: unsubscribeUrl(r.id) }))

  const campaigns: Record<string, { queued: number; sent: number; failed: number; bounced: number; skipped: number; opened: number; total: number }> = {}
  for (const row of rows) {
    const tag = row.campaign as string
    const c = (campaigns[tag] ||= { queued: 0, sent: 0, failed: 0, bounced: 0, skipped: 0, opened: 0, total: 0 })
    c.total++
    if (row.status === 'QUEUED') c.queued++
    if (row.status === 'SENT') c.sent++
    if (row.status === 'FAILED') c.failed++
    if (row.status === 'BOUNCED') c.bounced++
    if (row.status === 'SKIPPED') c.skipped++
    if (row.openedAt) c.opened++
  }

  return NextResponse.json({
    ok: true,
    sesConfigured: isSesConfigured(),
    campaigns: Object.keys(campaigns).map((tag) => ({ tag, state: states[tag] || null, summary: campaigns[tag] })),
    rows: rowsOut,
  })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let payload: { campaign?: string; action?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const tag = slugTag(payload.campaign)
  const action = payload.action || ''

  const states = await readCampaignStates()
  const current: CampaignState = states[tag] || {
    status: 'PAUSED',
    perHour: DEFAULT_HOURLY,
    createdAt: new Date().toISOString(),
  }

  if (action === 'start' || action === 'resume') {
    const queued = await db.emailLog.count({ where: { campaign: tag, status: 'QUEUED' } })
    if (queued === 0) {
      return NextResponse.json({ error: 'Nothing queued under this campaign. Create a queue first.' }, { status: 400 })
    }
    const next: CampaignState = { ...current, status: 'ACTIVE', startedAt: current.startedAt || new Date().toISOString() }
    await writeCampaignState(tag, next)
    return NextResponse.json({ ok: true, campaign: tag, state: next })
  }

  if (action === 'pause') {
    const next: CampaignState = { ...current, status: 'PAUSED' }
    await writeCampaignState(tag, next)
    return NextResponse.json({ ok: true, campaign: tag, state: next })
  }

  if (action === 'cancel') {
    const stopped = await db.emailLog.updateMany({
      where: { campaign: tag, status: 'QUEUED' },
      data: { status: 'SKIPPED', error: 'Cancelled by operator' },
    })
    const next: CampaignState = { ...current, status: 'CANCELLED', completedAt: new Date().toISOString() }
    await writeCampaignState(tag, next)
    return NextResponse.json({ ok: true, campaign: tag, state: next, stopped: stopped.count })
  }

  return NextResponse.json({ error: 'Unknown action. Use start, pause or cancel.' }, { status: 400 })
}
