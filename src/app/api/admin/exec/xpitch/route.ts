import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { setConfig, CONFIG_KEYS } from '@/lib/config'
import { XPITCH_SEED, XPitchSeedLead } from '@/lib/xpitchSeed'
import { loadPipeline, XPitchExtraLead, XPitchStatus, XPITCH_STATUSES } from '@/lib/xpitchStore'

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

  const store = await loadPipeline()
  const seedHit = XPITCH_SEED.find((l) => l.handle.toLowerCase() === handle.toLowerCase())
  const extraHit = Object.keys(store.extra || {}).find((h) => h.toLowerCase() === handle.toLowerCase())
  if (!handle || (!seedHit && !extraHit)) {
    return NextResponse.json({ error: 'Unknown handle.' }, { status: 400 })
  }
  if (!XPITCH_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${XPITCH_STATUSES.join(', ')}` }, { status: 400 })
  }

  // preserve the canonical casing already stored (seed or extra)
  const canonical = seedHit?.handle ?? extraHit ?? handle
  store.status[canonical] = status
  store.updatedAt = new Date().toISOString()
  await setConfig(STORE_KEY, JSON.stringify(store))

  return NextResponse.json({ ok: true, handle: canonical, status, counts: countsOf(store) })
}
