import { getConfigJson, setConfig, CONFIG_KEYS } from '@/lib/config'
import { XPITCH_SEED } from '@/lib/xpitchSeed'
import { loadPipeline } from '@/lib/xpitchStore'

/**
 * xpitchReview.ts — the owner's lead review gate, shared store logic.
 *
 * Boss's law: nothing lands in the pitch pipeline on autopilot. Every new
 * find (sweep scripts, the AI lead search through treg, anything else) waits
 * in this queue with its freshness + contacts visible, and the owner makes
 * the call:
 *
 *   [Add to pipeline]  → verified good fit → joins /xpitch as "to DM"
 *   [Not a fit]        → handle is remembered as rejected, so future finds
 *                        never resurface it
 *
 * Store shape (PlatformConfig XPITCH_REVIEW):
 *   { queue: Record<handle, Lead>, rejected: Record<handle, {why, when}>, updatedAt }
 *
 * Shared by the review route (the boss's buttons) and the treg search route
 * (where AI-found leads land), so both sides enforce the exact same rules.
 */

export const XPITCH_REVIEW_KEY = CONFIG_KEYS.XPITCH_REVIEW

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

export interface ReviewStore {
  queue: Record<string, ReviewLead>
  rejected: Record<string, { why: string; when: string }>
  updatedAt?: string
}

export async function loadReview(): Promise<ReviewStore> {
  const s = await getConfigJson<Partial<ReviewStore> | null>(XPITCH_REVIEW_KEY, null)
  return {
    queue: (s?.queue && typeof s.queue === 'object' ? s.queue : {}) as Record<string, ReviewLead>,
    rejected: (s?.rejected && typeof s.rejected === 'object' ? s.rejected : {}) as Record<string, { why: string; when: string }>,
    updatedAt: s?.updatedAt,
  }
}

export function sanitizeLead(raw: unknown): ReviewLead | null {
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

/**
 * Push candidates into the review queue. Idempotent by handle: anything
 * already seeded, pipelined, queued or rejected is skipped, so reruns and
 * repeat waves stay clean.
 */
export async function submitReviewLeads(incoming: unknown[]): Promise<{ added: number; skipped: number; queueCount: number }> {
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
  await setConfig(XPITCH_REVIEW_KEY, JSON.stringify(store))
  return { added, skipped, queueCount: Object.keys(store.queue).length }
}
