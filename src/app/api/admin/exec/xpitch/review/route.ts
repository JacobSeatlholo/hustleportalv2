import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { getConfigJson, setConfig, CONFIG_KEYS } from '@/lib/config'
import { XPITCH_SEED } from '@/lib/xpitchSeed'
import { loadPipeline } from '@/lib/xpitchStore'

export const maxDuration = 30

/**
 * /api/admin/exec/xpitch/review — THE OWNER'S LEAD REVIEW GATE.
 *
 * Boss's law: nothing lands in the pitch pipeline on autopilot. Every new
 * sweep find (X, TikTok, Facebook...) waits in this queue with its
 * freshness + contacts visible, and the owner makes the call:
 *
 *   [Add to pipeline]  → verified good fit → joins /xpitch as "to DM"
 *   [Not a fit]        → handle is remembered as rejected, so future sweeps
 *                        never resurface it
 *
 * Sweep scripts push candidates with { action: 'submit', leads: [...] } —
 * idempotent by handle: anything already seeded, pipelined, queued or
 * rejected is skipped, so reruns and repeat waves stay clean.
 *
 * Store shape (PlatformConfig XPITCH_REVIEW):
 *   { queue: Record<handle, Lead>, rejected: Record<handle, {why, when}>, updatedAt }
 */

const STORE_KEY = CONFIG_KEYS.XPITCH_REVIEW

export interface ReviewLead {
  handle: string
  name: string
  trade: string
  city: string
  followers: number
  url: string
  phone: string
  email: string
  platform: 'x' | 'tiktok' | 'facebook'
  lastPost: string
  fresh: 'fresh' | 'warm' | 'stale' | 'no-posts' | 'unknown'
  source?: string
  note?: string
}

interface ReviewStore {
  queue: Record<string, ReviewLead>
  rejected: Record<string, { why: string; when: string }>
  updatedAt?: string
}

async function loadReview(): Promise<ReviewStore> {
  const s = await getConfigJson<Partial<ReviewStore> | null>(STORE_KEY, null)
  return {
    queue: (s?.queue && typeof s.queue === 'object' ? s.queue : {}) as Record<string, ReviewLead>,
    rejected: (s?.rejected && typeof s.rejected === 'object' ? s.rejected : {}) as Record<string, { why: string; when: string }>,
    updatedAt: s?.updatedAt,
  }
}

function sanitizeLead(raw: unknown): ReviewLead | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const handle = String(r.handle || '').trim()
  if (!handle || handle.length > 120) return null
  const platform = ['x', 'tiktok', 'facebook'].includes(String(r.platform)) ? (String(r.platform) as ReviewLead['platform']) : 'x'
  const fresh = ['fresh', 'warm', 'stale', 'no-posts', 'unknown'].includes(String(r.fresh))
    ? (String(r.fresh) as ReviewLead['fresh'])
    : 'unknown'
  return {
    handle,
    name: String(r.name || handle).slice(0, 120),
    trade: String(r.trade || 'unsorted').slice(0, 40),
    city: String(r.city || 'SA').slice(0, 60),
    followers: Math.max(0, Math.round(Number(r.followers) || 0)),
    url: String(r.url || '').startsWith('http') ? String(r.url).slice(0, 300) : '',
    phone: String(r.phone || '').slice(0, 30),
    email: String(r.email || '').slice(0, 120),
    platform,
    lastPost: String(r.lastPost || '').slice(0, 20),
    fresh,
    source: String(r.source || '').slice(0, 60),
    note: String(r.note || '').slice(0, 200),
  }
}

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const store = await loadReview()
  const queue = Object.values(store.queue).sort(
    (a, b) => (b.followers || 0) - (a.followers || 0) || a.handle.localeCompare(b.handle)
  )
  return NextResponse.json({
    ok: true,
    queue,
    queueCount: queue.length,
    rejectedCount: Object.keys(store.rejected).length,
    updatedAt: store.updatedAt ?? null,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '').trim()

  if (action === 'submit') {
    const incoming = Array.isArray(body?.leads) ? body.leads : []
    const store = await loadReview()
    const pipeline = await loadPipeline()
    const seeded = new Set(XPITCH_SEED.map((l) => l.handle.toLowerCase()))
    const piped = new Set(Object.keys(pipeline.extra || {}).map((h) => h.toLowerCase()))
    let added = 0
    let skipped = 0
    for (const raw of incoming) {
      const lead = sanitizeLead(raw)
      if (!lead) { skipped++; continue }
      const k = lead.handle.toLowerCase()
      if (seeded.has(k) || piped.has(k) || store.queue[k] || store.rejected[k]) { skipped++; continue }
      store.queue[lead.handle] = lead
      added++
    }
    if (added > 0) store.updatedAt = new Date().toISOString()
    await setConfig(STORE_KEY, JSON.stringify(store))
    return NextResponse.json({ ok: true, added, skipped, queueCount: Object.keys(store.queue).length })
  }

  const handle = String(body?.handle || '').trim()
  const store = await loadReview()
  const key = Object.keys(store.queue).find((h) => h.toLowerCase() === handle.toLowerCase())
  const lead = key ? store.queue[key] : null

  if (action === 'add') {
    // good fit: out of the queue, into the owner's pipeline as "to DM"
    if (!key || !lead) return NextResponse.json({ error: 'Not in the review queue.' }, { status: 404 })
    const pipeline = await loadPipeline()
    pipeline.extra = pipeline.extra || {}
    delete pipeline.extra[key] // re-add refreshes the fields
    pipeline.extra[key] = {
      handle: lead.handle, name: lead.name, trade: lead.trade, city: lead.city,
      followers: lead.followers, url: lead.url, phone: lead.phone, email: lead.email,
      platform: lead.platform, lastPost: lead.lastPost, fresh: lead.fresh,
      addedVia: lead.source || 'review', addedAt: new Date().toISOString(),
    }
    pipeline.status[key] = 'todo'
    pipeline.updatedAt = new Date().toISOString()
    await setConfig(CONFIG_KEYS.XPITCH_PIPELINE, JSON.stringify(pipeline))
    delete store.queue[key]
    store.updatedAt = new Date().toISOString()
    await setConfig(STORE_KEY, JSON.stringify(store))
    return NextResponse.json({ ok: true, handle: key, added: true })
  }

  if (action === 'pull') {
    // undo: the owner reconsiders — extra pipeline row goes back to the queue
    const pipeline = await loadPipeline()
    pipeline.extra = pipeline.extra || {}
    const pkey = Object.keys(pipeline.extra).find((h) => h.toLowerCase() === handle.toLowerCase())
    if (!pkey) return NextResponse.json({ error: 'Not an added lead — nothing to pull back.' }, { status: 404 })
    const pulled = pipeline.extra[pkey]
    store.queue[pkey] = {
      handle: pulled.handle, name: pulled.name, trade: pulled.trade, city: pulled.city,
      followers: pulled.followers, url: pulled.url, phone: pulled.phone, email: pulled.email,
      platform: pulled.platform, lastPost: pulled.lastPost, fresh: pulled.fresh,
      source: pulled.addedVia || 'pulled-back',
    }
    delete pipeline.extra[pkey]
    delete pipeline.status[pkey]
    pipeline.updatedAt = new Date().toISOString()
    store.updatedAt = new Date().toISOString()
    await setConfig(CONFIG_KEYS.XPITCH_PIPELINE, JSON.stringify(pipeline))
    await setConfig(STORE_KEY, JSON.stringify(store))
    return NextResponse.json({ ok: true, handle: pkey, pulled: true })
  }

  if (action === 'reject') {
    // not a fit: remembered forever so sweeps never resurface it
    if (!key) return NextResponse.json({ error: 'Not in the review queue.' }, { status: 404 })
    const why = String(body?.why || 'not a fit').slice(0, 200)
    store.rejected[key] = { why, when: new Date().toISOString() }
    delete store.queue[key]
    store.updatedAt = new Date().toISOString()
    await setConfig(STORE_KEY, JSON.stringify(store))
    return NextResponse.json({ ok: true, handle: key, rejected: true, rejectedCount: Object.keys(store.rejected).length })
  }

  return NextResponse.json({ error: `action must be submit | add | pull | reject` }, { status: 400 })
}
