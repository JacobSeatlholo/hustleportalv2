import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'
import { deepseekGenerate } from '@/lib/deepseek'
import { openrouterGenerate } from '@/lib/openrouter'
import { zaiGenerate, getUserZaiKey } from '@/lib/zai'
import { searchLeads } from '@/lib/explee'
import { searchOsmLeads } from '@/lib/osm'
import { planState, FREE_LIMITS, upgradeJson } from '@/lib/limits'
import { resolveProject } from '@/lib/workspace'
import {
  checkScanAllowance,
  cityMatches,
  isSouthAfricanLead,
  logScanRun,
  recentTopicScan,
  rememberScanResults,
  serveFromPool,
  serveExpleeBoost,
  topicFingerprint,
  userSavedKeys,
  type RememberLead,
  type VerifyStamp,
} from '@/lib/leadpool'
import { categoryWeights, userDismissedKeys } from '@/lib/leadsignal'
import { curate, scoreLeads } from '@/lib/leadscore'
import { deadEmailMap } from '@/lib/reach'
import { sellerTradeKeys, TRADES } from '@/lib/taxonomy'

export const maxDuration = 60

/**
 * POST /api/leads/discover, source REAL leads.
 *
 * ENGINE CHAIN (first one with real results wins):
 *  1. A PERSONAL z.ai key (the seller's own, under Integrations) puts GLM in
 *     front, their credits, their control, about two cents per scan. The
 *     PLATFORM GLM pool never fronts a grounded scan: its web search tool
 *     draws on a separate cash balance, and while that is unfunded a platform
 *     led scan always dies on the same refusal and drags a billing note the
 *     seller cannot act on into every result. Without a personal key, Gemini
 *     with Google Search grounding leads (22s budget).
 *  2. The other engine backs up automatically: z.ai GLM brings live Web Search
 *     grounding that ignores Google's quota mood; Gemini grounds on Google
 *     Search when z.ai can't answer. The GLM engine takes the lead spot back
 *     automatically the moment its search balance is funded.
 *  3. OpenStreetMap real directory (keyless), ranked by AI with the anti
 *     fabrication guarantee: the seller's own DeepSeek key leads, the GLM
 *     engine on the already paid token pack carries everyone else. Ranks
 *     reality, never supplies contact facts.
 *  4. Explee verified data when configured.
 *
 * No fabricated companies, no synthetic contacts: real results or an honest
 * note naming the most actionable cause.
 *
 * TEASER: with no definition supplied, the AI builds the search from the seller's saved
 * profile (website, offerings, value proposition) and finds a few real businesses in the
 * seller's area that likely need what they sell, the taste that sells the R199 plan.
 */

interface AiLead {
  company?: string
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
}

function clean(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length ? s : undefined
}

function saneEmail(v?: string): string | undefined {
  const s = clean(v)
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined
  if (/example\.(com|org|net)|your(email)?\.|domain\.com/i.test(s)) return undefined
  return s
}

function sanePhone(v?: string): string | undefined {
  const s = clean(v)
  if (!s) return undefined
  const digits = s.replace(/[^\d+]/g, '')
  // ZA numbers: +27XXXXXXXXX (12 chars incl +) or 0XXXXXXXXX (10), allow a little slack
  if (digits.replace(/\D/g, '').length < 9) return undefined
  return s
}

function saneWebsite(v?: string): string | undefined {
  const s = clean(v)
  if (!s) return undefined
  return s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
}

/** A public profile page (LinkedIn, Facebook, team page, directory), copied verbatim from search results, never constructed. */
function saneProfileUrl(v?: string): string | undefined {
  const s = clean(v)
  if (!s) return undefined
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`
  if (!/^https?:\/\/[^\s]+\.[^\s]{2,}$/i.test(url)) return undefined
  if (url.length > 300) return undefined
  return url
}

/** A person's name as seen in a public source: letters (and common separators), no filler words. */
function sanePersonName(v?: string): string | undefined {
  const s = clean(v)
  if (!s || s.length < 3 || s.length > 60) return undefined
  if (!/^[\p{L}][\p{L}'.\- ]+$/u.test(s)) return undefined
  if (/^(n\/a|none|unknown|not found|no name)$/i.test(s.trim())) return undefined
  return s
}

/**
 * Read the seller's own website so the hunt is grounded in what they actually
 * sell. Best effort, 8s cap: title, description and visible text, enough for
 * the AI to reason about the offering. Never blocks the search on failure.
 */
async function readSellerSite(raw: string): Promise<{ url: string; text: string } | null> {
  const host = saneWebsite(raw)
  if (!host || !/\.[a-z]{2,}$/i.test(host)) return null
  const url = `https://${host}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HustlePortalBot/1.0)' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    })
    if (!res.ok) return { url, text: '' }
    const html = (await res.text()).slice(0, 120_000)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200)
    const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] || ''
    const title = html.match(/<title[^>]*>([^<]+)/i)?.[1] || ''
    return { url, text: [title.trim(), meta.trim(), text].filter(Boolean).join(' · ').slice(0, 1400) }
  } catch {
    return { url, text: '' }
  }
}

/** Shared landing for AI answers: strict cleanup so no fabricated contact survives. */
async function parseLeadList(text: string, cap: number, city: string) {
  const parsed = parseJsonLoose<{ leads?: AiLead[] }>(text)
  const pre = (parsed?.leads || [])
    .map((l) => ({
      company: clean(l.company),
      contactName: sanePersonName(l.contactName),
      role: clean(l.role)?.slice(0, 60),
      profileUrl: saneProfileUrl(l.profileUrl),
      email: saneEmail(l.email),
      phone: sanePhone(l.phone),
      website: saneWebsite(l.website),
      industry: clean(l.industry),
      // the engine's own words only: the seller's city is stamped AFTER the
      // region gate, so a filled city can never disguise a foreign face
      city: clean(l.city),
      why: clean(l.why),
      score: typeof l.score === 'number' ? Math.max(1, Math.min(5, Math.round(l.score))) : undefined,
    }))
    // a lead without a company name is unusable, drop it (no fabrication)
    .filter((l): l is typeof l & { company: string } => Boolean(l.company))
    // REGION GATE: a foreign footprint never reaches an answer (the Italy lesson)
    .filter((l) => isSouthAfricanLead(l))
    .map((l) => ({ ...l, city: l.city || (city || undefined) }))
  // REACHABILITY GATE ON THE ANSWER: an address the mail system can provably
  // never deliver to (dead domain) never reaches the seller's screen, the
  // save or the till. DNS only, bounded, cached — $0 and no AI quota.
  const deadEmails = await deadEmailMap(pre.map((l) => l.email), 16)
  const seen = new Set<string>()
  return pre
    .filter((l) => !l.email || !deadEmails.has(l.email.toLowerCase()))
    .filter((l) => {
      const key = l.company.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, cap)
}

/**
 * THE DECK, where every serve lane funnels through: the Tinder math scores
 * each face (graph fit blended with the AI ranker's opinion, verification,
 * freshness, reachability, and the seller's own learned taste), faces below
 * the relevance bar fall away, and a thin deck says so honestly instead of
 * padding. Five strong beats thirty hopeless, every time.
 */
function buildDeck(
  leads: OutLead[],
  definition: string,
  weights: Map<string, number>,
  cap: number,
  area: string
): { deck: OutLead[]; scarcity?: string } {
  const scored = scoreLeads(leads, { definition, weights }) as OutLead[]
  return curate(scored, cap, area)
}

/**
 * Shared ranking prompt: the AI only decides WHICH source businesses fit the
 * seller and WHY. Every contact field in the answer is copied verbatim from
 * the source record it matched, and any answer that does not map back to a
 * real record is dropped. This is the anti fabrication guarantee: the engine
 * ranks reality, it never supplies facts.
 */
function rankingPrompt(definition: string, raw: AiLead[], cap: number) {
  const keys = sellerTradeKeys(definition)
  const labels = keys
    .map((k) => TRADES.find((t) => t.key === k)?.label || k)
    .slice(0, 4)
  const tradeLine = labels.length
    ? `The seller's trade maps to: ${labels.join(', ')}. A business is a fit when its type of business buys from those trades.\n`
    : ''
  const source = raw
    .map((l, i) =>
      `${i + 1}. company: ${l.company} | type: ${l.industry || 'unknown'}${l.city ? ` | area: ${l.city}` : ''}${l.phone ? ` | phone: ${l.phone}` : ''}${l.website ? ` | website: ${l.website}` : ''}`
    )
    .join('\n')
  return {
    system:
      'You are a meticulous lead qualifier for South African small businesses. You receive a numbered list of REAL businesses from the OpenStreetMap directory and a seller description. You pick which of those real businesses are worth the seller contacting. You NEVER invent a company, phone number, website or email: every field you output must come from the list. Only businesses physically located in South Africa qualify. If nothing fits, return fewer leads.',
    prompt:
      `The seller offers:\n"""${definition.slice(0, 900)}"""\n\n` +
      tradeLine +
      `Real businesses from the map directory:\n${source}\n\n` +
      `Pick up to ${cap} businesses from the list above that would realistically buy what the seller offers.\n` +
      `Rules:\n` +
      `- company: copy the name EXACTLY as it appears in the list.\n` +
      `- score: 1 to 5 fit for the seller. 5 = exactly the business type this seller dreams of as a client, its kind of business directly buys what they sell. 4 = clearly buys it. 3 = plausible but unproven. 2 = a stretch. 1 = wrong industry entirely. Reserve 5 for direct consumers of the offering.\n` +
      `- A business that DOES the same thing the seller does is a peer, not a client: it serves itself. Score it 1 or 2 unless the seller's description explicitly says they sell to their own trade.\n` +
      `- why: one short line grounded in the type and area shown in the list.\n` +
      `- never output phone, website or email. Those stay attached from the source automatically.\n` +
      `- drop businesses that clearly do not fit. Fewer, better leads win.\n` +
      `Return ONLY JSON: {"leads":[{"company":"","industry":"","why":"","score":3}]}`,
  }
}

/** Shared verifier: every answer company must map back to a real source record. */
function matchRankedToSource(text: string, raw: AiLead[], cap: number): (AiLead & { company: string })[] | null {
  const parsed = parseJsonLoose<{ leads?: AiLead[] }>(text)
  const byKey = new Map<string, AiLead>()
  for (const r of raw) byKey.set(normKey(r.company || ''), r)
  const out: (AiLead & { company: string })[] = []
  const seen = new Set<string>()
  for (const l of parsed?.leads || []) {
    const src = byKey.get(normKey(clean(l.company) || ''))
    if (!src || !src.company) continue // not a real record: dropped, never surfaced
    const key = normKey(src.company)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({
      company: src.company,
      industry: clean(l.industry) || src.industry,
      city: src.city,
      phone: src.phone,
      website: src.website,
      email: src.email,
      contactName: src.contactName,
      why: clean(l.why)?.slice(0, 220),
      score: typeof l.score === 'number' ? Math.max(1, Math.min(5, Math.round(l.score))) : 3,
    })
  }
  if (out.length === 0) return null // qualifier rejected everything: the raw floor beats an empty win
  out.sort((a, b) => (b.score || 0) - (a.score || 0))
  return out.slice(0, cap)
}

/**
 * DeepSeek enrichment of REAL map records: the DeepSeek flavour of the shared
 * ranking contract above. Runs only when the seller saved their own DeepSeek
 * key (their credits, their control).
 */
async function enrichOsmWithDeepseek(
  userId: string,
  definition: string,
  raw: AiLead[],
  cap: number,
  t0: number
): Promise<{ leads: (AiLead & { company: string })[]; notice?: string } | null> {
  if (raw.length === 0) return null
  const remaining = t0 + 54_000 - Date.now()
  if (remaining < 6_000) return null // no runway to rank: hand back the raw real records
  const { system, prompt } = rankingPrompt(definition, raw, cap)
  const res = await deepseekGenerate(userId, {
    system,
    prompt,
    json: true,
    temperature: 0.3,
    maxTokens: 1400,
    timeoutMs: Math.max(6_000, Math.min(22_000, remaining - 1_000)),
  })
  if (!res.ok) {
    // Real failure (no key, credits out, busy): the raw real records still flow.
    // Credit and key problems are worth a gentle mention so the user can act.
    if (res.reason === 'BALANCE' || res.reason === 'KEY_INVALID') return { leads: [], notice: res.error }
    return null
  }
  const leads = matchRankedToSource(res.text, raw, cap)
  if (!leads) return null
  return { leads }
}

/**
 * Free engine ranking (OpenRouter :free models, STRICT $0): the same ranking
 * contract, zero cost, no Google quota and no GLM token needed. The seller's
 * own OpenRouter key leads, the platform key follows. The free engine cannot
 * browse: it only ranks the REAL records handed to it, contact facts stay
 * verbatim from the directory, the anti fabrication law holds.
 */
async function enrichOsmWithOpenrouter(
  userId: string,
  definition: string,
  raw: AiLead[],
  cap: number,
  t0: number,
  trace?: string[]
): Promise<{ leads: (AiLead & { company: string })[] } | null> {
  if (raw.length === 0) return null
  const remaining = t0 + 54_000 - Date.now()
  if (remaining < 8_000) return null
  const { system, prompt } = rankingPrompt(definition, raw, cap)
  const res = await openrouterGenerate(userId, {
    system,
    prompt,
    temperature: 0.3,
    maxTokens: 1400,
    timeoutMs: Math.max(8_000, Math.min(18_000, remaining - 1_000)),
    trace,
  })
  // Any refusal (no key, daily cap, pacing) simply lets the next rung take it:
  // raw real records still flow, the noise stays out of the seller's answer.
  if (!res.ok) return null
  const leads = matchRankedToSource(res.text, raw, cap)
  if (!leads) return null
  return { leads }
}

/**
 * GLM enrichment of REAL map records: the same ranking contract, carried by
 * the GLM engine on PLAIN generation (no web search tool, no Google, no
 * DeepSeek key). The token pack behind the platform key already pays for this,
 * so ranking works for every seller with zero setup, even on days when both
 * grounded web engines are resting their quotas.
 */
async function enrichOsmWithGlm(
  userId: string,
  definition: string,
  raw: AiLead[],
  cap: number,
  t0: number,
  trace?: string[]
): Promise<{ leads: (AiLead & { company: string })[] } | null> {
  if (raw.length === 0) return null
  const remaining = t0 + 54_000 - Date.now()
  if (remaining < 6_000) return null
  const { system, prompt } = rankingPrompt(definition, raw, cap)
  const res = await zaiGenerate(userId, {
    system,
    prompt,
    json: true,
    temperature: 0.3,
    maxTokens: 1400,
    timeoutMs: Math.max(6_000, Math.min(20_000, remaining - 1_000)),
    trace,
  })
  // Any refusal (pacing, credits, no key) simply hands the raw real records
  // through: real unranked leads beat no leads, and the balance noise stays out.
  if (!res.ok) return null
  const leads = matchRankedToSource(res.text, raw, cap)
  if (!leads) return null
  return { leads }
}

/**
 * Map record ranking, engine agnostic: the seller's own DeepSeek key leads,
 * the GLM engine (token pack, zero setup) carries everyone else, and raw real
 * records flow when no engine can answer. Returns the engine that ranked, so
 * the note tells the truth.
 */
async function enrichOsmWithAi(
  userId: string,
  definition: string,
  raw: AiLead[],
  cap: number,
  t0: number,
  trace?: string[]
): Promise<{ leads: (AiLead & { company: string })[]; notice?: string; engine: string } | null> {
  const ds = await enrichOsmWithDeepseek(userId, definition, raw, cap, t0)
  if (ds && ds.leads.length > 0) return { ...ds, engine: 'DeepSeek' }
  const or = await enrichOsmWithOpenrouter(userId, definition, raw, cap, t0, trace)
  if (or && or.leads.length > 0) return { ...or, engine: 'the HustlePortal matching engine' }
  const glm = await enrichOsmWithGlm(userId, definition, raw, cap, t0, trace)
  if (glm && glm.leads.length > 0) return { ...glm, engine: 'the HustlePortal matching engine' }
  // DeepSeek's actionable complaint (the seller's own key out of credits or
  // rejected) survives only when GLM had nothing either.
  if (ds?.notice) return { leads: [], notice: ds.notice, engine: '' }
  return null
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * THE PEOPLE PASS, one grounded AI call that names the humans behind the
 * businesses the scan just found. Directory records (the OSM path) carry
 * phones but rarely owner names, yet owner names are publicly listed all over
 * the web: the business's own site, LinkedIn and Facebook pages, directories,
 * news. The AI looks ONLY at what search actually surfaced, and every answer
 * company must map back to a real lead from this scan (the same anti
 * fabrication contract as ranking: reality in, reality out).
 *
 * Budget rules: it runs ONLY when the scan clock has runway left, and in
 * PARALLEL with the map ranking call so it never adds wall time. A refusal,
 * a timeout or an empty answer simply means the leads flow without names,
 * the scan itself never waits on this pass to succeed.
 */
async function enrichWithPeople(
  userId: string,
  leads: (AiLead & { company: string })[],
  t0: number,
  trace?: string[]
): Promise<Map<string, { contactName: string; role?: string; profileUrl?: string }>> {
  const out = new Map<string, { contactName: string; role?: string; profileUrl?: string }>()
  const candidates = leads.filter((l) => !l.contactName).slice(0, 6)
  if (candidates.length === 0) return out
  const remaining = t0 + 54_000 - Date.now()
  if (remaining < 13_000) return out // no runway: leads flow without names, honestly
  const list = candidates
    .map((l, i) => `${i + 1}. ${l.company}${l.city ? ` (${l.city})` : ''}${l.website ? ` website: ${l.website}` : ''}`)
    .join('\n')
  try {
    const res = await geminiGenerate(userId, {
      search: true,
      json: true,
      system:
        'You find the PEOPLE who run South African businesses, grounded in live web search results. You report ONLY names that actually appear in a public source you saw (the business\'s own website, public LinkedIn pages, Facebook pages, directories, news articles). NEVER guess a name, NEVER construct an email, phone or profile link. If no person is publicly named for a business, skip that business.',
      prompt:
        `For each business below, find the publicly named owner, founder, manager or decision maker:\n${list}\n\n` +
        `Rules:\n` +
        `- company: copy the business name EXACTLY as listed above.\n` +
        `- contactName: the person's name exactly as the source writes it.\n` +
        `- role: Owner, Founder, Manager, Buyer and so on, as the source says.\n` +
        `- profileUrl: ONLY when you actually saw a public profile page for this person (LinkedIn, Facebook, the company team page, a directory listing). Copy the web address exactly.\n` +
        `- Skip any business where you found no publicly named person.\n` +
        `Return ONLY JSON: {"people":[{"company":"","contactName":"","role":"","profileUrl":""}]}`,
      maxOutputTokens: 900,
      timeoutMs: 12_000,
      trace,
    })
    if (!res.ok) return out // quota mood, drained day: no names, no noise
    const parsed = parseJsonLoose<{ people?: AiLead[] }>(res.text)
    const byKey = new Map(candidates.map((l) => [normKey(l.company), l]))
    for (const p of parsed?.people || []) {
      const name = sanePersonName(p?.contactName)
      const src = byKey.get(normKey(clean(p?.company) || ''))
      if (!name || !src) continue // not a real company of this scan, or not a real name: dropped
      const role = clean(p?.role)?.slice(0, 60)
      const profileUrl = saneProfileUrl(p?.profileUrl)
      out.set(normKey(src.company), { contactName: name, ...(role ? { role } : {}), ...(profileUrl ? { profileUrl } : {}) })
    }
  } catch {
    /* the people pass is sugar: never fatal */
  }
  return out
}

/** Attach named humans to the leads they belong to. Never clobbers a name another engine already found. */
function mergePeople<T extends OutLead>(leads: T[], people: Map<string, { contactName: string; role?: string; profileUrl?: string }>): T[] {
  if (people.size === 0) return leads
  return leads.map((l) => {
    if (l.contactName) return l
    const p = people.get(normKey(l.company || ''))
    return p ? { ...l, contactName: p.contactName, ...(p.role ? { role: p.role } : {}), ...(p.profileUrl ? { profileUrl: p.profileUrl } : {}) } : l
  })
}

/** A lead as it leaves the route: engine facts + pool verification chips. */
type OutLead = {
  company?: string
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
  fitScore?: number
  categoryKey?: string | null
}

/** Attach the pool's verification chips, known humans and the area mark to what the engines just found. */
function decorateLeads<T extends OutLead>(
  leads: T[],
  stamps: Map<string, VerifyStamp>,
  city?: string
): (T & { verified?: string; seenAgo?: string; verifyScore?: number; local?: boolean })[] {
  return leads.map((l) => {
    const s = l.company ? stamps.get(normKey(l.company)) : undefined
    const merged = s
      ? {
          ...l,
          verified: s.verified,
          seenAgo: s.seenAgo,
          verifyScore: s.verifyScore,
          // The team already knows a human at this company: the seller sees
          // who to ask for, without a second search.
          ...(s.contactName && !l.contactName ? { contactName: s.contactName } : {}),
          ...(s.role && !l.role ? { role: s.role } : {}),
          ...(s.profileUrl && !l.profileUrl ? { profileUrl: s.profileUrl } : {}),
        }
      : l
    return city && cityMatches(merged.city, city) ? { ...merged, local: true } : merged
  })
}

/**
 * The team verified floor: when an answer comes up short of the ask, active
 * contacts our own outreach already reached (real companies, real replies on
 * real campaigns) top it up. Only ever fills the shortfall, never a company
 * already on the answer or in the seller's pipeline. Each topped lead wears
 * its own honest badge on the card. LOCATION IS VITAL: with a named city the
 * boost serves in area faces only, and a GPS pin without a city name reads
 * the pool's own mind, no coordinates to compare against, so the boost
 * steps aside and the pin grounded engines carry the answer instead.
 */
async function topUpWithTeamVerified(
  leads: OutLead[],
  cap: number,
  city: string,
  excludeKeys: Set<string>,
  matchText: string,
  allowBoost = true
): Promise<{ leads: OutLead[]; boosted: number }> {
  const room = cap - leads.length
  if (room <= 0 || !allowBoost) return { leads, boosted: 0 }
  const have = new Set(leads.map((l) => normKey(l.company || '')))
  const boost = await serveExpleeBoost({
    cap: room,
    excludeKeys: new Set([...excludeKeys, ...have]),
    city: city || undefined,
    matchText,
  })
  const fresh = boost.filter((b) => !have.has(normKey(b.company || '')))
  if (fresh.length === 0) return { leads, boosted: 0 }
  return { leads: [...leads, ...fresh], boosted: fresh.length }
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const requested = Math.min(Math.max(parseInt(body.limit) || 10, 1), 30)
  // Free plan: 5 real leads per search, always. Wider nets live on Operator.
  // Enforced BEFORE the search so nobody burns quota on a search they cannot keep.
  const { paid } = await planState(userId)
  if (!paid && requested > FREE_LIMITS.discoverLeads) {
    return upgradeJson('discover', FREE_LIMITS.discoverLeads)
  }
  const cap = requested
  let definition = String(body.definition || '').trim()
  let city = String(body.city || '').trim()
  // GPS radius mode: the client tags the user's live position (CityField "Tag location")
  // and the search concentrates on businesses within ~5 km of that pin.
  const lat = Number.isFinite(parseFloat(body.lat)) ? parseFloat(body.lat) : undefined
  const lng = Number.isFinite(parseFloat(body.lng)) ? parseFloat(body.lng) : undefined
  const hasPin = lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // THE LEARNING LOOP: dismissed faces never serve again, and the seller's
  // per trade taste multipliers ride on every deck this scan builds.
  const [savedKeys, dismissedKeys, weights] = await Promise.all([
    userSavedKeys(userId),
    userDismissedKeys(userId),
    categoryWeights(userId),
  ])
  const excludeKeys = new Set([...savedKeys, ...dismissedKeys])

  // TEASER: no definition → build the search from the seller's saved profile (website first).
  // Grounds on the REQUESTED workspace (Lead Finder dropdown), default workspace otherwise.
  let teaser = false
  if (!definition) {
    const project = await resolveProject(userId, body.projectId ?? null)
    const offering = project?.offerings?.trim() || project?.valueProp?.trim() || ''
    const sellerLine = [
      project?.website ? `Their website is ${project.website}.` : '',
      project?.name ? `Their business is called ${project.name}.` : '',
      project?.industry ? `They operate in: ${project.industry}.` : '',
      user.industry ? `Industry: ${user.industry}.` : '',
    ].filter(Boolean).join(' ')
    if (offering || sellerLine) {
      teaser = true
      definition =
        `Businesses that would realistically buy: ${offering || project?.industry || user.industry || 'their product or service'}` +
        (sellerLine ? `. Seller context: ${sellerLine}` : '')
      city = city || user.city || ''
    }
  }
  if (!definition) {
    return NextResponse.json(
      { error: 'Describe who you want to sell to, or save your website in Profile so the AI can scout for you.' },
      { status: 400 }
    )
  }

  // THE POOL: fingerprint the seller's own words + area BEFORE the seller site
  // context is appended, so every seller describing the same client in the same
  // area shares one pool topic. The first scan of a topic pays the engines;
  // every seller after that serves free. That is what keeps quota spend flat
  // while the user base grows.
  const topicFp = topicFingerprint(definition, city, hasPin ? lat : undefined, hasPin ? lng : undefined)
  const areaLabel = hasPin ? (city ? `${city} area` : 'Your area') : city && !/^anywhere/i.test(city) ? city : 'South Africa'

  // Guardrails: a short breath between scans and a daily allowance keep one
  // account (or one runaway loop) from hammering the engines the whole
  // customer base shares. Both are DB backed, so they survive serverless churn.
  const gate = await checkScanAllowance(userId)
  if (!gate.ok) {
    return NextResponse.json(
      {
        error:
          gate.reason === 'daily'
            ? "You have used today's scan allowance. It refills after midnight, South African time."
            : 'Your scan door is catching its breath. Give it a few seconds and go again.',
      },
      { status: 429, headers: { 'Retry-After': String(gate.reason === 'cooldown' ? gate.waitSeconds : 60) } }
    )
  }

  // Pool first: enough fresh verified leads for this topic that the seller has
  // never saved? Serve instantly, zero engine calls, zero quota burn. A topic
  // another seller scanned in the last few minutes serves warm while the pool
  // grows. Rotation: least recently served faces first, so scanning again keeps
  // meeting businesses the seller has never contacted.
  // The boost may only leave home when the scan says where home is: a GPS pin
  // without a city name gives the team floor nothing to match against.
  const boostAllowed = !hasPin || Boolean(city)
  let pooled: OutLead[] = await serveFromPool({ topicFp, cap, excludeKeys, city: city || undefined })
  let poolBoosted = 0
  if (pooled.length < cap) {
    const up = await topUpWithTeamVerified(pooled, cap, city, excludeKeys, definition, boostAllowed)
    pooled = up.leads
    poolBoosted = up.boosted
  }
  if (pooled.length >= cap) {
    const { deck, scarcity } = buildDeck(pooled, definition, weights, cap, areaLabel)
    await logScanRun(userId, topicFp, 'POOL', deck.length, true)
    return NextResponse.json({
      leads: deck,
      mode: deck.length ? 'POOL' : 'SCARCE',
      source: 'POOL',
      fromPool: true,
      ...(scarcity ? { note: scarcity } : { note: 'Fresh faces from the verified lead pool. Every business here was confirmed on a recent scan and none are already in your pipeline. Scan again anytime and the pool keeps rotating in businesses you have not met yet.' + (poolBoosted > 0 ? ` Plus ${poolBoosted} team verified contact${poolBoosted === 1 ? '' : 's'} our own outreach confirmed.` : '') }),
    })
  }
  if (pooled.length > 0 && (await recentTopicScan(topicFp, 10))) {
    const { deck, scarcity } = buildDeck(pooled, definition, weights, cap, areaLabel)
    await logScanRun(userId, topicFp, 'WARM', deck.length, true)
    return NextResponse.json({
      leads: deck,
      mode: deck.length ? 'POOL' : 'SCARCE',
      source: 'POOL',
      fromPool: true,
      ...(scarcity
        ? { note: scarcity }
        : {
            note:
              `Served while the pool warms up: a recent scan just mapped this ground, so these ${deck.length} verified leads are ready now. Your next scan in a few minutes brings fresh faces too.` +
              (poolBoosted > 0 ? ` Plus ${poolBoosted} team verified contact${poolBoosted === 1 ? '' : 's'} our own outreach confirmed.` : ''),
          }),
    })
  }

  // The seller's website grounds the whole hunt: we read what they actually sell
  // (title, meta description, on-page text) and hand it to the AI as context.
  const sellerSiteInput = String(body.website || '').trim()
  const sellerSite = sellerSiteInput ? await readSellerSite(sellerSiteInput) : null
  if (sellerSite) {
    const siteContext = sellerSite.text
      ? `The seller's website is ${sellerSite.url}. What their site says about them: """${sellerSite.text}"""`
      : `The seller's website is ${sellerSite.url} (the page could not be read, judge only from the web address).`
    definition = `${definition}\n\nSeller context: ${siteContext}`
  }
  const area = city && !/^anywhere/i.test(city) ? city : 'South Africa'
  const pinArea = hasPin
    ? `within a 5 km radius of GPS pin ${lat!.toFixed(4)},${lng!.toFixed(4)}${city ? ` (${city}, South Africa)` : ' (South Africa)'}, use the coordinates to reason about the neighbourhood, suburb and surrounding streets`
    : null

  const buildSearch = () => ({
    search: true,
    json: true,
    system:
      'You are a meticulous B2B lead researcher for South African small businesses. You are grounded in live web search results. You report ONLY businesses that actually exist and are publicly findable, you NEVER invent a company name, website, phone number, email or a person\'s name. When unsure, return fewer leads rather than risk a fake one. South Africa ONLY: every business you report must be physically located in South Africa. If a candidate sits outside South Africa, drop it, even when its website looks relevant. Townships, suburbs and metros all count.',
    prompt:
      `Find up to ${cap} real businesses ${pinArea || `in ${area}`} that are likely to need what this seller offers:\n"""${definition}"""\n\n` +
      `Rules:\n` +
      `- AREA IS THE PROMISE: every business must sit inside ${pinArea || area} or its immediate surroundings. Finding fewer real ones there beats padding the list with businesses from other cities. Never report a business outside South Africa.\n` +
      `- REAL businesses only, grounded in the search results you actually saw (company websites, directories, Google Business listings, Facebook pages, news).\n` +
      `- PEOPLE ARE THE PRIZE: a named human beats a switchboard. When the results publicly name the owner, founder or decision maker of a business, include contactName (their real name as written), role (Owner, Manager, Buyer and so on) and profileUrl ONLY when the results show a public profile page for them (LinkedIn, Facebook, the company team page, a directory). Copy every field exactly as you saw it. NEVER construct or guess a name or a link.\n` +
      `- CONTACT DETAILS ARE THE PRIZE: for every business include its website, and include its phone number and email address whenever they appear in the results you saw (Google Business listings, directory pages, the business's own site). Prefer businesses whose phone or email is actually visible over ones with none.\n` +
      `- NEVER construct an address from a pattern, if the phone/email is not in the results, omit the field.\n` +
      `- "why" = one line on why THIS business likely needs the seller (reference what you saw).\n` +
      `- A business that offers the same service the seller offers is NOT a buyer (it serves itself). Score it 1 or 2, unless the seller's description explicitly says they sell to their own trade.\n` +
      `- score = 1 to 5 fit for the seller: 5 means this type of business directly buys what the seller sells, 1 means wrong industry. When unsure, score low, the deck only serves what clears the relevance bar.\n` +
      `Return ONLY JSON, omitting any field you could not verify:\n` +
      `{"leads":[{"company":"","industry":"","city":"","website":"","phone":"","email":"","contactName":"","role":"","profileUrl":"","why":"","score":3}]}`,
  })

  const t0 = Date.now()

  // WHO LEADS THE SCAN: a PERSONAL z.ai key (the seller's own credits, their
  // control) puts the GLM engine in front. The platform GLM pool stays OUT of
  // the lead spot: its web search tool draws on a separate cash balance, and
  // while that is unfunded a platform led scan always dies on the same refusal
  // and drags its billing note into every result. Gemini (the seller's own key
  // or the platform key) leads instead; the GLM engine keeps its place as the
  // automatic second engine and takes the lead back the moment its search
  // balance is funded.
  const personalZai = Boolean(await getUserZaiKey(userId))
  const zaiFirst = personalZai

  const runGeminiScan = () => geminiGenerate(userId, { ...buildSearch(), timeoutMs: 22_000, trace: geminiTrace })
  const geminiTrace: string[] = []
  const glmTrace: string[] = []
  const runZaiScan = () => {
    const remaining = t0 + 44_000 - Date.now()
    return remaining > 8_000
      ? zaiGenerate(userId, {
          ...buildSearch(),
          search: true,
          json: true,
          // Small nets get small reports: a tighter request fits under the
          // token ceilings that fresh GLM accounts start with.
          maxTokens: cap <= 3 ? 900 : 1600,
          // Two doors plus a REAL 15 to 25 second grounded generation need
          // more runway than a single door ever did.
          timeoutMs: Math.min(34_000, remaining),
          trace: glmTrace,
        })
      : Promise.resolve(null)
  }

  const aiSearchResponse = async (
    leads: Awaited<ReturnType<typeof parseLeadList>>,
    engine: 'gemini' | 'zai',
    notice?: string,
    zaiEndpoint?: 'z.ai' | 'zhipu'
  ): Promise<NextResponse> => {
    // Capture + verify: what the engines found lands in the shared pool
    // (deduped, phones normalized, websites pinged while budget allows), then
    // the answer tops up with fresh pool faces the seller has never saved.
    const stamps = await rememberScanResults({
      topicFp,
      area: areaLabel,
      source: engine === 'zai' ? 'ZAI' : 'GEMINI',
      leads: leads as RememberLead[],
      budgetUntil: t0 + 54_000,
    })
    let final: OutLead[] = decorateLeads(leads, stamps, city || undefined)
    const have = new Set(final.map((l) => normKey(l.company || '')))
    if (final.length < cap) {
      const topUp = await serveFromPool({ topicFp, cap: cap - final.length, excludeKeys: new Set([...excludeKeys, ...have]), city: city || undefined })
      final = [...final, ...topUp.filter((t) => !have.has(normKey(t.company)))]
    }
    if (final.length < cap) {
      final = (await topUpWithTeamVerified(final, cap, city, excludeKeys, definition, boostAllowed)).leads
    }
    const { deck, scarcity } = buildDeck(final, definition, weights, cap, areaLabel)
    await logScanRun(userId, topicFp, 'AI_SEARCH', deck.length, false)
    // Engine names stay internal: the note describes the outcome, never the
    // plumbing. Both grounded engines share one neutral wording.
    const baseNote = teaser
      ? `Scouted live from the web using your saved profile${pinArea ? ' · within 5 km of your location' : city ? ` · focused on ${city}` : ''}. Real, publicly findable businesses, grounded in live search.`
      : `Live web results grounded in real search${pinArea ? ' within 5 km of your location' : ''}, real, publicly findable businesses.`
    return NextResponse.json({
      leads: deck,
      mode: deck.length ? 'AI_SEARCH' : 'SCARCE',
      source: 'WEB',
      ...(notice ? { notice } : {}),
      ...(scarcity ? { note: scarcity } : { note: deck.length > leads.length ? `${baseNote} Topped up with verified pool leads you have not seen yet.` : baseNote }),
      ...(body.debug ? { glmTrace, geminiTrace } : {}),
    })
  }

  let ai: Awaited<ReturnType<typeof geminiGenerate>>
  let zai: Awaited<ReturnType<typeof zaiGenerate>> | null

  /**
   * When the GLM engine could not take the scan and a backup carried it, say
   * so once, gently, with the fix named. The reason decides the words: an
   * empty wallet names the door to top up, pacing asks for one more try, a
   * rejected key points at Integrations.
   */
  const zaiWhy = (who: string): string | undefined => {
    // The platform GLM pool's balance is the operator's business, never the
    // seller's noise: only a PERSONAL key's refusal names a fix the reader
    // can actually act on. Platform refusals stay silent. Engine names stay
    // internal either way, the note explains the fallback, not the plumbing.
    if (!personalZai || !zai || zai.ok) return undefined
    if (zai.reason === 'BALANCE')
      return `Heads up: the extra search engine behind this account was refused for balance this run, so ${who} carried the scan.`
    if (zai.reason === 'RATE')
      return `Heads up: the extra search engine is pacing requests this minute, so ${who} carried the scan. One more try usually puts it back in front.`
    if (zai.reason === 'KEY_INVALID')
      return `Heads up: a saved engine key was not accepted this run, so ${who} carried the scan.`
    return undefined
  }

  if (zaiFirst) {
    // 1) PRIMARY, z.ai GLM with live Web Search grounding. A personal key
    //    spends the seller's own credits; the platform key spends the
    //    operator's pool. Either way a grounded scan costs about two cents.
    zai = await runZaiScan()
    let leads = zai?.ok ? await parseLeadList(zai.text, cap, city) : []
    if (zai?.ok && leads.length > 0) return aiSearchResponse(leads, 'zai', undefined, zai.endpoint)

    // 2) BACKUP, Gemini with Google Search grounding when the z.ai engine could
    //    not answer. If the z.ai cause is money or the key, say so once, gently:
    //    the user can act on that, and it explains why the scan ran on Google.
    ai = await runGeminiScan()
    leads = ai.ok ? await parseLeadList(ai.text, cap, city) : []
    if (ai.ok && leads.length > 0) {
      return aiSearchResponse(leads, 'gemini', zaiWhy('Google') || ai.notice)
    }
  } else {
    // 1) PRIMARY, Gemini with Google Search grounding (the established engine,
    //    when its free tier is in the mood). Deadline trimmed to 22s so a second
    //    engine still gets its turn inside the 60s function budget.
    ai = await runGeminiScan()
    let leads = ai.ok ? await parseLeadList(ai.text, cap, city) : []
    if (ai.ok && leads.length > 0) return aiSearchResponse(leads, 'gemini', ai.notice)

    // 2) SECOND, z.ai GLM with live Web Search grounding (the platform pool:
    //    a saved key would have taken the lead spot above). Google was tried
    //    first and could not answer, say so once, gently.
    zai = await runZaiScan()
    leads = zai?.ok ? await parseLeadList(zai.text, cap, city) : []
    if (zai?.ok && leads.length > 0) {
      const engineNotice = !ai.ok
        ? 'Heads up: the Google search engine was unavailable this minute, so this scan ran on the backup live search engine. Everything below is still real, search grounded results.'
        : undefined
      return aiSearchResponse(leads, 'zai', engineNotice, zai.endpoint)
    }
  }

  // 3) FALLBACK A, OpenStreetMap: real, keyless directory listings (no AI
  //    needed to fetch them), then DeepSeek ranks them to the seller when a
  //    DeepSeek key exists. With a GPS pin we search a tight 5 km radius around
  //    it instead of geocoding the city name. The gate is RUNWAY, not a fixed
  //    wall: when the web engines fail fast (an empty GLM wallet answers in
  //    under a second, pacing in one), the map directory still gets its turn
  //    instead of being skipped by a stale elapsed time check while the scan
  //    had plenty of budget left.
  const osmRunway = t0 + 50_000 - Date.now()
  const osm =
    osmRunway > 16_000
      ? await searchOsmLeads(area, definition, cap, { deadlineAt: t0 + 50_000, lat, lng })
      : { leads: [], note: 'skipped, the web search used the time budget' }
  if (osm.leads.length > 0) {
    const areaLine = pinArea ? ' within 5 km of your location' : area && area !== 'South Africa' ? ` in ${area}` : ''
    const dirNotice = zaiWhy('the real business directory')
    // Map ranking (GLM plain generation) and the People Pass (Gemini grounded)
    // draw on DIFFERENT engines and different quotas, so they run side by
    // side: the scan answers in the same time, with names AND reasons.
    const [ranked, people] = await Promise.all([
      enrichOsmWithAi(userId, definition, osm.leads as AiLead[], cap, t0, glmTrace),
      enrichWithPeople(userId, osm.leads as unknown as (AiLead & { company: string })[], t0, geminiTrace),
    ])
    const leadsWithPeople = mergePeople(osm.leads as unknown as OutLead[], people)
    // Region gate on the answer side: the directory is area bounded, but a
    // people merge or stale record must never drag a foreign face through.
    const saLeads = leadsWithPeople.filter((l) => isSouthAfricanLead(l))
    // Capture + verify: map records (with the humans just named) land in the
    // shared pool (deduped, phones normalized, websites pinged while budget
    // allows), then the answer keeps its ranking order and tops up with fresh
    // pool faces never saved before.
    const stamps = await rememberScanResults({
      topicFp,
      area: areaLabel,
      source: 'OSM',
      leads: saLeads as unknown as RememberLead[],
      budgetUntil: t0 + 54_000,
    })
    let final: OutLead[] = decorateLeads(saLeads, stamps, city || undefined)
    const have = new Set(final.map((l) => normKey(l.company || '')))
    if (final.length < cap) {
      const topUp = await serveFromPool({ topicFp, cap: cap - final.length, excludeKeys: new Set([...excludeKeys, ...have]), city: city || undefined })
      final = [...final, ...topUp.filter((t) => !have.has(normKey(t.company)))]
    }
    if (final.length < cap) {
      final = (await topUpWithTeamVerified(final, cap, city, excludeKeys, definition, boostAllowed)).leads
    }
    // The ranked opinions ride onto the cards (why + score), then the deck's
    // composite order decides what ships: the ranker's taste is an input to
    // the score, not the whole verdict.
    const rankedById = new Map((ranked?.leads || []).map((l) => [normKey(l.company), l]))
    final = final.map((l) => {
      const r = rankedById.get(normKey(l.company || ''))
      return r ? { ...l, why: r.why || l.why, score: r.score || l.score } : l
    })
    const { deck, scarcity } = buildDeck(final, definition, weights, cap, areaLabel)
    await logScanRun(userId, topicFp, 'OSM', deck.length, false)
    if (ranked && ranked.leads.length > 0) {
      const engineName = ranked.engine || 'AI'
      return NextResponse.json({
        leads: deck,
        mode: deck.length ? 'OSM' : 'SCARCE',
        source: 'OSM',
        ...(ranked.notice || dirNotice ? { notice: ranked.notice || dirNotice } : {}),
        ...(osm.note ? { osmNote: osm.note } : {}),
        ...(scarcity ? { note: scarcity } : {}),
        ...(body.debug ? { glmTrace, geminiTrace } : {}),
        ...(scarcity
          ? {}
          : {
              note: teaser
                ? `Scouted from the real business directory${areaLine} using your saved profile, then matched and ranked by ${engineName}. Contact details come straight from the directory.`
                : `Real businesses from the OpenStreetMap directory${areaLine}, matched and ranked by ${engineName} to what you sell. Contact details as listed in the directory.`,
            }),
      })
    }
    return NextResponse.json({
      leads: deck,
      mode: deck.length ? 'OSM' : 'SCARCE',
      source: 'OSM',
      ...(dirNotice || ai.notice ? { notice: dirNotice || ai.notice } : {}),
      ...(osm.note ? { osmNote: osm.note } : {}),
      ...(scarcity ? { note: scarcity } : { note: `Real businesses from the OpenStreetMap directory${areaLine}. Contact details as listed.` }),
      ...(body.debug ? { glmTrace, geminiTrace } : {}),
    })
  }

  // 4) FALLBACK B, Explee verified data when configured (no fabricated demo data, ever)
  const ex = Date.now() - t0 < 50_000 ? await searchLeads(definition, city || undefined, cap) : { leads: [] }
  if (ex.leads.length > 0) {
    // Region gate: even the verified feed wears the same lens before an
    // answer ships or a row is captured.
    const saEx = (ex.leads as unknown as OutLead[]).filter((l) => isSouthAfricanLead(l))
    if (saEx.length === 0) {
      await logScanRun(userId, topicFp, 'EXPLEE', 0, false)
    } else {
      const stamps = await rememberScanResults({
        topicFp,
        area: areaLabel,
        source: 'EXPLEE',
        leads: saEx as unknown as RememberLead[],
        budgetUntil: t0 + 54_000,
      })
      const final = decorateLeads(saEx, stamps, city || undefined)
      const { deck, scarcity } = buildDeck(final, definition, weights, cap, areaLabel)
      await logScanRun(userId, topicFp, 'EXPLEE', deck.length, false)
      if (!deck.length && scarcity) {
        return NextResponse.json({ leads: [], mode: 'SCARCE', source: 'TEAM', note: scarcity })
      }
      return NextResponse.json({ ...ex, leads: deck, source: 'TEAM', ...(scarcity ? { note: scarcity } : {}) })
    }
  }

  // One clean, honest message. No clause pile ups: name what happened, give the next move.
  // When BOTH search engines were tried, surface the most actionable cause (a money
  // or key problem beats a quota rest) instead of stacking two errors.
  const slowRun = Date.now() - t0 > 50_000
  const mapWhy = osm.note ? ` ${osm.note}` : ' The map directory had nothing for that description either.'
  const engineErrors: { error: string; reason?: string }[] = []
  if (!ai.ok) engineErrors.push({ error: ai.error })
  if (personalZai && zai && !zai.ok) engineErrors.push({ error: zai.error, reason: zai.reason })
  const engineError = engineErrors.length
    ? engineErrors.find((e) => e.reason === 'BALANCE' || e.reason === 'KEY_INVALID' || e.reason === 'RATE')?.error ?? engineErrors[0].error
    : ''
  const note = ai.ok || zai?.ok
    ? `The web search and the map directory both came back empty for that description.${osm.note ? ` ${osm.note}` : ''} Try naming the type of business and the area more directly. For example: taverns in Soweto that need security services.`
    : `${engineError}${mapWhy}${!ai.ok && ai.error !== engineError ? ` The Google engine also could not answer this minute: ${ai.error}` : ''}${slowRun ? ' The search ran out of its time budget. One more try is usually quicker.' : ''}`

  await logScanRun(userId, topicFp, 'NONE', 0, false)
  return NextResponse.json(
    {
      leads: [],
      mode: 'NONE',
      ...(ai.notice ? { notice: ai.notice } : {}),
      ...(body.debug ? { glmTrace, geminiTrace } : {}),
      note,
    },
    { status: 200 }
  )
}
