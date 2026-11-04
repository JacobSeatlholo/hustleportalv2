import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { setConfig, CONFIG_KEYS } from '@/lib/config'
import { XPITCH_SEED, XPitchSeedLead } from '@/lib/xpitchSeed'
import { loadPipeline, XPitchExtraLead, XPitchStatus, XPITCH_STATUSES } from '@/lib/xpitchStore'
import { db } from '@/lib/db'

export const maxDuration = 30

/**
 * /api/admin/exec/xpitch — THE OWNER'S GROWTH PIPELINE.
 *
 * The lead pool is the MEMBERS' product: rows there get served to paying
 * scans, so pitch targets for HustlePortal itself never belong in it. This
 * is the owner's own list — the SA sellers found on X/TikTok/Facebook to
 * pitch subscriptions to — with a status each so outreach is workable from
 * the exec dashboard:
 *
 *   todo → dm (first DM sent) → replied → joined (subscriber!) — or skip.
 *
 * The base list is the audited sweep snapshot (src/lib/xpitchSeed.ts). New
 * sweep finds do NOT land here directly: they wait in the owner's review
 * gate (/api/admin/exec/xpitch/review), and only the ones he marks "good
 * fit" join as EXTRA leads stored in the DB — a seed re-generation never
 * wipes the boss's own adds.
 */

const STORE_KEY = CONFIG_KEYS.XPITCH_PIPELINE

function mergedLeads(store: { extra?: Record<string, XPitchExtraLead> }): (XPitchSeedLead | XPitchExtraLead)[] {
  const extras = Object.values(store.extra || {}).filter((l) => l && l.handle)
  return [...XPITCH_SEED, ...extras]
}

function countsOf(store: Awaited<ReturnType<typeof loadPipeline>>) {
  const counts: Record<XPitchStatus, number> = { todo: 0, dm: 0, replied: 0, joined: 0, skip: 0 }
  for (const lead of mergedLeads(store)) counts[store.status[lead.handle] ?? 'todo']++
  return counts
}

function rowsOf(store: Awaited<ReturnType<typeof loadPipeline>>) {
  return mergedLeads(store).map((l) => ({ ...l, status: store.status[l.handle] ?? 'todo' }))
}

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const store = await loadPipeline()
  return NextResponse.json({
    ok: true,
    counts: countsOf(store),
    leads: rowsOf(store),
    total: mergedLeads(store).length,
    updatedAt: store.updatedAt ?? null,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({}))
  const handle = String(body?.handle || '').trim()
  const status = String(body?.status || '').trim() as XPitchStatus
  const doneTap = body?.done === true || body?.done === false

  const store = await loadPipeline()
  const seedHit = XPITCH_SEED.find((l) => l.handle.toLowerCase() === handle.toLowerCase())
  const extraHit = Object.keys(store.extra || {}).find((h) => h.toLowerCase() === handle.toLowerCase())
  if (!handle || (!seedHit && !extraHit)) {
    return NextResponse.json({ error: 'Unknown handle.' }, { status: 400 })
  }
  if (!doneTap && !XPITCH_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${XPITCH_STATUSES.join(', ')}` }, { status: 400 })
  }

  // preserve the canonical casing already stored (seed or extra)
  const canonical = seedHit?.handle ?? extraHit ?? handle
  const current = store.status[canonical] ?? 'todo'
  const row = (seedHit ?? (store.extra || {})[extraHit!]) as XPitchSeedLead | XPitchExtraLead

  // ---- the Done tick: "I have DM'd them" → the funnel moves AND the lead
  // lands in the boss's own pipeline under Contacted, in one tap. Untick
  // mirrors it back (to-DM / New) while the row is untouched; a row he has
  // already worked (replied/joined, or a lead he advanced himself) is never
  // dragged backwards.
  let leadResult: { stage: string; created: boolean; leftAlone: boolean } | null = null
  if (doneTap) {
    if (body.done === true) {
      if (current === 'todo' || current === 'skip') {
        store.status[canonical] = 'dm'
      }
      leadResult = await upsertPipelineLead(gate.me!.id, canonical, row)
    } else {
      if (current === 'dm') {
        store.status[canonical] = 'todo'
      }
      leadResult = await mirrorPipelineLeadBack(gate.me!.id, canonical)
    }
  } else {
    store.status[canonical] = status
  }

  store.updatedAt = new Date().toISOString()
  await setConfig(STORE_KEY, JSON.stringify(store))

  const effective = doneTap ? store.status[canonical] : status
  return NextResponse.json({ ok: true, handle: canonical, status: effective, counts: countsOf(store), lead: leadResult })
}

/** The pipeline lead a Done tick owns, found by its stable externalId. */
async function findPitchLead(userId: string, handle: string) {
  return db.lead.findFirst({ where: { userId, externalId: `xpitch:${handle.toLowerCase()}` } })
}

/** Done tick ON: create the pipeline lead (Contacted) or wake the existing one. */
async function upsertPipelineLead(userId: string, handle: string, row: XPitchSeedLead | XPitchExtraLead) {
  const existing = await findPitchLead(userId, handle)
  if (existing) {
    if (existing.stage === 'NEW') {
      await db.lead.update({ where: { id: existing.id }, data: { stage: 'CONTACTED' } })
      return { stage: 'CONTACTED', created: false, leftAlone: false }
    }
    // already in the pipeline and already worked — never drag it backwards
    return { stage: existing.stage, created: false, leftAlone: false }
  }
  const platform = row.platform === 'tiktok' ? 'TikTok' : row.platform === 'facebook' ? 'Facebook' : 'X'
  const today = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  const lead = await db.lead.create({
    data: {
      userId,
      company: row.name?.trim() || `@${handle}`,
      contactName: row.name?.trim() || null,
      stage: 'CONTACTED',
      source: 'WEB',
      profileUrl: row.url || null,
      city: row.city && row.city !== 'ZA' ? row.city : null,
      phone: row.phone || null,
      email: row.email || null,
      notes: `From the pitch list (@${handle} on ${platform}). DM sent ${today}.`,
      externalId: `xpitch:${handle.toLowerCase()}`,
    },
    select: { stage: true },
  })
  return { stage: lead.stage, created: true, leftAlone: false }
}

/** Done tick OFF: mirror back to New ONLY while the lead is untouched
 * (still exactly where the tick put it, no emails, no tasks). */
async function mirrorPipelineLeadBack(userId: string, handle: string) {
  const lead = await findPitchLead(userId, handle)
  if (!lead) return { stage: 'NEW', created: false, leftAlone: true }
  if (lead.stage !== 'CONTACTED') {
    return { stage: lead.stage, created: false, leftAlone: true }
  }
  const [emails, tasks] = await Promise.all([
    db.emailLog.count({ where: { leadId: lead.id } }),
    db.task.count({ where: { leadId: lead.id } }),
  ])
  if (emails > 0 || tasks > 0) {
    return { stage: lead.stage, created: false, leftAlone: true }
  }
  await db.lead.update({ where: { id: lead.id }, data: { stage: 'NEW' } })
  return { stage: 'NEW', created: false, leftAlone: false }
}
