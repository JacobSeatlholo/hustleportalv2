import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { isSesConfigured, userSendingIdentity, identityFromLabel } from '@/lib/mailer'
import { planState, FREE_LIMITS } from '@/lib/limits'
import { SPEND_ACTIONS, PLAN_SEND_BUNDLES, DEFAULT_SEND_BUNDLE, SEND_BUNDLE_WINDOW_DAYS } from '@/lib/spend'
import { ensureWallet } from '@/lib/wallet'
import {
  readCampaignStates, writeCampaignState, unsubscribeUrl,
  type CampaignState,
} from '@/lib/campaignqueue'

/**
 * Member campaign queues — the upgraded-account door to batch outreach.
 *
 * The rule the boss set on a live call: the campaign section shows up once a
 * user has upgraded, their mail section carries a Begin campaign option, and
 * they never see (or pick) the transport lane — the engine prefers the SES
 * lane when it is wired and falls back to the free lane silently. Replies
 * always land in THEIR inbox, and the sender is always a profile THEY own.
 *
 *   POST   build a queue (rows QUEUED, born PAUSED — nothing sends until the
 *          member presses Start on the card)
 *   GET    their campaigns with honest counters + read receipts
 *   PATCH  start / pause / cancel / removeRow / editDraft (their own queues)
 *
 * Rows reuse EmailLog, so open tracking, read receipts, suppression and the
 * pipeline moves all keep working exactly as they do for exec blasts. The
 * airtime law rides in tickCampaigns (bundle free, beyond it airtime, debit
 * only after the send actually went out).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_QUEUE = 2000
const MAX_HOURLY = 120
const DEFAULT_HOURLY = 45
const THEMES = ['boardroom', 'goldrush', 'nightshift', 'plain']

function slugTag(raw?: string): string {
  const s = (raw || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return s || 'campaign'
}

async function requireUpgraded() {
  const userId = await getUserId()
  if (!userId) return { ok: false as const, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { paid, plan } = await planState(userId)
  if (!paid) {
    return {
      ok: false as const,
      res: NextResponse.json(
        {
          error: 'Campaigns are part of the paid plans. Upgrade and Begin campaign opens — your pipeline contacts, your letter, paced like a human.',
          upgrade: true,
          feature: 'campaigns',
        },
        { status: 402 },
      ),
    }
  }
  return { ok: true as const, userId, plan, paid }
}

/** The sender a member campaign leaves from: a profile THEY own, or the
 *  account identity when the pick is missing/foreign (never a guess). */
async function resolveSender(userId: string, projectId?: string) {
  if (projectId) {
    const picked = await db.project.findFirst({ where: { id: projectId, userId }, select: { name: true } })
    if (picked) return { ...identityFromLabel(picked.name), projectId }
  }
  const identity = await userSendingIdentity(userId)
  return { ...identity, projectId: undefined }
}

export async function POST(req: NextRequest) {
  const gate = await requireUpgraded()
  if (!gate.ok) return gate.res
  const userId = gate.userId

  let payload: {
    campaign?: string; subject?: string; body?: string; theme?: string; perHour?: number; fromProfile?: string
    leads?: string[]; emails?: string[]; personalize?: boolean
  }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const subject = payload.subject?.trim() || ''
  const body = payload.body || ''
  if (!subject) return NextResponse.json({ error: 'Subject is required.' }, { status: 400 })
  if (body.trim().length < 20) return NextResponse.json({ error: 'Write the message first — a real letter is at least 20 characters.' }, { status: 400 })

  // Member campaign tags live in their own namespace (u- prefix) so they can
  // never collide with an exec blast or another member's queue.
  const tag = `u-${slugTag(payload.campaign)}`.slice(0, 60)
  const states0 = await readCampaignStates()
  const existingState = states0[tag]
  // One name, one owner: an existing tag on ANOTHER account is off limits.
  if (existingState && existingState.ownerUserId && existingState.ownerUserId !== userId) {
    return NextResponse.json({ error: 'That campaign name is already in use on another account. Pick a different name.' }, { status: 409 })
  }
  const perHour = Math.max(1, Math.min(MAX_HOURLY, Math.round(Number(payload.perHour)) || DEFAULT_HOURLY))
  const theme = THEMES.includes(String(payload.theme)) ? String(payload.theme) : undefined
  const sender = await resolveSender(userId, typeof payload.fromProfile === 'string' ? payload.fromProfile : undefined)

  // Recipients: pipeline leads this account owns (same access wall as every
  // lead action) + raw pasted addresses. No system-wide audience here — a
  // member's campaigns reach THEIR contacts, nobody else's.
  const leadIds = Array.isArray(payload.leads) ? payload.leads.filter((x) => typeof x === 'string' && x.length > 5).slice(0, MAX_QUEUE) : []
  const wanted = new Map<string, { email: string; leadId: string | null; name: string | null }>()
  if (leadIds.length > 0) {
    const leads = await db.lead.findMany({
      where: { id: { in: leadIds }, userId, unlocked: true },
      select: { id: true, email: true, contactName: true, company: true },
    })
    for (const l of leads) {
      const email = l.email?.trim().toLowerCase()
      if (email && EMAIL_RE.test(email)) {
        wanted.set(email, { email, leadId: l.id, name: (l.contactName || '').trim() || null })
      }
    }
  }
  const invalid: string[] = []
  for (const raw of Array.isArray(payload.emails) ? payload.emails.slice(0, MAX_QUEUE) : []) {
    const email = String(raw || '').trim().toLowerCase()
    if (!email) continue
    if (!EMAIL_RE.test(email)) {
      invalid.push(email.slice(0, 120))
      continue
    }
    if (!wanted.has(email)) wanted.set(email, { email, leadId: null, name: null })
  }
  if (wanted.size === 0) {
    return NextResponse.json({ error: 'No valid recipients. Unlock contacts in Leads first, or paste addresses.' }, { status: 400 })
  }
  if (wanted.size > MAX_QUEUE) {
    return NextResponse.json({ error: `That is ${wanted.size} recipients. One queue carries at most ${MAX_QUEUE}.` }, { status: 400 })
  }

  // Suppression and duplicates are refused at queue time, before a cent or a
  // credit is even thought about.
  const emails = [...wanted.keys()]
  const [suppressedRows, existingRows] = await Promise.all([
    db.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    db.emailLog.findMany({ where: { userId, campaign: tag, toEmail: { in: emails }, status: { in: ['QUEUED', 'SENT'] } }, select: { toEmail: true } }),
  ])
  const suppressed = new Set(suppressedRows.map((r) => r.email))
  const already = new Set(existingRows.map((r) => r.toEmail))
  const toQueue = emails
    .filter((e) => !suppressed.has(e) && !already.has(e))
    .map((e) => ({ email: e, leadId: wanted.get(e)!.leadId, name: wanted.get(e)!.name }))

  // The airtime pre-flight: the queue quotes what it will cost beyond the
  // plan's bundle and refuses to stage what the wallet cannot stand behind.
  // The debit itself still lands only after each send actually goes out.
  const { paid, plan } = gate
  const bundle = paid ? (PLAN_SEND_BUNDLES[plan] ?? DEFAULT_SEND_BUNDLE) : FREE_LIMITS.emailSends
  const windowStart = paid ? new Date(Date.now() - SEND_BUNDLE_WINDOW_DAYS * 24 * 60 * 60 * 1000) : null
  const used = await db.emailLog.count({
    where: { userId, status: 'SENT', ...(windowStart ? { createdAt: { gte: windowStart } } : {}) },
  })
  const priceCents = SPEND_ACTIONS.EMAIL_SEND.cents
  const airtimeSends = Math.max(0, toQueue.length - Math.max(0, bundle - used))
  const airtimeCents = airtimeSends * priceCents
  if (airtimeCents > 0) {
    const wallet = await ensureWallet(userId)
    if (wallet.balance < airtimeCents) {
      return NextResponse.json(
        {
          error: `This queue needs ${airtimeSends} send${airtimeSends === 1 ? '' : 's'} beyond your ${bundle} included this cycle — R${(airtimeCents / 100).toFixed(2)} of airtime, and the wallet has R${(wallet.balance / 100).toFixed(2)}. Load airtime in the Wallet (from R50) or trim the list, then build again.`,
          upgrade: false,
          feature: 'wallet',
        },
        { status: 402 },
      )
    }
  }

  // One draft, greeted per person: {name} fills from the lead's contact name
  // where it exists, otherwise a plain honest "there" — a member campaign
  // never guesses a stranger's name from a platform account.
  const personal = payload.personalize === true
  await db.emailLog.createMany({
    data: toQueue.map((r) => {
      const nm = r.name || 'there'
      return {
        userId,
        toEmail: r.email,
        subject: (personal ? subject.replace(/\{name\}/g, nm).replace(/\{email\}/g, r.email) : subject).slice(0, 180),
        body: (personal ? body.replace(/\{name\}/g, nm).replace(/\{email\}/g, r.email) : body).slice(0, 4000),
        status: 'QUEUED',
        provider: 'PLATFORM',
        campaign: tag,
        leadId: r.leadId,
      }
    }),
  })

  // Born PAUSED — the draft gate is structural: the member sees the card,
  // reviews it, and Start is a press THEY make. A second batch joining an
  // existing queue keeps its status, pace and lane (the pace-preservation
  // promise the exec path carries too) — only the letter count grows.
  const me = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  const state: CampaignState = existingState && existingState.ownerUserId === userId
    ? {
        ...existingState,
        perHour,
        from: sender.from,
        theme: theme ?? existingState.theme,
        replyTo: me?.email || existingState.replyTo,
      }
    : {
        status: 'PAUSED',
        perHour,
        from: sender.from,
        // The lane is the engine's business, not the member's: SES when it is
        // wired (built for volume), the free lane otherwise. Same laws either way.
        provider: isSesConfigured() ? 'SES' : 'RESEND',
        theme,
        ownerUserId: userId,
        replyTo: me?.email || undefined,
        createdAt: new Date().toISOString(),
      }
  await writeCampaignState(tag, state)

  return NextResponse.json({
    ok: true,
    campaign: tag,
    queued: toQueue.length,
    personalized: personal && toQueue.length > 0,
    skippedSuppressed: suppressedRows.filter((r) => !already.has(r.email)).length,
    skippedDuplicate: existingRows.length,
    invalid,
    from: sender.from,
    state,
  })
}

export async function GET() {
  const gate = await requireUpgraded()
  if (!gate.ok) return gate.res
  const userId = gate.userId

  const rows = await db.emailLog.findMany({
    where: { userId, campaign: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: {
      id: true, campaign: true, toEmail: true, subject: true, body: true, status: true, error: true,
      openedAt: true, openCount: true, sentAt: true, createdAt: true, theme: true,
      lead: { select: { id: true, company: true, stage: true } },
    },
  })
  const states = await readCampaignStates()
  const ownTags = new Set(Object.entries(states).filter(([, s]) => s.ownerUserId === userId).map(([t]) => t))

  const summary: Record<string, { queued: number; sent: number; failed: number; bounced: number; skipped: number; opened: number; total: number }> = {}
  for (const row of rows) {
    const tag = row.campaign as string
    if (!ownTags.has(tag)) continue
    const c = (summary[tag] ||= { queued: 0, sent: 0, failed: 0, bounced: 0, skipped: 0, opened: 0, total: 0 })
    c.total++
    if (row.status === 'QUEUED') c.queued++
    if (row.status === 'SENT') c.sent++
    if (row.status === 'FAILED') c.failed++
    if (row.status === 'BOUNCED') c.bounced++
    if (row.status === 'SKIPPED') c.skipped++
    if (row.openedAt) c.opened++
  }

  const campaigns = [...ownTags].map((tag) => ({
    tag,
    state: states[tag] || null,
    summary: summary[tag] || { queued: 0, sent: 0, failed: 0, bounced: 0, skipped: 0, opened: 0, total: 0 },
  }))

  // Signed unsubscribe link per row, member eyes only, their own rows only.
  const rowsOut = rows
    .filter((r) => ownTags.has(r.campaign as string))
    .map((r) => ({ ...r, unsubUrl: unsubscribeUrl(r.id) }))

  return NextResponse.json({ ok: true, campaigns, rows: rowsOut })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireUpgraded()
  if (!gate.ok) return gate.res
  const userId = gate.userId

  let payload: {
    campaign?: string; action?: string; rowId?: string
    subject?: string; body?: string; perHour?: number; theme?: string
  }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const tag = `u-${slugTag(payload.campaign)}`
  const action = payload.action || ''

  const states = await readCampaignStates()
  const current = states[tag]
  // Ownership is the wall: a member controls only queues their account owns.
  if (!current || current.ownerUserId !== userId) {
    return NextResponse.json({ error: 'No campaign queue under that name belongs to this account.' }, { status: 404 })
  }

  if (action === 'removeRow') {
    const rowId = String(payload.rowId || '')
    if (!rowId) return NextResponse.json({ error: 'rowId is required.' }, { status: 400 })
    const row = await db.emailLog.findFirst({ where: { id: rowId, userId, campaign: tag }, select: { id: true, status: true, toEmail: true } })
    if (!row) return NextResponse.json({ error: 'That email is not part of this campaign.' }, { status: 404 })
    if (row.status !== 'QUEUED') {
      return NextResponse.json({ error: 'Only queued emails can be removed — this one has already left the queue.' }, { status: 400 })
    }
    await db.emailLog.update({
      where: { id: row.id },
      data: { status: 'SKIPPED', error: `Removed by sender · ${new Date().toISOString().slice(0, 10)}` },
    })
    return NextResponse.json({ ok: true, removed: row.toEmail })
  }

  if (action === 'editDraft') {
    const subject = typeof payload.subject === 'string' ? payload.subject.trim() : undefined
    const body = typeof payload.body === 'string' ? payload.body : undefined
    if (subject !== undefined && !subject) return NextResponse.json({ error: 'Subject cannot be empty.' }, { status: 400 })
    if (body !== undefined && body.trim().length < 20) {
      return NextResponse.json({ error: 'Body is too short — a real letter is at least 20 characters.' }, { status: 400 })
    }
    const nextPerHour = payload.perHour == null
      ? undefined
      : Math.max(1, Math.min(MAX_HOURLY, Math.round(Number(payload.perHour)) || DEFAULT_HOURLY))
    const nextTheme = payload.theme === undefined || payload.theme === null || payload.theme === ''
      ? undefined
      : (THEMES.includes(String(payload.theme)) ? String(payload.theme) : undefined)
    if (payload.theme != null && payload.theme !== '' && !nextTheme) {
      return NextResponse.json({ error: 'Unknown look. Use boardroom, goldrush, nightshift or plain.' }, { status: 400 })
    }
    const data: { subject?: string; body?: string } = {}
    if (subject !== undefined) data.subject = subject.slice(0, 180)
    if (body !== undefined) data.body = body.slice(0, 4000)
    let updatedRows = 0
    if (Object.keys(data).length > 0) {
      const res = await db.emailLog.updateMany({
        where: { campaign: tag, userId, status: 'QUEUED' },
        data,
      })
      updatedRows = res.count
    }
    const next: CampaignState = { ...current }
    if (nextPerHour !== undefined) next.perHour = nextPerHour
    if (payload.theme !== undefined) next.theme = nextTheme
    await writeCampaignState(tag, next)
    return NextResponse.json({
      ok: true,
      campaign: tag,
      updatedRows,
      queuedLeft: await db.emailLog.count({ where: { campaign: tag, userId, status: 'QUEUED' } }),
      state: next,
    })
  }

  if (action === 'start' || action === 'resume') {
    const queued = await db.emailLog.count({ where: { campaign: tag, userId, status: 'QUEUED' } })
    if (queued === 0) {
      return NextResponse.json({ error: 'Nothing queued under this campaign. Build the queue first.' }, { status: 400 })
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
      where: { campaign: tag, userId, status: 'QUEUED' },
      data: { status: 'SKIPPED', error: 'Cancelled by sender' },
    })
    const next: CampaignState = { ...current, status: 'CANCELLED', completedAt: new Date().toISOString() }
    await writeCampaignState(tag, next)
    return NextResponse.json({ ok: true, campaign: tag, state: next, stopped: stopped.count })
  }

  return NextResponse.json({ error: 'Unknown action. Use start, pause, cancel, removeRow or editDraft.' }, { status: 400 })
}
