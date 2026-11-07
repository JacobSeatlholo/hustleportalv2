import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { normalizeCampaignFrom, isSesConfigured } from '@/lib/mailer'
import { writeCampaignState } from '@/lib/campaignqueue'

export const dynamic = 'force-dynamic'

/**
 * ONE-TIME DOOR — Task 174 cold-audience pull + staging (Task 146 precedent:
 * built, used once, deleted in the same session).
 *
 * The exec seat path is closed in this session (no credentials ever persisted),
 * so this door carries the ONE operation the send plan needs: run the honest
 * cold filter chain over the NEW lead bench and stage the campaign PAUSED.
 *
 * Law of this door:
 *   - Token-gated; a wrong or missing token reads as a plain 404.
 *   - It NEVER sends. Rows are born QUEUED under a PAUSED campaign state;
 *     Start stays behind the boss's own button in Mail → Campaigns.
 *   - One shot: if the campaign tag already has queue rows it refuses, so a
 *     retried request can never double-stage.
 *   - Returns addresses only (plus funnel counters) — no names, no phones.
 *   - Deleted in the same session; after that this route 404s forever.
 */

const DOOR_TOKEN = '7e3d835d2523593d62a7fe4880a334fdd820a78cca1f7448'

const CAMPAIGN_TAG = 'cold-intro-2026-11'
const SUBJECT = 'Still hunting clients the hard way?' // boss picked B
const FROM = 'BlackBiz <blackbiz@hustleportal.online>'
const PER_HOUR = 72
const MASTER_EMAIL = 'ceo@businesshustle.co.za'

// The platform's own doors — nobody cold-mails the house.
const INTERNAL_DOMAINS = ['hustleportal.online', 'businesshustle.co.za', 'kloofstreet.online']
// Boss's own words on record: TEAM rows are the client's (Franck's) prospect
// bench, CSV/MANUAL rows are members' private CRM data. Neither is ours to
// cold-mail. Everything else on the bench is platform-discovered.
const PRIVATE_SOURCES = ['TEAM', 'CSV', 'MANUAL']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Boss picked subject B. Body exactly as delivered in the draft (copy of
// record, worklog Task 174): no {name} merge on purpose (cold rows are not
// accounts — a merge would greet every one "there"), markdown phrase links so
// the HTML side renders anchors and the text side flattens cleanly. The queue
// engine appends the one-click unsubscribe + legal footer at send time.
const BODY = `Hi,

Quick one, because your time is money.

[HustlePortal](https://www.hustleportal.online) is one place to run your hustle:

• Tell us what you do — our AI finds verified leads near you and loads them into your pipeline, ready to call.
• Quotes, invoices, tasks, clients and your money — all in one place, from your phone.
• Every new account starts with R99 free credit. No card needed.

That's the whole pitch. Month to month, pause any time.

See it for yourself: [HustlePortal](https://www.hustleportal.online)

The Business Hustle team`

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // ---- The honest funnel, computed on prod where the real rows live ----
  const totalNew = await db.lead.count({ where: { stage: 'NEW' } })
  const rows = await db.lead.findMany({
    where: { stage: 'NEW' },
    select: { id: true, email: true, source: true, emailBouncedAt: true },
  })

  const bySourceAll: Record<string, number> = {}
  for (const r of rows) {
    const src = (r.source || 'MANUAL').toUpperCase()
    bySourceAll[src] = (bySourceAll[src] || 0) + 1
  }

  const bounced = rows.filter((r) => r.emailBouncedAt).length
  const withEmail = rows.filter((r) => (r.email || '').trim())

  // Private sources stay out (TEAM = client bench, CSV/MANUAL = member data).
  const platform = withEmail.filter((r) => !PRIVATE_SOURCES.includes((r.source || 'MANUAL').toUpperCase()))
  const bySourcePrivate: Record<string, number> = {}
  for (const r of withEmail) {
    const src = (r.source || 'MANUAL').toUpperCase()
    if (PRIVATE_SOURCES.includes(src)) bySourcePrivate[src] = (bySourcePrivate[src] || 0) + 1
  }

  // Valid shape + lowercase + dedupe (first lead row wins, leadId rides along).
  const unique = new Map<string, { email: string; leadId: string }>()
  let invalidShape = 0
  for (const r of platform) {
    const email = (r.email || '').trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) {
      invalidShape++
      continue
    }
    if (!unique.has(email)) unique.set(email, { email, leadId: r.id })
  }

  // Internal doors + already-on-the-platform addresses are not cold.
  const internalDomains = [...unique.values()].filter((r) =>
    INTERNAL_DOMAINS.some((d) => r.email.endsWith('@' + d))
  )
  const afterInternal = [...unique.values()].filter(
    (r) => !INTERNAL_DOMAINS.some((d) => r.email.endsWith('@' + d))
  )
  const memberRows = await db.user.findMany({
    where: { email: { in: afterInternal.map((r) => r.email) } },
    select: { email: true },
  })
  const memberSet = new Set(memberRows.map((u) => u.email.trim().toLowerCase()))
  const afterMembers = afterInternal.filter((r) => !memberSet.has(r.email))

  // Suppression is law (378 addresses at last count).
  const suppressedRows = await db.suppression.findMany({
    where: { email: { in: afterMembers.map((r) => r.email) } },
    select: { email: true },
  })
  const suppressedSet = new Set(suppressedRows.map((s) => s.email))
  const afterSuppression = afterMembers.filter((r) => !suppressedSet.has(r.email))

  // Cold means never touched: any address that ever carried a real campaign
  // row (queued, sent, failed or bounced) under ANY tag is out. SKIPPED rows
  // never mailed, so they stay cold.
  const touchedRows = await db.emailLog.findMany({
    where: {
      campaign: { not: null },
      status: { in: ['QUEUED', 'SENT', 'FAILED', 'BOUNCED'] },
      toEmail: { in: afterSuppression.map((r) => r.email) },
    },
    select: { toEmail: true },
  })
  const touchedSet = new Set(touchedRows.map((t) => t.toEmail.trim().toLowerCase()))
  const sendable = afterSuppression.filter((r) => !touchedSet.has(r.email))

  const funnel = {
    totalNew: totalNew,
    withEmail: withEmail.length,
    bouncedMarked: bounced,
    privateSourcesExcluded: platform.length < withEmail.length ? withEmail.length - platform.length : 0,
    bySourceAll,
    bySourcePrivate,
    invalidShape,
    afterDedupe: unique.size,
    internalDomain: internalDomains.length,
    memberOverlap: memberSet.size ? afterInternal.length - afterMembers.length : 0,
    suppressed: suppressedSet.size ? afterMembers.length - afterSuppression.length : 0,
    previouslyTouched: touchedSet.size ? afterSuppression.length - sendable.length : 0,
    sendable: sendable.length,
  }

  const existing = await db.emailLog.count({ where: { campaign: CAMPAIGN_TAG } })
  if (existing > 0) {
    return NextResponse.json({
      ok: true,
      staged: false,
      alreadyStaged: true,
      campaign: CAMPAIGN_TAG,
      existingRows: existing,
      funnel,
      note: 'This campaign tag already has queue rows. The door refuses to double-stage.',
    })
  }

  if (!isSesConfigured()) {
    return NextResponse.json({
      ok: true,
      staged: false,
      sesConfigured: false,
      funnel,
      note: 'SES lane is not configured on this deployment. Nothing staged — the plan says SES, like the prior big blasts.',
    })
  }

  const master = await db.user.findFirst({
    where: { email: MASTER_EMAIL },
    select: { id: true, email: true },
  })
  if (!master) {
    return NextResponse.json({
      ok: true,
      staged: false,
      funnel,
      note: `Master account ${MASTER_EMAIL} not found — queue rows need a userId to ride under. Nothing staged.`,
    })
  }

  await db.emailLog.createMany({
    data: sendable.map((r) => ({
      userId: master.id,
      toEmail: r.email,
      subject: SUBJECT,
      body: BODY,
      status: 'QUEUED',
      provider: 'PLATFORM',
      campaign: CAMPAIGN_TAG,
      leadId: r.leadId,
    })),
  })

  const state = {
    status: 'PAUSED' as const,
    perHour: PER_HOUR,
    from: normalizeCampaignFrom(FROM),
    provider: 'SES' as const,
    createdAt: new Date().toISOString(),
  }
  await writeCampaignState(CAMPAIGN_TAG, state)

  return NextResponse.json({
    ok: true,
    staged: true,
    campaign: CAMPAIGN_TAG,
    queued: sendable.length,
    state,
    sesConfigured: true,
    stagedUnder: master.email,
    funnel,
    // Audit copy: addresses only. Nothing sends until Start is pressed.
    addresses: sendable.map((r) => r.email),
    costEstimate: { usdPerThousand: 0.1, estUsd: Number(((sendable.length * 0.1) / 1000).toFixed(4)) },
    note: 'Rows are QUEUED, campaign state is PAUSED. No email leaves until Start is pressed in Mail → Campaigns.',
  })
}
