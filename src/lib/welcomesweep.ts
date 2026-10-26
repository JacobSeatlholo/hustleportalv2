import { db } from '@/lib/db'
import { searchOsmLeads } from '@/lib/osm'
import { openrouterGenerate } from '@/lib/openrouter'
import { parseJsonLoose } from '@/lib/gemini'
import { scoreLeads, curate } from '@/lib/leadscore'
import { topicFingerprint, isSouthAfricanLead, logScanRun, rememberScanResults, type RememberLead } from '@/lib/leadpool'
import { resolveProject } from '@/lib/workspace'
import { sellerTradeKeys, TRADES } from '@/lib/taxonomy'
import { isProbeEmail, isInternalEmail } from '@/lib/probe'

/**
 * The welcome sweep: a fresh signup should wake up to REAL leads already
 * waiting in the pipeline, not an empty Lead Finder.
 *
 * THE BOSS'S LAW (Task 127): reachable does not mean relevant. A record only
 * lands in a client's pipeline when it clears every gate below — and when the
 * honest result is "nothing here is worth contacting", the sweep ships zero
 * and says so. Five strong beats thirty hopeless, and three strong beats five
 * padded ones. Never padding, ever.
 *
 * Pipeline (all $0, the same primitives the discover route uses):
 *   1. Build the scan definition from the seller's saved profile (project
 *      offerings/value proposition first, industry bucket fallback) with a
 *      TARGET clause the OpenStreetMap directory can actually map. Lesson of
 *      Task 127: a vague teaser definition maps to no OSM category and dies
 *      honestly in the fallback lane; a named target keeps the map lane alive.
 *   2. OSM directory fetch (keyless, real records, no fabrications).
 *   3. AI ranking through the OpenRouter free chain (the seller's own key if
 *      they saved one, then the platform key). Ranking is the relevance brain,
 *      not decoration: a national chain branch, a street-named map node or a
 *      business that merely SURVIVES in the directory gets scored 1 and cut.
 *   4. Hard gates: South Africa only; street/suburb/landmark names dropped;
 *      the same composite bar the discover decks answer to (FIT_THRESHOLD +
 *      RELEVANCE_FLOOR); ranker 4+ when an engine ranked. Dedup against the
 *      seller's existing pipeline and inside the batch.
 *   5. Ship what passed, capped at 5, stage NEW, source TEAM, notes carry the
 *      provenance. ScanRun mode WELCOME is the marker: a shipped sweep never
 *      re-runs; a zero sweep may retry once off the nightly cron while the
 *      account is new (engines refill, mirrors recover).
 */

const SWEEP_CAP = 5
const RAW_CAP = 8
const OSMS_BUDGET_MS = 50_000
const RANK_TIMEOUT_MS = 18_000
const SHIPPED_RELOCK_DAYS = 7
const ZERO_RETRY_AFTER_HOURS = 12
const NEW_USER_WINDOW_HOURS = 72

/** Seller industry -> the buyer target the directory can map, plus a default
 * offering phrase when the profile has nothing saved. The FIRST matching
 * filter wins in the OSM mapper, so the most mappable buyer category is named
 * first and the complementary buyers ride in the text for the ranker to weigh. */
const INDUSTRY_TARGETS: { match: RegExp; target: string; offering: string }[] = [
  {
    match: /financ|insur|invest|wealth|asset manage|advis|broker|account|bookkeep|tax|consult/,
    target: 'restaurants, takeaways and professional offices',
    offering: 'financial planning, group pension schemes and business insurance advice',
  },
  {
    match: /clean|hygiene|sanit/,
    target: 'offices, medical practices and gyms',
    offering: 'contract cleaning and hygiene services',
  },
  {
    match: /security|guard|alarm|cctv/,
    target: 'shops, spazas and grocery stores',
    offering: 'security services and alarm response',
  },
  {
    match: /catering|events?|function/,
    target: 'schools, offices and event venues',
    offering: 'catering and event services',
  },
  {
    match: /construct|build|plumb|electric|renovat|roof|pav|landscap|garden/,
    target: 'building contractors, hardware stores and estate agencies',
    offering: 'construction, renovation and maintenance services',
  },
  {
    match: /\bit\b|tech|software|web|digital|marketing|advertis|print|branding|signage/,
    target: 'restaurants, salons, clinics and guest houses',
    offering: 'websites, marketing and business support services',
  },
  {
    match: /logistic|transport|courier|deliver|shuttle|removal/,
    target: 'restaurants, retailers and warehouses',
    offering: 'delivery and transport services',
  },
  {
    match: /wholesal|supply|equip|machiner/,
    target: 'restaurants, takeaways and retail shops',
    offering: 'wholesale supply and equipment services',
  },
  {
    match: /auto|car|panel|mechanic|tyre|spare/,
    target: 'car dealerships and fleet operators',
    offering: 'automotive products and services',
  },
  {
    match: /train|educat|academ|skill|courses?/,
    target: 'companies, schools and training centres',
    offering: 'training and skills development programmes',
  },
]

const DEFAULT_TARGET = 'owner-run businesses and professional practices'
const DEFAULT_OFFERING = 'products and services that help a small business grow'

/** Map nodes named after their street, suburb or landmark are directory noise,
 * not businesses. Task 127 shipped "Alan Paton Avenue" once; never again. */
const PLACEHOLDER_NAME =
  /(street|road|avenue|drive|lane|crescent|boulevard|highway|freeway|off-ramp|on-ramp|corner|plaza|mall|centre|center|terminal|station|stop|complex|building|block|tower|square|park|gardens?|ext|extension|suburb|town|city|central|cbd)$/i

function isPlaceholderName(company: string, city?: string | null): boolean {
  const name = String(company || '').trim()
  if (!name) return true
  if (PLACEHOLDER_NAME.test(name)) return true
  if (/^the\s+(street|road|avenue|drive|lane|corner|square|park)$/i.test(name)) return true
  const c = String(city || '').trim().toLowerCase()
  if (c && name.toLowerCase() === c) return true
  return false
}

export interface SweepDefinition {
  definition: string
  target: string
  offering: string
}

/** The scan definition, built from the seller's own saved profile first. */
export async function buildWelcomeDefinition(userId: string): Promise<SweepDefinition | null> {
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user || !user.city || !user.city.trim()) return null
  const project = await resolveProject(userId, null)
  const offeringSaved = project?.offerings?.trim() || project?.valueProp?.trim() || ''
  const industryText = [project?.industry, user.industry, user.businessName].filter(Boolean).join(' ')
  const bucket = INDUSTRY_TARGETS.find((b) => b.match.test(industryText.toLowerCase()))
  const target = bucket?.target || DEFAULT_TARGET
  const offering = offeringSaved || bucket?.offering || DEFAULT_OFFERING
  const sellerLine = [
    project?.name ? `Their business is called ${project.name}.` : '',
    user.industry ? `Industry: ${user.industry}.` : '',
  ].filter(Boolean).join(' ')
  const definition = `${target} in ${user.city.trim()} that need ${offering}` + (sellerLine ? `. Seller context: ${sellerLine}` : '')
  return { definition, target, offering }
}

/** A ranker verdict per raw record: index, 1..5 score, one honest sentence. */
interface RankVerdict { index: number; score: number; why?: string }

function sweepRankPrompt(definition: string, raw: { company: string; industry?: string; city?: string; phone?: string; website?: string }[]): {
  system: string
  prompt: string
} {
  const keys = sellerTradeKeys(definition)
  const labels = keys.map((k) => TRADES.find((t) => t.key === k)?.label || k).slice(0, 4)
  const tradeLine = labels.length
    ? `The seller's trade maps to: ${labels.join(', ')}. A business is a fit when its type of business buys from those trades.\n`
    : ''
  const source = raw
    .map((l, i) => `${i + 1}. company: ${l.company} | type: ${l.industry || 'unknown'}${l.city ? ` | area: ${l.city}` : ''}${l.phone ? ` | phone: ${l.phone}` : ''}${l.website ? ` | website: ${l.website}` : ''}`)
    .join('\n')
  return {
    system:
      'You are a meticulous lead qualifier for South African small businesses. You receive a numbered list of REAL businesses from the OpenStreetMap directory and a seller description. You judge which of them are WORTH THE SELLER CONTACTING. You NEVER invent a company, phone number, website or email: every field you output must come from the list. If nothing fits, return fewer entries.',
    prompt:
      `The seller offers:\n"""${definition.slice(0, 900)}"""\n\n` +
      tradeLine +
      `Score each business 1 to 5 for how likely THIS business itself buys what the seller offers:\n` +
      `5 = a realistic buyer this quarter (an owner-operator or local franchisee decides on this spend).\n` +
      `4 = plausible buyer, worth a call.\n` +
      `3 = unclear, needs research the seller did not ask for.\n` +
      `1 = not a buyer: national chain branch run from head office (banks, chain supermarkets, telecom stores), a peer who sells the same thing, a residential listing, or a street/suburb/landmark that is not even a single business.\n` +
      `Franchise venues: the LOCAL franchisee decides, score them like independents.\n\n` +
      `The real businesses:\n${source}\n\n` +
      `Answer with ONLY a JSON array, one entry per business worth 4 or 5: [{"index": 1, "score": 5, "why": "one short sentence naming what they are and why they buy"}]. Businesses scoring 3 or less are left OUT of the answer entirely. No prose around the JSON.`,
  }
}

async function rankForSweep(userId: string, definition: string, raw: { company: string; industry?: string; city?: string; phone?: string; website?: string }[]): Promise<RankVerdict[]> {
  const { system, prompt } = sweepRankPrompt(definition, raw)
  const r = await openrouterGenerate(userId, { system, prompt, temperature: 0.2, maxTokens: 900, timeoutMs: RANK_TIMEOUT_MS })
  if (!r.ok || !r.text) return []
  const parsed = parseJsonLoose<RankVerdict[]>(r.text)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((v) => Number.isFinite(v?.index) && Number.isFinite(v?.score))
    .map((v) => ({ index: Number(v.index), score: Math.max(1, Math.min(5, Number(v.score))), why: typeof v.why === 'string' ? v.why.slice(0, 300) : undefined }))
}

const normKey = (s: unknown): string => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export interface SweepResult {
  ok: boolean
  shipped: number
  skipped?: 'ineligible' | 'no_city' | 'no_definition' | 'already_swept'
  reason?: string
  companies?: string[]
  /** Where the gates cut: raw directory records -> ranker verdicts -> after
   *  the composite floors -> shipped. The boss's law made visible. */
  stats?: { raw: number; ranked: number; afterFloors: number; shipped: number }
}

/**
 * Run the welcome sweep for one user. Guarded end to end: every failure path
 * returns an honest summary, never throws into the caller's flow.
 */
export async function runWelcomeSweep(userId: string, opts: { force?: boolean } = {}): Promise<SweepResult> {
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return { ok: false, shipped: 0, skipped: 'ineligible' }
  // The bench never burns scan quota: probe/QA/house accounts are skipped
  // unless the exec explicitly forces one (verification path).
  if (!opts.force && (isProbeEmail(user.email) || isInternalEmail(user.email))) {
    return { ok: true, shipped: 0, skipped: 'ineligible', reason: 'bench account' }
  }
  if (user.accountStatus === 'SUSPENDED') return { ok: true, shipped: 0, skipped: 'ineligible', reason: 'suspended' }
  if (!user.city || !user.city.trim()) return { ok: true, shipped: 0, skipped: 'no_city' }

  // Idempotence: a shipped sweep never re-runs. A zero sweep may retry once
  // after the cooldown, only while the account is brand new.
  const prior = await db.scanRun.findMany({
    where: { userId, mode: 'WELCOME' },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { leadCount: true, createdAt: true },
  })
  const shippedPrior = prior.find((p) => p.leadCount > 0)
  if (shippedPrior) return { ok: true, shipped: 0, skipped: 'already_swept' }
  const latest = prior[0]
  if (latest) {
    const ageH = (Date.now() - latest.createdAt.getTime()) / 3_600_000
    const ageDays = ageH / 24
    if (ageDays > NEW_USER_WINDOW_HOURS / 24) return { ok: true, shipped: 0, skipped: 'ineligible', reason: 'past the new-account window' }
    if (ageH < ZERO_RETRY_AFTER_HOURS) return { ok: true, shipped: 0, skipped: 'already_swept', reason: 'zero sweep too recent, cron will retry' }
  }

  const existing = await db.lead.count({ where: { userId } })
  if (existing > 0 && !opts.force) return { ok: true, shipped: 0, skipped: 'ineligible', reason: 'pipeline already has leads' }

  const built = await buildWelcomeDefinition(userId)
  if (!built) return { ok: true, shipped: 0, skipped: 'no_definition', reason: 'no city to scan' }
  const { definition } = built
  const t0 = Date.now()
  const topicFp = topicFingerprint(definition, user.city)

  // 1-2. The real directory: real records or nothing.
  const osm = await searchOsmLeads(user.city.trim(), definition, RAW_CAP, { deadlineAt: t0 + OSMS_BUDGET_MS })
  const raw = (osm.leads || []).filter((l) => isSouthAfricanLead(l as unknown as { city?: string; country?: string; address?: string })).filter((l) => !isPlaceholderName(l.company, l.city || user.city))
  if (raw.length === 0) {
    await logScanRun(userId, topicFp, 'WELCOME', 0, false)
    return { ok: true, shipped: 0, reason: osm.note || 'the map directory came back empty for this profile', stats: { raw: 0, ranked: 0, afterFloors: 0, shipped: 0 } }
  }

  // 3. The relevance brain: rank what is real, cut what is not a buyer.
  const verdicts = await rankForSweep(userId, definition, raw)
  const byIndex = new Map(verdicts.map((v) => [v.index - 1, v]))

  // 4. The hard gates. curate enforces FIT_THRESHOLD + RELEVANCE_FLOOR; the
  //    ranker bar applies when an engine actually ranked this run.
  const ranked = raw.map((l, i) => {
    const v = byIndex.get(i)
    return { ...l, score: v?.score, why: v?.why || l.why }
  })
  const scored = scoreLeads(ranked as unknown as Parameters<typeof scoreLeads>[0], { definition }) as unknown as Array<(typeof ranked)[number] & { fitScore?: number; relevanceFit?: number }>
  const curated = curate(scored as never, SWEEP_CAP, user.city.trim()).deck as typeof scored
  let passing = curated.filter((l) => {
    if (verdicts.length > 0 && (l.score == null || l.score < 4)) return false
    return true
  })
  // Dedup inside the batch and against the seller's own pipeline.
  const have = await db.lead.findMany({ where: { userId }, select: { company: true, city: true }, take: 200 })
  const seen = new Set(have.map((l) => `${normKey(l.company)}|${normKey(l.city)}`))
  passing = passing.filter((l) => {
    const k = `${normKey(l.company)}|${normKey(l.city || user.city)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  passing.sort((a, b) => (b.score || 0) - (a.score || 0) || (b.fitScore || 0) - (a.fitScore || 0))
  const ship = passing.slice(0, SWEEP_CAP)

  // Feed the shared pool from the REAL records that passed the region and
  // placeholder gates (same capture path as the discover decks, before
  // curation): the pool is internal, the ranker re-judges at every serve, so
  // real records captured here make every later scan smarter.
  try {
    await rememberScanResults({
      topicFp,
      area: user.city.trim(),
      source: 'OSM',
      leads: raw as unknown as RememberLead[],
      budgetUntil: t0 + 54_000,
    })
  } catch { /* pool capture must never block the seller's welcome */ }

  // 5. Ship. Zero padding: what passed is what lands.
  const project = await resolveProject(userId, null)
  const stamp = new Date().toISOString().slice(0, 10)
  if (ship.length > 0 && project) {
    await db.lead.createMany({
      data: ship.map((l) => ({
        userId,
        projectId: project.id,
        company: String(l.company).slice(0, 120),
        contactName: l.contactName || null,
        email: l.email || null,
        phone: l.phone || null,
        website: l.website || null,
        industry: l.industry || null,
        city: l.city || user.city,
        source: 'TEAM',
        stage: 'NEW',
        notes: `Welcome sweep ${stamp} — ${l.why || 'matched to your profile'}. Sourced from the OpenStreetMap directory, relevance-checked before loading.`,
        score: typeof l.fitScore === 'number' ? Math.round(l.fitScore) : null,
      })),
    })
  }
  await logScanRun(userId, topicFp, 'WELCOME', ship.length, false)
  return { ok: true, shipped: ship.length, companies: ship.map((l) => l.company), stats: { raw: raw.length, ranked: verdicts.length, afterFloors: passing.length, shipped: ship.length } }
}

/** The nightly safety net: brand-new accounts whose signup sweep came back
 * empty (drained engines, refusing mirrors) get one more turn while the
 * engines are fresh. Bounded per night so the shared engines stay calm. */
export async function sweepPendingWelcome(maxUsers = 3): Promise<Array<{ email: string; result: SweepResult }>> {
  const cut = new Date(Date.now() - NEW_USER_WINDOW_HOURS * 3_600_000)
  const fresh = await db.user.findMany({
    where: { createdAt: { gte: cut }, accountStatus: { not: 'SUSPENDED' } },
    select: { id: true, email: true },
    orderBy: { createdAt: 'desc' },
    take: 40,
  })
  const out: Array<{ email: string; result: SweepResult }> = []
  for (const u of fresh) {
    if (out.length >= maxUsers) break
    if (isProbeEmail(u.email) || isInternalEmail(u.email)) continue
    const leadCount = await db.lead.count({ where: { userId: u.id } })
    if (leadCount > 0) continue
    const prior = await db.scanRun.findFirst({
      where: { userId: u.id, mode: 'WELCOME', leadCount: { gt: 0 } },
      select: { id: true },
    })
    if (prior) continue
    const r = await runWelcomeSweep(u.id)
    out.push({ email: u.email, result: r })
  }
  return out
}
