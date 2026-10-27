/**
 * The Verified Lead Pool, the freshness, verification and scale layer under
 * every lead scan.
 *
 * WHY IT EXISTS
 *  Three product promises hang on it:
 *   1. FRESH: a business seen again on a later scan proves it is still active.
 *      Every record carries first seen / last seen dates, and the daily refresh
 *      demotes anything unseen for 60 days so dead listings never resurface.
 *   2. VERIFIABLE: contact facts are checked (SA phone shape, website
 *      liveness), scored 0 to 100 and badged honestly, a map listing says
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
 * the scan itself, engines stay the source of truth, the pool multiplies them.
 */

import crypto from 'crypto'
import { db } from '@/lib/db'
import { planState } from '@/lib/limits'
import { suppressedNameKeys, suppressedOsmIds } from '@/lib/suppression'
import { deadEmailMap } from '@/lib/reach'
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

/** HEAD, then GET, then plain http. A server that answers at all counts as live.
 * SSRF guard: the host must resolve to public internet space before a single
 * byte is fetched, lead websites are attacker-influenceable data (imports,
 * pasted contact lists), so this fetch is a doorway that stays locked. */
export async function pingWebsite(host: string): Promise<boolean> {
  const { safeUrl } = await import('@/lib/ssrf')
  const clean = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
  const verdict = await safeUrl(`https://${clean}`)
  if (!verdict.ok) return false
  const attempts: { url: string; method: 'HEAD' | 'GET' }[] = [
    { url: `https://${clean}`, method: 'HEAD' },
    { url: `https://${clean}`, method: 'GET' },
    { url: `http://${clean}`, method: 'GET' },
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

function badgeFor(p: { verifyChecks: string | null; confirmCount: number; source: string; website: string | null; poolTag?: string | null }): string {
  const checks = parseChecksSource(p.verifyChecks)
  // A team status is EARNED: only contacts under an outreach project (the
  // campaigns the team actually ran) may say "Team verified". Verified data
  // rows that came in through search keep the honest platform badges.
  if (p.source === 'EXPLEE' && p.poolTag) {
    if (checks.websiteOk === true) return 'Team verified · website live'
    if (checks.phoneOk) return 'Team verified · phone checked'
    if (p.confirmCount >= 2) return 'Team verified · reconfirmed'
    return 'Team verified contact'
  }
  if (checks.websiteOk === true) return 'Checked · website live'
  if (checks.phoneOk && p.confirmCount >= 2) return 'Confirmed · phone on file'
  if (checks.phoneOk) return 'Checked · phone on file'
  if (p.source === 'EXPLEE') return 'Verified contact'
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
  // CAMPAIGN runs are excluded: they are the platform working for the client
  // (fired by their topup), never a spend of the client's own scan allowance.
  const last = await db.scanRun.findFirst({
    where: { userId, mode: { not: 'CAMPAIGN' } },
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
  const count = await db.scanRun.count({ where: { userId, mode: { not: 'CAMPAIGN' }, createdAt: { gte: dayStartUtc } } })
  if (count >= cap) return { ok: false, reason: 'daily' }
  return { ok: true }
}

/** True when an ENGINE scan (not a pool serve) ran this topic in the last few minutes, the warm window. */
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

// ---------- the reachable promise (serving side) ----------

/**
 * Reachability was an assumption; this pass makes it a fact, at $0.
 *
 * Two hard sources of "this address cannot receive mail":
 *  1. THE PROVIDER SAID SO: bounceCount / emailDeadAt on the face, written
 *     by the mail webhooks. A bounce is the mail system's own verdict.
 *  2. THE DNS GATE: the domain does not exist or announces no mail path
 *     (no MX, no A fallback). Bounded and cached in reach.ts, zero AI quota.
 *
 * What the serve laws do with it:
 *  - a dead address is stripped from the served card (never sold as a fact),
 *  - a face left with NO door at all (no live email, no phone, no named
 *    human, no website, no public profile) never ships — the seller could
 *    do literally nothing with it. It stays in the pool: the next scan that
 *    re-sees it can still enrich it with a live door.
 */
async function reachPass(rows: LeadPoolRow[]): Promise<{ deadEmails: Set<string>; unreachable: Set<string> }> {
  const deadEmails = new Set<string>()
  const withEmail = rows.filter((p) => (p.email || '').includes('@'))
  // The providers' own verdicts first — free, no resolver roundtrip.
  for (const p of withEmail) {
    if (p.emailDeadAt || p.bounceCount > 0) deadEmails.add((p.email || '').trim().toLowerCase())
  }
  // The DNS gate on the rest, bounded (worst case one parallel batch).
  const rest = withEmail.filter((p) => !deadEmails.has((p.email || '').trim().toLowerCase()))
  if (rest.length > 0) {
    const dnsDead = await deadEmailMap(rest.map((p) => p.email), 16)
    for (const p of rest) {
      const e = (p.email || '').trim().toLowerCase()
      if (dnsDead.has(e)) deadEmails.add(e)
    }
  }
  const unreachable = new Set<string>()
  for (const p of rows) {
    const emailDead = p.email ? deadEmails.has(p.email.trim().toLowerCase()) : false
    const door =
      Boolean(p.contactName?.trim()) ||
      Boolean(p.phone) ||
      Boolean(p.phoneRaw) ||
      Boolean(p.website) ||
      Boolean(p.profileUrl) ||
      (Boolean(p.email) && !emailDead)
    if (!door) unreachable.add(p.id)
  }
  return { deadEmails, unreachable }
}

/** Copy of a pool row with a provably dead address removed from its facts. */
function stripDeadEmail(p: LeadPoolRow, deadEmails: Set<string>): LeadPoolRow {
  const email = (p.email || '').trim().toLowerCase()
  return email && deadEmails.has(email) ? { ...p, email: null } : p
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
  score?: number
  verified?: string
  seenAgo?: string
  verifyScore?: number
  sourceRef?: string
  local?: boolean
  // raw freshness for the composite scorer (the deck's recency part)
  lastSeenAt?: Date
}

// The seller sees a clean card: who to ask, where to find them, and the
// honest status. The team's campaign conversation ("warm reply to ...")
// lives in the pool row for the owner's eyes on the Executive Dashboard,
// it never rides a member response.
function poolToLead(p: LeadPoolRow, local = false): PoolLead {
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
    ...(p.score ? { score: p.score } : {}),
    verified: badgeFor(p),
    seenAgo: p.lastSeenAt ? seenAgo(p.lastSeenAt) : undefined,
    ...(p.verifyScore ? { verifyScore: p.verifyScore } : {}),
    ...(p.sourceRef ? { sourceRef: p.sourceRef } : {}),
    ...(local ? { local: true } : {}),
    ...(p.lastSeenAt ? { lastSeenAt: p.lastSeenAt } : {}),
  }
}

/**
 * Serve fresh pool faces for a topic: active records seen within the age
 * window, none of them already in the seller's pipeline, least recently
 * served first. Marks everything it serves so rotation keeps working.
 */
// ---------- the region gate (hyperlocal is a promise, not a vibe) ----------

/**
 * The finder sells South African sellers their own neighbourhood, so a lead
 * carrying a foreign footprint never reaches an answer and never enters the
 * shared pool. Pure and cheap: the phone prefix, the website TLD and the city
 * line are the only honest geography a scan result carries. A face with none
 * of those passes and leans on the search prompt's South Africa only rule.
 * (Born the day a Johannesburg search returned four Italian businesses.)
 */
const FOREIGN_TLDS = [
  'it', 'de', 'fr', 'es', 'pt', 'nl', 'be', 'ie', 'pl', 'cz', 'at', 'ch', 'se',
  'no', 'dk', 'fi', 'ru', 'ua', 'tr', 'gr', 'cn', 'jp', 'kr', 'in', 'pk', 'id',
  'th', 'vn', 'my', 'sg', 'au', 'nz', 'uk', 'gb', 'us', 'ca', 'mx', 'br', 'ar',
  'cl', 'pe', 'ke', 'ng', 'gh', 'eg', 'ma', 'tz', 'ug', 'zm', 'mz', 'ao',
  'bw', 'na', 'zw', 'ls', 'sz', 'mu', 'mg',
]

// Overseas countries and cities that cannot collide with a South African
// place name. SA towns wearing foreign names stay OUT of this list on
// purpose: Berlin (EC), Hamburg (EC), Frankfurt (FS), East London,
// Wellington (WC), Adelaide (EC), Auckland Park, Boston (KZN), Denver (JHB).
// Their countries and TLDs still catch the real thing.
const FOREIGN_PLACES =
  /\b(italy|italia|milan|milano|rome|roma|naples|napoli|florence|firenze|turin|torino|genoa|genova|bologna|venice|venezia|germany|deutschland|munich|munchen|france|paris|lyon|marseille|spain|espana|madrid|barcelona|seville|portugal|lisbon|lisboa|porto|netherlands|holland|amsterdam|rotterdam|belgium|brussels|antwerp|austria|vienna|switzerland|zurich|geneva|sweden|stockholm|norway|oslo|denmark|copenhagen|finland|helsinki|poland|warsaw|krakow|prague|czech|hungary|budapest|romania|bucharest|greece|turkey|istanbul|ireland|dublin|cork|scotland|edinburgh|glasgow|wales|cardiff|england|manchester|birmingham|liverpool|leeds|britain|united kingdom|usa|united states|america|new york|los angeles|chicago|houston|miami|dallas|seattle|atlanta|canada|toronto|vancouver|montreal|ottawa|mexico|brazil|sao paulo|rio de janeiro|argentina|buenos aires|chile|santiago|colombia|bogota|peru|lima|china|beijing|shanghai|shenzhen|japan|tokyo|osaka|korea|seoul|india|mumbai|delhi|bangalore|indonesia|jakarta|malaysia|kuala lumpur|singapore|philippines|manila|vietnam|hanoi|thailand|bangkok|australia|sydney|melbourne|brisbane|perth|new zealand|kenya|nairobi|nigeria|lagos|abuja|ghana|accra|egypt|cairo|morocco|casablanca|tanzania|dar es salaam|uganda|kampala|zambia|lusaka|mozambique|maputo|botswana|gaborone|namibia|windhoek|angola|luanda)\b/i

function foreignPhoneSignal(phone?: string | null): boolean {
  const raw = String(phone || '').trim()
  if (!raw) return false
  const compact = raw.replace(/[\s()-]/g, '')
  if (compact.startsWith('+')) return !/^\+27\d{7,12}$/.test(compact)
  if (compact.startsWith('00')) return !/^0027\d{7,12}$/.test(compact)
  return false // 0XX and short local shapes are domestic by form
}

function foreignWebsiteSignal(website?: string | null): boolean {
  const raw = String(website || '').trim()
  if (!raw) return false
  let host = ''
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase()
  } catch {
    host = raw.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0]
  }
  if (!host) return false
  // co.za, org.za, co.uk style second levels collapse to their country TLD
  const bare = host.replace(/\.(co|org|net|gov|ac|edu|web)\.(?=[a-z]{2,3}$)/, '.')
  const tld = bare.slice(bare.lastIndexOf('.') + 1)
  return FOREIGN_TLDS.includes(tld)
}

function foreignCitySignal(city?: string | null): boolean {
  const c = String(city || '').trim()
  if (!c) return false
  return FOREIGN_PLACES.test(c)
}

/** True when the lead may face a South African seller. No signals means pass. */
export function isSouthAfricanLead(l: {
  company?: string | null
  city?: string | null
  phone?: string | null
  website?: string | null
}): boolean {
  if (!l.company || !l.company.trim()) return false
  if (foreignPhoneSignal(l.phone)) return false
  if (foreignWebsiteSignal(l.website)) return false
  if (foreignCitySignal(l.city)) return false
  return true
}

export async function serveFromPool(opts: {
  topicFp: string
  cap: number
  excludeKeys: Set<string>
  maxAgeDays?: number
  city?: string
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
  // Suppressed names (POPIA opt-outs) never serve, whatever their fingerprint.
  const drop = await suppressedNameKeys()
  const rows = hits.map((h) => h.pool).filter((p) => !opts.excludeKeys.has(normKey(p.company)) && !drop.has(normKey(p.company)))
  // Verdicts first (cheap partition), THEN the rotation sort inside each half:
  // clean faces keep their least-recently-served order, penalized faces keep
  // theirs at the back of the line.
  const cleanRows: typeof rows = []
  const judgedRows: typeof rows = []
  for (const p of rows) (verdictPenalty(p) < 0 ? judgedRows : cleanRows).push(p)
  const sorted = [...cleanRows, ...judgedRows]
  sorted.sort((a, b) => {
    const sa = a.lastServedAt ? a.lastServedAt.getTime() : 0
    const sb = b.lastServedAt ? b.lastServedAt.getTime() : 0
    if (sa !== sb) return sa - sb // never served faces first, then least recently served
    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
  })
  // One company can exist under two fingerprints (seen once with a city, once
  // without). A single serve must never hand the seller the same face twice.
  const seenCompanies = new Set<string>()
  const eligible = sorted
    .filter((p) => {
      const key = normKey(p.company)
      if (!key || seenCompanies.has(key)) return false
      seenCompanies.add(key)
      return true
    })
    // Region gate: a foreign face captured before the gate existed never
    // serves again. The pool wears the same lens the scan answers do.
    .filter((p) => isSouthAfricanLead(p))
    // LOCATION IS THE PROMISE: when the seller named a city, a row with a
    // KNOWN city that sits somewhere else never serves (the Cape Town suburb
    // answering a Johannesburg ask is exactly the junk sellers rage about).
    // Rows with no city on file still serve, the scan prompt and the local
    // flag carry the honesty there.
    .filter((p) => {
      if (!opts.city) return true
      if (!p.city || !p.city.trim()) return true
      return cityMatches(p.city, opts.city)
    })
    // THE POOL'S VERDICTS: a face the field keeps rejecting stops wasting
    // every seller's time. Members' "not a fit" verdicts pool on the face,
    // and this is where they bite, including faces RELEASED by a seller as a
    // bad fit: they stay available, but they drift to the back of the line
    // and a face with three straight rejects never serves again. That drift
    // toward sellers who keep such faces is "reassigned to a better fit".
    .filter((p) => !fieldRejected(p))
  // THE REACHABLE PROMISE, the serving law: a face nobody can reach by any
  // door never ships (the seller could do nothing with it), and a provably
  // dead address never rides a served card. The face stays in the pool —
  // the next scan that re-sees it can still hand it a live door.
  const reach = await reachPass(eligible)
  const serve = eligible.filter((p) => !reach.unreachable.has(p.id)).slice(0, cap)
  if (serve.length === 0) return []
  try {
    await db.leadPool.updateMany({
      where: { id: { in: serve.map((s) => s.id) } },
      data: { timesServed: { increment: 1 }, lastServedAt: new Date() },
    })
  } catch {
    /* rotation bookkeeping must never break a serve */
  }
  const want = opts.city || ''
  return serve.map((p) => poolToLead(stripDeadEmail(p, reach.deadEmails), cityMatches(p.city, want)))
}

/**
 * The team verified floor: when a topic's own serve comes up short, active
 * contacts the Business Hustle outreach team has already reached (real
 * replies on real campaigns) top the answer up. City matches first, then
 * anywhere in South Africa. Rotation aware, never a company the seller
 * already saved, and only ever a top up, topic matched faces always come
 * first when the pool has them.
 *
 * NICETY IS THE POINT: a contact only helps the seller if it fits their
 * business. Outreach projects are labelled, so a travel project contact
 * never tops up a cleaning scan. A general contact must share a real word
 * with the topic to serve at all. When nothing fits, the boost returns an
 * empty hand and the topic matched engines carry the answer instead.
 */

const TRAVEL_WORDS_RE = /travel|tour|holiday|safari|accommodat|hotel|guest house|lodg|backpack|explor|adventure|trip|itiner|flight/i

function rowIsTravel(r: LeadPoolRow): boolean {
  if (r.poolTag) return /travel/i.test(r.poolTag)
  return TRAVEL_WORDS_RE.test(`${r.industry || ''} ${r.company || ''}`)
}

// Words too generic to prove a contact fits a topic. "Taverns that need
// signage services" must never match a row just because its industry says
// "services" somewhere.
const STOP_WORDS = new Set(
  ('that this with need needs needing want wants from they them their have has will would could should '
    + 'around south africa where which while being been more most some such only also than then when what '
    + 'business businesses company companies services service client clients customer customers buyer buyers '
    + 'area areas seller selling sell sold buy buys bought product products real realistic looking good great')
    .split(' ')
)

function topicWordSet(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
  )
}

/**
 * LOCATION IS VITAL: a contact only helps the seller if it sits where they
 * sell. Matching is metro aware, sellers say "Johannesburg" while records
 * say "Sandton" or "Midrand", so the floor serves true metro neighbours
 * and never crosses a real city line.
 */
const METRO_ALIASES: Record<string, string[]> = {
  johannesburg: ['sandton', 'midrand', 'soweto', 'randburg', 'fourways', 'roodepoort', 'alexandra', 'lenasia', 'diepsloot', 'braamfontein', 'rosebank', 'orangefarm'],
  pretoria: ['centurion', 'hatfield', 'akasia', 'tshwane', 'mamelodi'],
  ekurhuleni: ['benoni', 'boksburg', 'kemptonpark', 'germiston', 'alberton', 'springs', 'edenvale', 'bedfordview', 'tembisa', 'katlehong', 'vosloorus', 'brakpan'],
  capetown: ['bellville', 'durbanville', 'claremont', 'milnerton', 'khayelitsha', 'gugulethu', 'seapoint', 'mitchellsplain', 'rondebosch', 'wynberg', 'goodwood', 'tableview', 'kraaifontein', 'athlone'],
  durban: ['umhlanga', 'pinetown', 'chatsworth', 'kwamashu', 'umlazi', 'amanzimtoti', 'westville', 'hillcrest', 'ethekwini'],
  bloemfontein: ['mangaung'],
  nelspruit: ['mbombela'],
  eastlondon: ['buffalocity'],
  gqeberha: ['portelizabeth', 'nelsonmandelabay'],
}

function metroOf(norm: string): string | null {
  if (!norm) return null
  for (const metro of Object.keys(METRO_ALIASES)) if (norm.includes(metro)) return metro
  for (const [metro, aliases] of Object.entries(METRO_ALIASES)) {
    for (const a of aliases) if (norm.includes(a)) return metro
  }
  return null
}

/**
 * The pool's verdicts, read as one number: negative when the field has
 * rejected this face more than it embraced it.
 */
function verdictPenalty(p: { feedbackGood: number; feedbackBad: number }): number {
  return p.feedbackBad - p.feedbackGood
}

/** A face with a string of rejects behind it stops serving entirely: the field has spoken three times with no counter-vote. */
function fieldRejected(p: { feedbackGood: number; feedbackBad: number }): boolean {
  return p.feedbackBad >= 3 && p.feedbackBad > p.feedbackGood * 2
}

export function cityMatches(rowCity: string | null | undefined, wantCity: string | null | undefined): boolean {
  const row = normKey(rowCity || '')
  const want = normKey(wantCity || '')
  if (!row || !want) return false
  if (row.includes(want) || want.includes(row)) return true
  const mr = metroOf(row)
  const mw = metroOf(want)
  return Boolean(mr && mw && mr === mw)
}

const CITY_DISPLAY: Record<string, string> = {
  johannesburg: 'Johannesburg', sandton: 'Sandton', midrand: 'Midrand', soweto: 'Soweto', randburg: 'Randburg', fourways: 'Fourways', roodepoort: 'Roodepoort', alexandra: 'Alexandra', lenasia: 'Lenasia', diepsloot: 'Diepsloot', braamfontein: 'Braamfontein', rosebank: 'Rosebank', orangefarm: 'Orange Farm',
  pretoria: 'Pretoria', centurion: 'Centurion', hatfield: 'Hatfield', akasia: 'Akasia', tshwane: 'Tshwane', mamelodi: 'Mamelodi',
  ekurhuleni: 'Ekurhuleni', benoni: 'Benoni', boksburg: 'Boksburg', kemptonpark: 'Kempton Park', germiston: 'Germiston', alberton: 'Alberton', springs: 'Springs', edenvale: 'Edenvale', bedfordview: 'Bedfordview', tembisa: 'Tembisa', katlehong: 'Katlehong', vosloorus: 'Vosloorus', brakpan: 'Brakpan',
  capetown: 'Cape Town', bellville: 'Bellville', durbanville: 'Durbanville', claremont: 'Claremont', milnerton: 'Milnerton', khayelitsha: 'Khayelitsha', gugulethu: 'Gugulethu', seapoint: 'Sea Point', mitchellsplain: 'Mitchells Plain', rondebosch: 'Rondebosch', wynberg: 'Wynberg', goodwood: 'Goodwood', tableview: 'Table View', kraaifontein: 'Kraaifontein', athlone: 'Athlone', stellenbosch: 'Stellenbosch', paarl: 'Paarl', george: 'George',
  durban: 'Durban', umhlanga: 'Umhlanga', pinetown: 'Pinetown', chatsworth: 'Chatsworth', kwamashu: 'KwaMashu', umlazi: 'Umlazi', amanzimtoti: 'Amanzimtoti', westville: 'Westville', hillcrest: 'Hillcrest', ethekwini: 'eThekwini', pietermaritzburg: 'Pietermaritzburg',
  bloemfontein: 'Bloemfontein', mangaung: 'Mangaung', nelspruit: 'Nelspruit', mbombela: 'Mbombela', witbank: 'Witbank', emalahleni: 'eMalahleni',
  eastlondon: 'East London', buffalocity: 'Buffalo City', gqeberha: 'Gqeberha', portelizabeth: 'Port Elizabeth', nelsonmandelabay: 'Nelson Mandela Bay',
  polokwane: 'Polokwane', rustenburg: 'Rustenburg', kimberley: 'Kimberley', klerksdorp: 'Klerksdorp', mahikeng: 'Mahikeng',
}

/**
 * The team's campaigns carry the geography in their names, "Johannesburg
 * explorers", and a warm reply to a city campaign IS location evidence.
 * This reads any text and returns the place it names, longest match first so
 * Durbanville never answers to Durban. It only ever fills a MISSING city on
 * a pool row: a real fact on file is never overwritten with a guess.
 */
export function cityFromText(text: string | null | undefined): string | null {
  const norm = normKey(text || '')
  if (!norm) return null
  let best: { display: string; len: number } | null = null
  for (const [key, display] of Object.entries(CITY_DISPLAY)) {
    if (norm.includes(key) && (!best || key.length > best.len)) best = { display, len: key.length }
  }
  return best?.display ?? null
}

/** A general row earns its place by sharing at least one real word with the topic. */
function rowMatchesTopic(r: LeadPoolRow, topicWords: Set<string>): boolean {
  const hay = `${r.industry || ''} ${r.company || ''} ${r.why || ''}`.toLowerCase().split(/[^a-z]+/)
  for (const w of hay) {
    if (w.length >= 4 && !STOP_WORDS.has(w) && topicWords.has(w)) return true
  }
  return false
}

export async function serveExpleeBoost(opts: {
  cap: number
  excludeKeys: Set<string>
  city?: string
  maxAgeDays?: number
  matchText?: string
}): Promise<PoolLead[]> {
  const cap = Math.max(0, Math.min(30, opts.cap))
  if (cap === 0) return []
  const maxAge = opts.maxAgeDays ?? 45
  const cutoff = new Date(Date.now() - maxAge * 86_400_000)
  const base = {
    active: true,
    source: 'EXPLEE' as const,
    verifyState: { not: 'stale' },
    lastSeenAt: { gte: cutoff },
  }
  // One wide read, then order in memory: niche first, city second, rest last.
  // The rotation order from the DB (least recently served first) survives the
  // partition, so repeat scans keep meeting new faces inside every class. The
  // window is wide on purpose: never served faces from every niche sit at the
  // front, and a narrow window could squeeze a topic's own faces out entirely.
  const candidates = await db.leadPool.findMany({
    where: base,
    orderBy: [{ lastServedAt: { sort: 'asc', nulls: 'first' } }, { lastSeenAt: 'desc' }],
    take: Math.max(cap * 6, 150),
  })
  const travelRows: LeadPoolRow[] = []
  const generalRows: LeadPoolRow[] = []
  for (const r of candidates) (rowIsTravel(r) ? travelRows : generalRows).push(r)
  const topic = (opts.matchText || '').toLowerCase()
  const travelTopic = TRAVEL_WORDS_RE.test(topic)
  const topicWords = topicWordSet(topic)
  // The certainty the product sells: every face on an answer fits the
  // seller's business. Travel project faces serve travel topics; any other
  // face must share a real word with the topic or it stays in the pool,
  // a safari house on a car wash scan is exactly the fluff the platform
  // refuses. When nothing fits, the boost steps aside and the topic matched
  // engines carry the answer instead.
  let ordered: LeadPoolRow[] = travelTopic
    ? [...travelRows, ...generalRows.filter((r) => rowMatchesTopic(r, topicWords))]
    : generalRows.filter((r) => rowMatchesTopic(r, topicWords))
  // The seller named a place: only faces that sit there may serve. A Cape
  // Town scan must never be topped up with Johannesburg names just to fill
  // the list, when nobody in the area fits, the boost steps aside and the
  // city grounded engines carry the answer instead.
  const cityScope = Boolean(opts.city) && !/^anywhere/i.test(opts.city || '')
  const inCityIds = new Set<string>()
  if (cityScope) {
    ordered = ordered.filter((r) => {
      const hit = cityMatches(r.city, opts.city || '')
      if (hit) inCityIds.add(r.id)
      return hit
    })
  }
  const picked: LeadPoolRow[] = []
  const seen = new Set<string>()
  // WHO TO ASK FOR is a promise: inside every niche + city class, faces that
  // carry a real contact name meet the seller first. Unnamed faces only step
  // in when the named ones run short, never ahead of them. The pool's own
  // verdicts ride the same law with priority: clean faces first (named, then
  // unnamed), faces the field rejected sink behind them, and three straight
  // rejects with no counter-vote stop serving entirely.
  const cleanNamed = ordered.filter((r) => r.contactName && !fieldRejected(r))
  const cleanUnnamed = ordered.filter((r) => !r.contactName && !fieldRejected(r))
  const judgedNamed = ordered.filter((r) => r.contactName && fieldRejected(r))
  const judgedUnnamed = ordered.filter((r) => !r.contactName && fieldRejected(r))
  ordered = [...cleanNamed, ...cleanUnnamed, ...judgedNamed, ...judgedUnnamed]
  // THE REACHABLE PROMISE, same law as the topic serve: the team's contacts
  // ship only when the seller can actually reach them, and a provably dead
  // address is stripped from the card instead of sold as a fact.
  const reach = await reachPass(ordered)
  ordered = ordered.filter((r) => !reach.unreachable.has(r.id))
  // Suppressed names (POPIA opt-outs) never serve, whatever their fingerprint.
  const drop = await suppressedNameKeys()
  for (const r of ordered) {
    if (picked.length >= cap) break
    const key = normKey(r.company)
    if (!key || seen.has(key) || opts.excludeKeys.has(key) || drop.has(key)) continue
    seen.add(key)
    picked.push(r)
  }
  if (picked.length === 0) return []
  try {
    await db.leadPool.updateMany({
      where: { id: { in: picked.map((s) => s.id) } },
      data: { timesServed: { increment: 1 }, lastServedAt: new Date() },
    })
  } catch {
    /* rotation bookkeeping must never break a serve */
  }
  return picked.map((p) => poolToLead(stripDeadEmail(p, reach.deadEmails), inCityIds.has(p.id)))
}

// ---------- ingesting the team's verified outreach contacts ----------

export interface IngestSummary {
  total: number
  created: number
  merged: number
  skipped: number
  pinged: number
  sample: string[]
}

/**
 * Land verified outreach contacts (the team's own Explee campaigns: real
 * companies, real replies) in the shared pool. Same merge law as scan
 * results: good facts on file are never erased with blanks, phones normalize
 * to +27, a bounded batch of websites gets pinged. Dry run classifies
 * everything and writes nothing, so the owner can preview the landing.
 */
export async function ingestVerifiedContacts(opts: {
  area: string
  contacts: RememberLead[]
  maxPings?: number
  dryRun?: boolean
}): Promise<IngestSummary> {
  const summary: IngestSummary = { total: 0, created: 0, merged: 0, skipped: 0, pinged: 0, sample: [] }
  // Company is the pool's identity: a row without one cannot land (no
  // fabrication, a person's name is not a company).
  const rows: RememberLead[] = []
  const seen = new Set<string>()
  for (const l of opts.contacts) {
    const company = (l.company || '').trim()
    if (!company) { summary.skipped++; continue }
    const key = normKey(company)
    if (!key || seen.has(key)) { summary.skipped++; continue }
    seen.add(key)
    rows.push(l)
  }
  summary.total = rows.length
  if (rows.length === 0) return summary
  const now = new Date()
  // Same reachable gate as every capture door: a dead address never lands.
  const deadEmails = await deadEmailMap(rows.map((l) => l.email), 24)
  const reachOk = (l: RememberLead) => {
    const e = (l.email || '').trim().toLowerCase()
    return e ? !deadEmails.has(e) : true
  }

  const fps = rows.map((l) => `${normKey(l.company)}|${normKey(l.city || opts.area)}`)
  let existing: LeadPoolRow[] = []
  try {
    existing = await db.leadPool.findMany({ where: { fingerprint: { in: fps } } })
    // A company can already sit in the pool under a different fingerprint
    // (seen once without a city, now landing with one). The company lookup
    // catches those twins so the merge ENRICHES the row on file instead of
    // growing a duplicate: the team's named faces gain their city.
    const companies = [...new Set(rows.map((l) => l.company.trim()))]
    if (companies.length > 0) {
      const twins = await db.leadPool.findMany({ where: { company: { in: companies } }, orderBy: { lastSeenAt: 'desc' }, take: 400 })
      existing = [...existing, ...twins]
    }
  } catch {
    summary.skipped += rows.length
    return summary
  }
  const byFp = new Map(existing.map((p) => [p.fingerprint, p]))
  const byCompany = new Map<string, LeadPoolRow>()
  for (const p of existing) {
    const k = normKey(p.company)
    if (k && !byCompany.has(k)) byCompany.set(k, p)
  }

  // Websites get pinged ONCE per new face: merged rows already carry their
  // checks on file, and the daily refresh re checks the whole pool anyway.
  const newRows = rows.filter((l) => {
    const key = normKey(l.company)
    return !byFp.get(`${key}|${normKey(l.city || opts.area)}`) && !byCompany.get(key)
  })
  const maxPings = Math.max(opts.maxPings ?? 24, 0)
  const pingList = maxPings > 0 ? newRows.filter((l) => l.website).slice(0, maxPings) : []
  const siteOk = new Map<string, boolean>()
  await chunked(pingList, 8, async (l) => {
    const host = hostOf(l.website)
    if (!host) return
    siteOk.set(normKey(l.company), await pingWebsite(host))
    summary.pinged++
  })

  for (const l of rows) {
    const key = normKey(l.company)
    const fp = `${key}|${normKey(l.city || opts.area)}`
    const phone = normalizeSaPhone(l.phone)
    const websiteOk = siteOk.get(key)
    const prev = byFp.get(fp) ?? byCompany.get(key)
    if (prev) {
      summary.merged++
      if (opts.dryRun || summary.sample.length < 8) {
        if (!opts.dryRun && prev.company) summary.sample.push(prev.company)
      }
      if (opts.dryRun) continue
      const prevChecks = parseChecksSource(prev.verifyChecks)
      const checks: VerifyChecks = {
        phoneOk: prevChecks.phoneOk || phone.ok,
        ...(websiteOk !== undefined ? { websiteOk } : prevChecks.websiteOk !== undefined ? { websiteOk: prevChecks.websiteOk } : {}),
      }
      const confirmCount = prev.confirmCount + 1
      try {
        await db.leadPool.update({
          where: { id: prev.id },
          data: {
            lastSeenAt: now,
            lastVerifiedAt: now,
            confirmCount,
            verifyScore: scoreFor(checks, confirmCount, Boolean(prev.website || l.website)),
            verifyState: checks.websiteOk === true ? 'active' : prev.verifyState === 'stale' ? 'listed' : prev.verifyState,
            verifyChecks: JSON.stringify({ ...checks, checkedAt: now.toISOString() }),
            phone: prev.phone || phone.e164 || null,
            phoneRaw: prev.phoneRaw || l.phone || null,
            email: prev.email || (reachOk(l) ? l.email || null : null),
            website: prev.website || l.website || null,
            contactName: prev.contactName || l.contactName || null,
            role: prev.role || l.role || null,
            profileUrl: prev.profileUrl || l.profileUrl || null,
            industry: prev.industry || l.industry || null,
            city: prev.city || l.city || null,
            why: prev.why || l.why || null,
            poolTag: prev.poolTag || l.poolTag || null,
            sourceRef: prev.sourceRef || l.profileUrl || null,
          },
        })
      } catch {
        /* one merge failing never blocks the rest */
      }
      continue
    }
    summary.created++
    if (summary.sample.length < 8) summary.sample.push(l.company.trim())
    if (opts.dryRun) continue
    const checks: VerifyChecks = {
      phoneOk: phone.ok,
      ...(websiteOk === true ? { websiteOk: true } : websiteOk === false ? { websiteOk: false } : {}),
    }
    const score = scoreFor(checks, 1, Boolean(l.website))
    try {
      await db.leadPool.create({
        data: {
          fingerprint: fp,
          company: l.company.trim().slice(0, 160),
          industry: l.industry?.slice(0, 120) || null,
          city: l.city?.slice(0, 120) || null,
          areaLabel: opts.area?.slice(0, 160) || null,
          phone: phone.e164 || null,
          phoneRaw: l.phone || null,
          email: reachOk(l) ? l.email || null : null,
          website: l.website || null,
          contactName: l.contactName || null,
          role: l.role || null,
          profileUrl: l.profileUrl || null,
          why: l.why || null,
          score: typeof l.score === 'number' ? l.score : null,
          source: 'EXPLEE',
          poolTag: l.poolTag?.slice(0, 120) || null,
          sourceRef: l.profileUrl || null,
          confirmCount: 1,
          verifyScore: score,
          verifyState: checks.websiteOk === true ? 'active' : 'listed',
          verifyChecks: JSON.stringify({ ...checks, checkedAt: now.toISOString() }),
          firstSeenAt: now,
          lastSeenAt: now,
          lastVerifiedAt: now,
        },
      })
    } catch {
      /* a fingerprint race with a live scan: harmless, the scan row wins */
    }
  }
  return summary
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
  poolTag?: string // the outreach project this verified contact came from
}

export interface VerifyStamp {
  phoneOk: boolean
  websiteOk?: boolean
  verifyScore: number
  confirmCount: number
  verified: string
  seenAgo: string
  contactName?: string
  role?: string
  profileUrl?: string
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
  // POPIA opt-outs never enter the pool: name matches and exact map ids drop
  // before a single row is written.
  const [dropKeys, dropOsm] = await Promise.all([suppressedNameKeys(), suppressedOsmIds()])
  const rows = opts.leads
    .filter((l) => l.company && l.company.trim())
    // Region gate: foreign faces never enter the shared pool. A foreign row
    // captured once would resurface for every seller after that.
    .filter((l) => isSouthAfricanLead(l))
    .filter((l) => !dropKeys.has(normKey(l.company)) && !(l.externalId && dropOsm.has(l.externalId)))
    .slice(0, 30)
  if (rows.length === 0) return stamps
  const now = new Date()

  // THE REACHABLE GATE AT CAPTURE: an address the mail system can never
  // deliver to is not stored, so junk never enters the pool and never
  // resurfaces for any seller afterwards. The face still lands (phone,
  // website and the story remain); only the dead address is dropped.
  // Bounded DNS, cached, $0 — no AI quota is touched.
  const deadEmails = await deadEmailMap(rows.map((l) => l.email), 16)
  const reachOk = (l: RememberLead) => {
    const e = (l.email || '').trim().toLowerCase()
    return e ? !deadEmails.has(e) : true
  }

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
          email: prev.email || (reachOk(l) ? l.email || null : null),
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
        ...(updated.contactName ? { contactName: updated.contactName } : {}),
        ...(updated.role ? { role: updated.role } : {}),
        ...(updated.profileUrl ? { profileUrl: updated.profileUrl } : {}),
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
          email: reachOk(l) ? l.email || null : null,
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
        ...(created.contactName ? { contactName: created.contactName } : {}),
        ...(created.role ? { role: created.role } : {}),
        ...(created.profileUrl ? { profileUrl: created.profileUrl } : {}),
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
