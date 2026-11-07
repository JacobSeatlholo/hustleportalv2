import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { normalizeCampaignFrom, isSesConfigured } from '@/lib/mailer'
import { writeCampaignState } from '@/lib/campaignqueue'

export const dynamic = 'force-dynamic'

/**
 * ONE-TIME DOOR — Task 175 bench staging (Task 146 precedent: built, used
 * once, deleted in the same session). Takes the harvested + MX-verified lead
 * list from the request body and, per campaign tag:
 *   1. refuses if the tag already has rows (no double-fire),
 *   2. dedupes against the platform bench by email (any source, any stage),
 *   3. drops Suppressed and previously-touched addresses (any campaign row
 *      ever, the same law as the cold door),
 *   4. inserts the new businesses as Lead rows (source OSM, stage NEW, the
 *      master's bench — so the bench GROWS, Move 5 needs that),
 *   5. queues the approved subject-B intro under a PAUSED state (SES, 72/h,
 *      From default — the boss rewrites it with the new Edit draft handle
 *      before he presses Start).
 * It NEVER sends. Deleted right after the one call.
 */

const DOOR_TOKEN = '2d15b510671b5a694d01f58ca67453e7b8af95895e393f2c'
const MASTER_EMAIL = 'ceo@businesshustle.co.za'
const SUBJECT = 'Still hunting clients the hard way?'
const FROM = 'BlackBiz <blackbiz@hustleportal.online>'
const PER_HOUR = 72

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const BODY = `Hi,

Quick one, because your time is money.

[HustlePortal](https://www.hustleportal.online) is one place to run your hustle:

• Tell us what you do — our AI finds verified leads near you and loads them into your pipeline, ready to call.
• Quotes, invoices, tasks, clients and your money — all in one place, from your phone.
• Every new account starts with R99 free credit. No card needed.

That's the whole pitch. Month to month, pause any time.

See it for yourself: [HustlePortal](https://www.hustleportal.online)

The Business Hustle team`

type Incoming = { campaigns?: { tag?: string; recipients?: { name?: string; city?: string; email?: string; website?: string; phone?: string; vertical?: string }[] }[] }

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

  let body: Incoming
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const campaigns = (body.campaigns || []).filter((c) => c.tag && Array.isArray(c.recipients))
  if (campaigns.length === 0) {
    return NextResponse.json({ error: 'No campaigns in the payload.' }, { status: 400 })
  }
  if (!isSesConfigured()) {
    return NextResponse.json({ error: 'SES lane not configured — staging refused.' }, { status: 503 })
  }
  const master = await db.user.findFirst({ where: { email: MASTER_EMAIL }, select: { id: true, email: true } })
  if (!master) {
    return NextResponse.json({ error: `Master account ${MASTER_EMAIL} not found.` }, { status: 503 })
  }

  // Pre-flight: any tag with existing rows refuses the whole door (one shot).
  const tags = campaigns.map((c) => String(c.tag).slice(0, 60))
  const existingCounts = await Promise.all(tags.map((t) => db.emailLog.count({ where: { campaign: t } })))
  const clashes = tags.filter((t, i) => existingCounts[i] > 0)
  if (clashes.length > 0) {
    return NextResponse.json({ error: 'Tags already carry rows, door refuses double-fire.', clashes })
  }

  // Global dedupe universe: every email already on the platform (any lead row)
  // and every address that ever carried a real campaign row or suppression.
  const allIncoming = [...new Set(campaigns.flatMap((c) => (c.recipients || []).map((r) => String(r.email || '').trim().toLowerCase())))]
  const [existingLeadEmails, suppressedRows, touchedRows] = await Promise.all([
    db.lead.findMany({ where: { email: { not: null, in: allIncoming } }, select: { email: true } }),
    db.suppression.findMany({ where: { email: { in: allIncoming } }, select: { email: true } }),
    db.emailLog.findMany({ where: { campaign: { not: null }, status: { in: ['QUEUED', 'SENT', 'FAILED', 'BOUNCED'] }, toEmail: { in: allIncoming } }, select: { toEmail: true } }),
  ])
  const existingSet = new Set(existingLeadEmails.map((l) => (l.email || '').trim().toLowerCase()))
  const suppressedSet = new Set(suppressedRows.map((s) => s.email))
  const touchedSet = new Set(touchedRows.map((t) => t.toEmail.trim().toLowerCase()))

  const results: unknown[] = []
  const state = {
    status: 'PAUSED' as const,
    perHour: PER_HOUR,
    from: normalizeCampaignFrom(FROM),
    provider: 'SES' as const,
    createdAt: new Date().toISOString(),
  }

  for (const c of campaigns) {
    const tag = String(c.tag).slice(0, 60)
    // Per-campaign email dedupe (batch can repeat an address across verticals).
    const fresh = new Map<string, { name: string; city: string; website: string; phone: string; vertical: string }>()
    let dupBatch = 0
    for (const r of c.recipients || []) {
      const email = String(r.email || '').trim().toLowerCase()
      if (!email || !EMAIL_RE.test(email)) continue
      if (existingSet.has(email) || suppressedSet.has(email) || touchedSet.has(email)) continue
      if (fresh.has(email)) { dupBatch++; continue }
      fresh.set(email, {
        name: String(r.name || '').slice(0, 120),
        city: String(r.city || 'SA').slice(0, 60),
        website: String(r.website || '').slice(0, 200),
        phone: String(r.phone || '').slice(0, 40),
        vertical: String(r.vertical || '').slice(0, 40),
      })
    }

    const emails = [...fresh.keys()]
    let inserted = 0
    const queueRows: { email: string; leadId: string }[] = []
    for (const email of emails) {
      const info = fresh.get(email)!
      const lead = await db.lead.create({
        data: {
          userId: master.id,
          company: info.name || email.split('@')[1],
          email,
          website: info.website || null,
          phone: info.phone || null,
          city: info.city,
          industry: info.vertical || null,
          source: 'OSM',
          stage: 'NEW',
        },
        select: { id: true },
      })
      inserted++
      queueRows.push({ email, leadId: lead.id })
    }

    if (queueRows.length > 0) {
      await db.emailLog.createMany({
        data: queueRows.map((r) => ({
          userId: master.id,
          toEmail: r.email,
          subject: SUBJECT,
          body: BODY,
          status: 'QUEUED',
          provider: 'PLATFORM',
          campaign: tag,
          leadId: r.leadId,
        })),
      })
      await writeCampaignState(tag, state)
    }

    results.push({
      campaign: tag,
      given: (c.recipients || []).length,
      batchDuplicates: dupBatch,
      insertedLeads: inserted,
      queuedEmails: queueRows.length,
    })
  }

  return NextResponse.json({
    ok: true,
    stagedUnder: master.email,
    state,
    benchExcluded: { alreadyOnPlatform: existingSet.size, suppressed: suppressedSet.size, previouslyTouched: touchedSet.size },
    results,
    note: 'Rows are QUEUED, campaigns are PAUSED. Edit the From on each card, then press Start per campaign.',
  })
}
