/**
 * The Verified Lead Pool — the freshness, verification and scale layer under
 * every lead scan.
 *
 * WHY IT EXISTS
 *  Three product promises hang on it:
 *   1. FRESH: a business seen again on a later scan proves it is still active.
 *      Every record carries first seen / last seen dates, and the daily refresh
 *      demotes anything unseen for 60 days so dead listings never resurface.
 *   2. VERIFIABLE: contact facts are checked (SA phone shape, website
 *      liveness), scored 0 to 100 and badged honestly — a map listing says
 *      "Map listed", a live website says "Checked · website live". No badge
 *      ever promises more than the checks behind it.
 *   3. SCALE: the first scan of a topic pays the engine quota; every seller
 *      after that serves free from the pool. When onboarding brings a thousand
 *      sellers scanning the same ground, engine spend stays flat and the map
 *      directories and Google buckets stay healthy.
 *
 * ROTATION: pool serves exclude everything the seller already saved and
 * rotate the least recently served faces first, so scanning again keeps
 * meeting businesses the seller has never contacted.
 *
 * Everything here is best effort by design: a pool failure must never break
 * the scan itself — engines stay the source of truth, the pool multiplies them.
 */

import crypto from 'crypto'
import { db } from '@/lib/db'
import { planState } from '@/lib/limits'
import type { LeadPool as LeadPoolRow } from '@prisma/client'

// ---------- identity helpers ----------

export function normKey(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The scan topic: normalized ideal client description + area (or a ~1 km GPS
 * bucket). Computed from the seller's own words BEFORE the seller website
 * context is appended, so two sellers describing the same client in the same
 * area share one pool topic no matter what their own websites say.
 */
export function topicFingerprint(definition: string, city: string, lat?: number, lng?: number): string {
  const areaKey =
    lat !== undefined && lng !== undefined
      ? `pin${lat.toFixed(2)}_${lng.toFixed(2)}`
      : normKey(city) || 'za'
  return crypto.createHash('sha1').update(`${areaKey}|${normKey(definition).slice(0, 200)}`).digest('hex').slice(0, 24)
}

const SA_PHONE = /^0[1-8]\d{8}$/

/** SA phone shape check with normalization to +27. Strict is the point: a valid shape is a real verifiable signal. */
export function normalizeSaPhone(raw?: string): { ok: boolean; e164?: string } {
  const s = (raw || '').trim()
  if (!s) return { ok: false }
  let d = s.replace(/\D/g, '')
  if (!d) return { ok: false }
  if (d.startsWith('27') && d.length === 11) d = `0${d.slice(2)}`
  if (d.length === 9 && !d.startsWith('0')) d = `0${d}`
  if (!SA_PHONE.test(d)) return { ok: false }
  return { ok: true, e164: `+27${d.slice(1)}` }
}

/** OSM record ids arrive in three generations; all become an openstreetmap.org link a seller can click. */
export function sourceRefFor(externalId?: string): string | undefined {
  const s = (externalId || '').trim()
  if (!s) return undefined
  if (/^https?:\/\//i.test(s)) return s
  const m = s.replace(/^osm_/, '')
  let kind = ''
  let id = ''
  const short = m.match(/^([nwr])_(\d+)$/)
  const long = m.match(/^(node|way|relation)_(\d+)$/)
  if (short) {
    kind = short[1]
    id = short[2]
  } else if (long) {
    kind = long[1][0]
    id = long[2]
  } else {
    return undefined
  }
  const full = kind === 'n' ? 'node' : kind === 'w' ? 'way' : 'relation'
  return `https://www.openstreetmap.org/${full}/${id}`
}

export function hostOf(w?: string): string | null {
  const s = (w || '').trim()
  if (!s) return null
  return s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/[^a-z0-9.-]/gi, '') || null
}

// ---------- verification ----------

export interface VerifyChecks {
  phoneOk: boolean
  websiteOk?: boolean
}

/** The score behind every badge: real source record 40, valid phone 20, live website 25, reconfirmed 15. */
export function scoreFor(checks: VerifyChecks, confirmCount: number, hasWebsite: boolean): number {
  let s = 40
  if (checks.phoneOk) s += 20
  if (checks.websiteOk === true) s += 25
  if (confirmCount >= 2) s += 15
  if (!hasWebsite && checks.websiteOk === undefined) s = Math.min(s, 75) // nothing to ping: never claim a website bonus
  return Math.max(0, Math.min(100, s))
}

/** HEAD, then GET, then plain http. A server that answers at all counts as live. */
export async function pingWebsite(host: string): Promise<boolean> {
  const attempts: { url: string; method: 'HEAD' | 'GET' }[] = [
    { url: `https://${host}`, method: 'HEAD' },
    { url: `https://${host}`, method: 'GET' },
    { url: `http://${host}`, method: 'GET' },
  ]
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: a.method,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HustlePortalBot/1.0)' },
        signal: AbortSignal.timeout(3_500),
        redirect: 'follow',
      })
      if (res.ok) return true
      if (res.status < 500 && a.method === 'GET') return true // server answered: site lives, page may have moved
    } catch {
      /* next attempt */
    }
  }
  return false
}

/** Parse the stored verification checks (used by the refresh cron too). */
export function parseChecksSource(json?: string | null): VerifyChecks {
  try {
    const v = json ? JSON.parse(json) : {}
    return { phoneOk: Boolean(v.phoneOk), websiteOk: typeof v.websiteOk === 'boolean' ? v.websiteOk : undefined }
  } catch {
    return { phoneOk: false }
  }
}

function badgeFor(p: { verifyChecks: string | null; confirmCount: number; source: string; website: string | null }): string {
  const checks = parseChecksSource(p.verifyChecks)
  if (checks.websiteOk === true) return 'Checked · website live'
  if (checks.phoneOk && p.confirmCount >= 2) return 'Confirmed · phone on file'
  if (checks.phoneOk) return 'Checked · phone on file'
  if (p.confirmCount >= 2) return 'Reconfirmed on scans'
  if (p.source === 'OSM') return 'Map listed'
  return 'Web found'
}

function seenAgo(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days <= 0) return 'seen today'
  if (days === 1) return 'seen 1 day ago'
  if (days < 30) return `seen ${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? 'seen 1 month ago' : `seen ${months} months ago`
}

// ---------- guardrails ----------

const SCAN_COOLDOWN_MS = 12_000
const DAILY_SCAN_CAP_FREE = 25
const DAILY_SCAN_CAP_PAID = 100

export type ScanGate = { ok: true } | { ok: false; reason: 'cooldown'; waitSeconds: number } | { ok: false; reason: 'daily' }

/** Cooldown between ANY scans (pool serves too) + a daily engine allowance per seller. Both survive serverless restarts: DB backed. */
export async function checkScanAllowance(userId: string): Promise<ScanGate> {
  const last = await db.scanRun.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (last) {
    const waitMs = SCAN_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())
    if (waitMs > 0) return { ok: false, reason: 'cooldown', waitSeconds: Math.ceil(waitMs / 1000) + 1 }
  }
  const { paid } = await planState(userId)
  const cap = paid ? DAILY_SCAN_CAP_PAID : DAILY_SCAN_CAP_FREE
  // True SAST midnight in UTC: read today's date off the SAST clock (now minus
  // 2h), floor to that day, then shift the floor back 2h into UTC. The old
  // shortcut skipped the final shift, so the window actually refilled at
  // 02:00 South African time while the copy promised midnight.
  const sastClock = new Date(Date.now() - 2 * 60 * 60 * 1000) // SAST = UTC+2
  const dayStartUtc = new Date(
    Date.UTC(sastClock.getUTCFullYear(), sastClock.getUTCMonth(), sastClock.getUTCDate()) - 2 * 60 * 60 * 1000
  )
  const count = await db.scanRun.count({ where: { userId, createdAt: { gte: dayStartUtc } } })
  if (count >= cap) return { ok: false, reason: 'daily' }
  return { ok: true }
}

/** True when an ENGINE scan (not a pool serve) ran this topic in the last few minutes — the warm window. */
export async function recentTopicScan(topicFp: string, minutes: number): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60_000)
  const hit = await db.scanRun.findFirst({
    where: { topicFp, createdAt: { gte: since }, mode: { in: ['AI_SEARCH', 'OSM', 'EXPLEE', 'NONE'] } },
    select: { id: true },
  })
  return Boolean(hit)
}

export async function logScanRun(userId: string, topicFp: string, mode: string, leadCount: number, fromPool: boolean): Promise<void> {
  try {
    await db.scanRun.create({ data: { userId, topicFp, mode, leadCount, fromPool } })
  } catch {
    /* the scan log must never break the scan */
  }
}

/** Companies the seller already saved: pool serves never repeat them. */
export async function userSavedKeys(userId: string): Promise<Set<string>> {
  const rows = await db.lead.findMany({ where: { userId }, select: { company: true }, take: 5000 })
  return new Set(rows.map((r) => normKey(r.company)))
}

// ---------- serving ----------

export interface PoolLead {
  company: string
  contactName?: string
  role?: string
  profileUrl?: string
  email?: string
  phone?: string
  website?: string
  industry?: string
  city?: string
  why?: string
  score?: number
  verified?: string
  seenAgo?: string
  verifyScore?: number
  sourceRef?: string
}

function poolToLead(p: LeadPoolRow): PoolLead {
  return {
    company: p.company,
    ...(p.contactName ? { contactName: p.contactName } : {}),
    ...(p.role ? { role: p.role } : {}),
    ...(p.profileUrl ? { profileUrl: p.profileUrl } : {}),
    ...(p.email ? { email: p.email } : {}),
    ...(p.phone ? { phone: p.phoneRaw || p.phone } : {}),
    ...(p.website ? { website: p.website } : {}),
    ...(p.industry ? { industry: p.industry } : {}),
    ...(p.city ? { city: p.city } : {}),
    ...(p.why ? { why: p.why } : {}),
    ...(p.score ? { score: p.score } : {}),
    verified: badgeFor(p),
    seenAgo: p.lastSeenAt ? seenAgo(p.lastSeenAt) : undefined,
    ...(p.verifyScore ? { verifyScore: p.verifyScore } : {}),
    ...(p.sourceRef ? { sourceRef: p.sourceRef } : {}),
  }
}

/**
 * Serve fresh pool faces for a topic: active records seen within the age
 * window, none of them already in the seller's pipeline, least recently
 * served first. Marks everything it serves so rotation keeps working.
 */
export async function serveFromPool(opts: {
  topicFp: string
  cap: number
  excludeKeys: Set<string>
  maxAgeDays?: number
}): Promise<PoolLead[]> {
  const cap = Math.max(1, Math.min(30, opts.cap))
  const maxAge = opts.maxAgeDays ?? 21
  const cutoff = new Date(Date.now() - maxAge * 86_400_000)
  // Postgres does the rotation sort (never served faces first, then least
  // recently served, then freshest) and only the head rows ship to the app.
  // The JS sort below stays as the deterministic tiebreak on the small set.
  const hits = await db.leadPoolHit.findMany({
    where: {
      topicFp: opts.topicFp,
      pool: { active: true, verifyState: { not: 'stale' }, lastSeenAt: { gte: cutoff } },
    },
    include: { pool: true },
    orderBy: [
      { pool: { lastServedAt: { sort: 'asc', nulls: 'first' } } },
      { pool: { lastSeenAt: 'desc' } },
    ],
    take: 150,
  })
  const rows = hits.map((h) => h.pool).filter((p) => !opts.excludeKeys.has(normKey(p.company)))
  rows.sort((a, b) => {
    const sa = a.lastServedAt ? a.lastServedAt.getTime() : 0
    const sb = b.lastServedAt ? b.lastServedAt.getTime() : 0
    if (sa !== sb) return sa - sb // never served faces first, then least recently served
    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
  })
  const serve = rows.slice(0, cap)
  if (serve.length === 0) return []
  try {
    await db.leadPool.updateMany({
      where: { id: { in: serve.map((s) => s.id) } },
      data: { timesServed: { increment: 1 }, lastServedAt: new Date() },
    })
  } catch {
    /* rotation bookkeeping must never break a serve */
  }
  return serve.map(poolToLead)
}

// ---------- remembering (the capture + verify pass) ----------

export interface RememberLead {
  company: string
  contactName?: string
  role?: string
  profileUrl?: string
  email?: string
  phone?: string
  website?: string
  industry?: string
  city?: string
  why?: string
  score?: number
  externalId?: string
  lat?: number
  lng?: number
}

export interface VerifyStamp {
  phoneOk: boolean
  websiteOk?: boolean
  verifyScore: number
  confirmCount: number
  verified: string
  seenAgo: string
}

async function chunked<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

/**
 * Every engine result lands in the shared pool: deduped, contact facts
 * merged (never clobbered with empties), phones normalized, websites pinged
 * when the scan budget allows, confirmCount bumped on every re-sighting.
 * Returns per company stamps so the route can badge what it just found.
 */
export async function rememberScanResults(opts: {
  topicFp: string
  area: string
  source: 'GEMINI' | 'ZAI' | 'OSM' | 'EXPLEE'
  leads: RememberLead[]
  budgetUntil?: number
}): Promise<Map<string, VerifyStamp>> {
  const stamps = new Map<string, VerifyStamp>()
  const rows = opts.leads.filter((l) => l.company && l.company.trim()).slice(0, 30)
  if (rows.length === 0) return stamps
  const now = new Date()

  const canPing = !opts.budgetUntil || Date.now() < opts.budgetUntil - 6_000
  const pingList = canPing ? rows.filter((l) => l.website).slice(0, 8) : []
  const siteOk = new Map<string, boolean>()
  await chunked(pingList, 8, async (l) => {
    const host = hostOf(l.website)
    if (!host) return
    siteOk.set(normKey(l.company), await pingWebsite(host))
  })

  const fps = rows.map((l) => `${normKey(l.company)}|${normKey(l.city || opts.area)}`)
  let existing: LeadPoolRow[] = []
  try {
    existing = await db.leadPool.findMany({ where: { fingerprint: { in: fps } } })
  } catch {
    return stamps // pool down: the engines' answer already went out unharmed
  }
  const byFp = new Map(existing.map((p) => [p.fingerprint, p]))
  const toCreate: RememberLead[] = []
  const refById = new Map<string, string>() // fingerprint -> poolId for hit links

  // Classify first (no DB): merges vs new faces.
  const merges: { l: RememberLead; prev: LeadPoolRow; phone: { ok: boolean; e164?: string }; sourceRef?: string; websiteOk?: boolean }[] = []
  for (const l of rows) {
    const key = normKey(l.company)
    const fp = `${key}|${normKey(l.city || opts.area)}`
    const prev = byFp.get(fp)
    if (!prev) {
      toCreate.push(l)
      continue
    }
    merges.push({ l, prev, phone: normalizeSaPhone(l.phone), sourceRef: sourceRefFor(l.externalId), websiteOk: siteOk.get(key) })
  }

  // Merge writes run in parallel chunks: a sequential roundtrip per row used to
  // add seconds of tail latency to every engine scan on a serverless database.
  await chunked(merges, 8, async ({ l, prev, phone, sourceRef, websiteOk }) => {
    const key = normKey(l.company)
    const fp = `${key}|${normKey(l.city || opts.area)}`
    // merge: keep the best facts on file, never erase good data with blanks
    const prevChecks = parseChecksSource(prev.verifyChecks)
    const checks: VerifyChecks = {
      phoneOk: prevChecks.phoneOk || phone.ok,
      ...(websiteOk !== undefined ? { websiteOk } : prevChecks.websiteOk !== undefined ? { websiteOk: prevChecks.websiteOk } : {}),
    }
    const confirmCount = prev.confirmCount + 1
    const hasWebsite = Boolean(prev.website || l.website)
    const score = scoreFor(checks, confirmCount, hasWebsite)
    try {
      const updated = await db.leadPool.update({
        where: { id: prev.id },
        data: {
          lastSeenAt: now,
          lastVerifiedAt: now,
          confirmCount,
          verifyScore: score,
          verifyState: checks.websiteOk === true ? 'active' : prev.verifyState === 'stale' ? 'listed' : prev.verifyState,
          verifyChecks: JSON.stringify({ ...checks, checkedAt: now.toISOString() }),
          phone: prev.phone || phone.e164 || null,
          phoneRaw: prev.phoneRaw || l.phone || null,
          email: prev.email || l.email || null,
          website: prev.website || l.website || null,
          contactName: prev.contactName || l.contactName || null,
          role: prev.role || l.role || null,
          profileUrl: prev.profileUrl || l.profileUrl || null,
          industry: prev.industry || l.industry || null,
          city: prev.city || l.city || null,
          why: l.why || prev.why || null,
          score: typeof l.score === 'number' ? l.score : prev.score,
          lat: prev.lat ?? (typeof l.lat === 'number' ? l.lat : null),
          lng: prev.lng ?? (typeof l.lng === 'number' ? l.lng : null),
          sourceRef: prev.sourceRef || sourceRef || null,
        },
      })
      refById.set(fp, updated.id)
      stamps.set(key, {
        phoneOk: checks.phoneOk,
        ...(websiteOk !== undefined ? { websiteOk } : {}),
        verifyScore: score,
        confirmCount,
        verified: badgeFor(updated),
        seenAgo: 'seen today',
      })
    } catch {
      /* one record failing never blocks the rest */
    }
  })

  // new faces: create in parallel chunks, then link to the topic
  await chunked(toCreate, 8, async (l) => {
    const key = normKey(l.company)
    const fp = `${key}|${normKey(l.city || opts.area)}`
    const phone = normalizeSaPhone(l.phone)
    const websiteOk = siteOk.get(key)
    const checks: VerifyChecks = {
      phoneOk: phone.ok,
      ...(websiteOk === true ? { websiteOk: true } : websiteOk === false ? { websiteOk: false } : {}),
    }
    const score = scoreFor(checks, 1, Boolean(l.website))
    try {
      const created = await db.leadPool.create({
        data: {
          fingerprint: fp,
          company: l.company.trim().slice(0, 160),
          industry: l.industry?.slice(0, 120) || null,
          city: l.city?.slice(0, 120) || null,
          areaLabel: opts.area?.slice(0, 160) || null,
          phone: phone.e164 || null,
          phoneRaw: l.phone || null,
          email: l.email || null,
          website: l.website || null,
          contactName: l.contactName || null,
          role: l.role || null,
          profileUrl: l.profileUrl || null,
          why: l.why || null,
          score: typeof l.score === 'number' ? l.score : null,
          lat: typeof l.lat === 'number' ? l.lat : null,
          lng: typeof l.lng === 'number' ? l.lng : null,
          source: opts.source,
          sourceRef: sourceRefFor(l.externalId) || null,
          confirmCount: 1,
          verifyScore: score,
          verifyState: checks.websiteOk === true ? 'active' : 'listed',
          verifyChecks: JSON.stringify({ ...checks, checkedAt: now.toISOString() }),
          firstSeenAt: now,
          lastSeenAt: now,
          lastVerifiedAt: now,
        },
      })
      refById.set(fp, created.id)
      stamps.set(key, {
        phoneOk: checks.phoneOk,
        ...(websiteOk !== undefined ? { websiteOk } : {}),
        verifyScore: score,
        confirmCount: 1,
        verified: badgeFor(created),
        seenAgo: 'seen today',
      })
    } catch {
      /* a duplicate fingerprint from a parallel scan: harmless, skip */
    }
  })

  // link everything this topic surfaced so the same topic serves from the pool later
  const hitRows = [...refById.entries()].map(([fp, poolId]) => ({ topicFp: opts.topicFp, poolId }))
  if (hitRows.length) {
    try {
      await db.leadPoolHit.createMany({ data: hitRows, skipDuplicates: true })
    } catch {
      /* hit links are sugar: never fatal */
    }
  }
  return stamps
}
