import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { normalizeCampaignFrom, isSesConfigured } from '@/lib/mailer'
import {
  readCampaignStates, writeCampaignState, unsubscribeUrl, type CampaignState,
} from '@/lib/campaignqueue'
import { systemBlastAudience, fillMergeTags } from '@/lib/audience'

/**
 * Campaign queues, the bulk path for outreach at real volume.
 *
 * POST   create a queue (recipients are staged as QUEUED rows; NOTHING sends
 *        until the operator presses Start, the draft gate is structural)
 * GET    every campaign with its queue state and honest counters
 * PATCH  start / pause / resume / cancel a queue, or removeRow to pull ONE
 *        queued email out of the list with a click
 *
 * Rows reuse EmailLog (status QUEUED | SENT | FAILED | BOUNCED | SKIPPED) so
 * the read receipts, open tracking and pipeline moves all keep working.
 *
 * Audience: `leads` (pipeline ids, same access wall as every lead action),
 * `emails` (raw pasted addresses) and `audience: 'system'` (every real
 * account on the platform under the audience law in src/lib/audience.ts:
 * the kloofstreet.online crew, internal seats, suspended and suppressed
 * addresses never enter; paying subscribers stay out unless skipPaying is
 * false). `personalize: true` fills {name} and {email} per recipient from
 * their account, so one draft greets every person by their own name.
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

  let payload: {
    campaign?: string; subject?: string; body?: string; from?: string; perHour?: number; provider?: string
    leads?: string[]; emails?: string[]; audience?: string; skipPaying?: boolean; personalize?: boolean
  }
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
  // The whole platform, one tap: the audience law lives in one lib, the same
  // law the preview readout shows, so the counted number is the queued number.
  if (payload.audience === 'system') {
    const { rows } = await systemBlastAudience({ skipPaying: payload.skipPaying !== false })
    for (const r of rows) {
      if (!wanted.has(r.email)) wanted.set(r.email, { email: r.email, leadId: null })
    }
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

  // One draft, greeted per person: when the draft carries {name} / {email},
  // every queued row gets its own filled copy. The merge resolves from the
  // account itself (first name, then business name), unknown addresses fall
  // back to a plain honest "there" so nothing reads like a broken template.
  const personal = payload.personalize === true
  const namesByEmail = new Map<string, string>()
  if (personal && toQueue.length > 0) {
    const accounts = await db.user.findMany({
      where: { email: { in: toQueue.map((r) => r.email) } },
      select: { email: true, name: true, businessName: true },
    })
    for (const u of accounts) {
      const first = (u.name || '').trim().split(/\s+/)[0]
      namesByEmail.set(u.email.toLowerCase(), first || (u.businessName || '').trim() || 'there')
    }
  }

  await db.emailLog.createMany({
    data: toQueue.map((r) => {
      const nm = namesByEmail.get(r.email) || 'there'
      return {
        userId: gate.me.id,
        toEmail: r.email,
        subject: (personal ? fillMergeTags(subject, nm, r.email) : subject).slice(0, 180),
        body: (personal ? fillMergeTags(body, nm, r.email) : body).slice(0, 4000),
        status: 'QUEUED',
        provider: 'PLATFORM',
        campaign: tag,
        leadId: r.leadId,
      }
    }),
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
    personalized: personal && toQueue.length > 0,
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

  let payload: { campaign?: string; action?: string; rowId?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const tag = slugTag(payload.campaign)
  const action = payload.action || ''

  // One click, one email out of the queue. The row is never deleted: it flips
  // to SKIPPED with an honest note, so the archive still shows it existed and
  // the engine simply never sends it. Sent mail stays untouchable — history
  // does not get rewritten after the fact.
  if (action === 'removeRow') {
    const rowId = String(payload.rowId || '')
    if (!rowId) return NextResponse.json({ error: 'rowId is required.' }, { status: 400 })
    const row = await db.emailLog.findUnique({ where: { id: rowId }, select: { id: true, campaign: true, status: true, toEmail: true } })
    if (!row || row.campaign !== tag) {
      return NextResponse.json({ error: 'That email is not part of this campaign.' }, { status: 404 })
    }
    if (row.status !== 'QUEUED') {
      return NextResponse.json({ error: 'Only queued emails can be removed — this one has already left the queue.' }, { status: 400 })
    }
    await db.emailLog.update({
      where: { id: row.id },
      data: { status: 'SKIPPED', error: `Removed by operator · ${new Date().toISOString().slice(0, 10)}` },
    })
    const [queued, sent, failed, bounced, skipped] = await Promise.all([
      db.emailLog.count({ where: { campaign: tag, status: 'QUEUED' } }),
      db.emailLog.count({ where: { campaign: tag, status: 'SENT' } }),
      db.emailLog.count({ where: { campaign: tag, status: 'FAILED' } }),
      db.emailLog.count({ where: { campaign: tag, status: 'BOUNCED' } }),
      db.emailLog.count({ where: { campaign: tag, status: 'SKIPPED' } }),
    ])
    return NextResponse.json({
      ok: true,
      removed: row.toEmail,
      summary: { queued, sent, failed, bounced, skipped, opened: 0, total: queued + sent + failed + bounced + skipped },
    })
  }

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

  return NextResponse.json({ error: 'Unknown action. Use start, pause, cancel or removeRow.' }, { status: 400 })
}
