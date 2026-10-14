import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'
import { deepseekGenerate } from '@/lib/deepseek'
import { zaiGenerate, getUserZaiKey, getPlatformZaiKey } from '@/lib/zai'
import { searchLeads } from '@/lib/explee'
import { searchOsmLeads } from '@/lib/osm'
import { planState, FREE_LIMITS, upgradeJson } from '@/lib/limits'
import { resolveProject } from '@/lib/workspace'

export const maxDuration = 60

/**
 * POST /api/leads/discover — source REAL leads.
 *
 * ENGINE CHAIN (first one with real results wins):
 *  1. The scan's LEADER depends on the setup: any saved z.ai key (a personal
 *     one under Integrations, or the operator's platform key in the
 *     environment, named ZAI_API_KEY or a friendly alias like GLM_key) puts
 *     z.ai GLM in front — about two cents per scan, no Google quota. Without
 *     one, Gemini with Google Search grounding leads (22s budget).
 *  2. The other engine backs up automatically: z.ai GLM brings live Web Search
 *     grounding that ignores Google's quota mood; Gemini grounds on Google
 *     Search when z.ai can't answer.
 *  3. OpenStreetMap real directory (keyless) with DeepSeek ranking when a
 *     DeepSeek key exists — ranks reality, never supplies contact facts.
 *  4. Explee verified data when configured.
 *
 * No fabricated companies, no synthetic contacts: real results or an honest
 * note naming the most actionable cause.
 *
 * TEASER: with no definition supplied, the AI builds the search from the seller's saved
 * profile (website, offerings, value proposition) and finds a few real businesses in the
 * seller's area that likely need what they sell — the taste that sells the R199 plan.
 */

interface AiLead {
  company?: string
  contactName?: string
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
  // ZA numbers: +27XXXXXXXXX (12 chars incl +) or 0XXXXXXXXX (10) — allow a little slack
  if (digits.replace(/\D/g, '').length < 9) return undefined
  return s
}

function saneWebsite(v?: string): string | undefined {
  const s = clean(v)
  if (!s) return undefined
  return s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
}

/**
 * Read the seller's own website so the hunt is grounded in what they actually
 * sell. Best effort, 8s cap: title, description and visible text — enough for
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
function parseLeadList(text: string, cap: number, city: string) {
  const parsed = parseJsonLoose<{ leads?: AiLead[] }>(text)
  const seen = new Set<string>()
  return (parsed?.leads || [])
    .map((l) => ({
      company: clean(l.company),
      contactName: clean(l.contactName),
      email: saneEmail(l.email),
      phone: sanePhone(l.phone),
      website: saneWebsite(l.website),
      industry: clean(l.industry),
      city: clean(l.city) || (city || undefined),
      why: clean(l.why),
      score: typeof l.score === 'number' ? Math.max(1, Math.min(5, Math.round(l.score))) : undefined,
    }))
    // a lead without a company name is unusable — drop it (no fabrication)
    .filter((l): l is typeof l & { company: string } => Boolean(l.company))
    .filter((l) => {
      const key = l.company.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, cap)
}

/**
 * DeepSeek enrichment of REAL map records. The model only decides WHICH source
 * businesses fit the seller and WHY; every contact field in the answer is
 * copied verbatim from the source record it matched, and any answer that does
 * not map back to a real record is dropped. This is the anti-fabrication
 * guarantee: DeepSeek ranks reality, it never supplies facts.
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
  // Compact, numbered source list. Everything DeepSeek may know about the leads
  // lives here, so the server can verify the answer against it.
  const source = raw
    .map((l, i) =>
      `${i + 1}. company: ${l.company} | type: ${l.industry || 'unknown'}${l.city ? ` | area: ${l.city}` : ''}${l.phone ? ` | phone: ${l.phone}` : ''}${l.website ? ` | website: ${l.website}` : ''}`
    )
    .join('\n')
  const res = await deepseekGenerate(userId, {
    system:
      'You are a meticulous lead qualifier for South African small businesses. You receive a numbered list of REAL businesses from the OpenStreetMap directory and a seller description. You pick which of those real businesses are worth the seller contacting. You NEVER invent a company, phone number, website or email: every field you output must come from the list. If nothing fits, return fewer leads.',
    prompt:
      `The seller offers:\n"""${definition.slice(0, 900)}"""\n\n` +
      `Real businesses from the map directory:\n${source}\n\n` +
      `Pick up to ${cap} businesses from the list above that would realistically buy what the seller offers.\n` +
      `Rules:\n` +
      `- company: copy the name EXACTLY as it appears in the list.\n` +
      `- score: 1 to 5 fit for the seller. Reserve 4 and 5 for strong fits.\n` +
      `- why: one short line grounded in the type and area shown in the list.\n` +
      `- never output phone, website or email. Those stay attached from the source automatically.\n` +
      `- drop businesses that clearly do not fit. Fewer, better leads win.\n` +
      `Return ONLY JSON: {"leads":[{"company":"","industry":"","why":"","score":3}]}`,
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
  const parsed = parseJsonLoose<{ leads?: AiLead[] }>(res.text)
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
  return { leads: out.slice(0, cap) }
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
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
      { error: 'Describe who you want to sell to — or save your website in Profile so the AI can scout for you.' },
      { status: 400 }
    )
  }

  // The seller's website grounds the whole hunt: we read what they actually sell
  // (title, meta description, on-page text) and hand it to the AI as context.
  const sellerSiteInput = String(body.website || '').trim()
  const sellerSite = sellerSiteInput ? await readSellerSite(sellerSiteInput) : null
  if (sellerSite) {
    const siteContext = sellerSite.text
      ? `The seller's website is ${sellerSite.url}. What their site says about them: """${sellerSite.text}"""`
      : `The seller's website is ${sellerSite.url} (the page could not be read — judge only from the web address).`
    definition = `${definition}\n\nSeller context: ${siteContext}`
  }
  const area = city && !/^anywhere/i.test(city) ? city : 'South Africa'
  const pinArea = hasPin
    ? `within a 5 km radius of GPS pin ${lat!.toFixed(4)},${lng!.toFixed(4)}${city ? ` (${city}, South Africa)` : ' (South Africa)'} — use the coordinates to reason about the neighbourhood, suburb and surrounding streets`
    : null

  const buildSearch = () => ({
    search: true,
    json: true,
    system:
      'You are a meticulous B2B lead researcher for South African small businesses. You are grounded in live web search results. You report ONLY businesses that actually exist and are publicly findable — you NEVER invent a company name, website, phone number or email. When unsure, return fewer leads rather than risk a fake one. South African context first (townships, suburbs, metros).',
    prompt:
      `Find up to ${cap} real businesses ${pinArea || `in ${area}`} that are likely to need what this seller offers:\n"""${definition}"""\n\n` +
      `Rules:\n` +
      `- REAL businesses only, grounded in the search results you actually saw (company websites, directories, Google Business listings, Facebook pages, news).\n` +
      `- CONTACT DETAILS ARE THE PRIZE: for every business include its website, and include its phone number and email address whenever they appear in the results you saw (Google Business listings, directory pages, the business's own site). Prefer businesses whose phone or email is actually visible over ones with none.\n` +
      `- NEVER construct an address from a pattern — if the phone/email is not in the results, omit the field.\n` +
      `- "why" = one line on why THIS business likely needs the seller (reference what you saw).\n` +
      `- score = 1-5 fit for the seller.\n` +
      `Return ONLY JSON, omitting any field you could not verify:\n` +
      `{"leads":[{"company":"","industry":"","city":"","website":"","phone":"","email":"","contactName":"","why":"","score":3}]}`,
  })

  const t0 = Date.now()

  // WHO LEADS THE SCAN: a saved z.ai key puts the GLM engine in front — a
  // personal key under Integrations (their credits, their control) or the
  // operator's platform key (deployed for exactly this: deterministic scans
  // that ignore Google's quota mood mid presentation). Google steps down to
  // automatic backup. Without any z.ai key the classic order holds: Gemini
  // first, and no z.ai stop at all.
  const zaiFirst = Boolean(await getUserZaiKey(userId)) || Boolean(getPlatformZaiKey())

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

  const aiSearchResponse = (
    leads: ReturnType<typeof parseLeadList>,
    engine: 'gemini' | 'zai',
    notice?: string,
    zaiEndpoint?: 'z.ai' | 'zhipu'
  ) => {
    const zaiEngineName = zaiEndpoint === 'zhipu' ? 'the GLM engine on the Zhipu open platform' : 'the z.ai GLM engine'
    return NextResponse.json({
      leads,
      mode: 'AI_SEARCH',
      source: 'WEB',
      ...(notice ? { notice } : {}),
      ...(body.debug ? { glmTrace, geminiTrace } : {}),
      note:
        engine === 'zai'
          ? teaser
            ? `Scouted live from the web using your saved profile${pinArea ? ' · within 5 km of your location' : city ? ` · focused on ${city}` : ''}. Real, publicly findable businesses, grounded in live search on ${zaiEngineName}.`
            : `Live web results grounded in real search${pinArea ? ' within 5 km of your location' : ''}, sourced by ${zaiEngineName}.`
          : teaser
            ? `Scouted live from the web using your saved profile${pinArea ? ' · within 5 km of your location' : city ? ` · focused on ${city}` : ''}. These are real, publicly findable businesses — add them to your pipeline and start the conversation.`
            : `Live web results grounded in Google Search — real, publicly findable businesses${pinArea ? ' within 5 km of your location' : ''}.`,
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
    if (!zai || zai.ok) return undefined
    if (zai.reason === 'BALANCE')
      return `Heads up: both GLM doors refused the web search tool for balance, so ${who} carried this scan. A small top up or a search bundle on the billing page of the platform where your credits live puts it back in front.`
    if (zai.reason === 'RATE')
      return `Heads up: the GLM engine is pacing requests this minute, so ${who} carried the scan. One more try usually puts it back in front.`
    if (zai.reason === 'KEY_INVALID')
      return `Heads up: the GLM key was not accepted, so ${who} carried the scan. Checking the key under Integrations puts it back in front.`
    return undefined
  }

  if (zaiFirst) {
    // 1) PRIMARY — z.ai GLM with live Web Search grounding. A personal key
    //    spends the seller's own credits; the platform key spends the
    //    operator's pool. Either way a grounded scan costs about two cents.
    zai = await runZaiScan()
    let leads = zai?.ok ? parseLeadList(zai.text, cap, city) : []
    if (zai?.ok && leads.length > 0) return aiSearchResponse(leads, 'zai', undefined, zai.endpoint)

    // 2) BACKUP — Gemini with Google Search grounding when the z.ai engine could
    //    not answer. If the z.ai cause is money or the key, say so once, gently:
    //    the user can act on that, and it explains why the scan ran on Google.
    ai = await runGeminiScan()
    leads = ai.ok ? parseLeadList(ai.text, cap, city) : []
    if (ai.ok && leads.length > 0) {
      return aiSearchResponse(leads, 'gemini', zaiWhy('Google') || ai.notice)
    }
  } else {
    // 1) PRIMARY — Gemini with Google Search grounding (the established engine,
    //    when its free tier is in the mood). Deadline trimmed to 22s so a second
    //    engine still gets its turn inside the 60s function budget.
    ai = await runGeminiScan()
    let leads = ai.ok ? parseLeadList(ai.text, cap, city) : []
    if (ai.ok && leads.length > 0) return aiSearchResponse(leads, 'gemini', ai.notice)

    // 2) SECOND — z.ai GLM with live Web Search grounding (the platform pool:
    //    a saved key would have taken the lead spot above). Google was tried
    //    first and could not answer — say so once, gently.
    zai = await runZaiScan()
    leads = zai?.ok ? parseLeadList(zai.text, cap, city) : []
    if (zai?.ok && leads.length > 0) {
      const engineNotice = !ai.ok
        ? 'Heads up: the Google search engine was unavailable this minute, so this scan ran on the GLM engine. Everything below is still real, search grounded results.'
        : undefined
      return aiSearchResponse(leads, 'zai', engineNotice, zai.endpoint)
    }
  }

  // 3) FALLBACK A — OpenStreetMap: real, keyless directory listings (no AI
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
      : { leads: [], note: 'skipped — the web search used the time budget' }
  if (osm.leads.length > 0) {
    const areaLine = pinArea ? ' within 5 km of your location' : area && area !== 'South Africa' ? ` in ${area}` : ''
    const dirNotice = zaiWhy('the real business directory')
    const ranked = await enrichOsmWithDeepseek(userId, definition, osm.leads as AiLead[], cap, t0)
    if (ranked && ranked.leads.length > 0) {
      return NextResponse.json({
        leads: ranked.leads,
        mode: 'OSM',
        source: 'OSM',
        ...(ranked.notice || dirNotice ? { notice: ranked.notice || dirNotice } : {}),
        ...(osm.note ? { osmNote: osm.note } : {}),
        ...(body.debug ? { glmTrace, geminiTrace } : {}),
        note: teaser
          ? `Scouted from the real business directory${areaLine} using your saved profile, then matched and ranked by DeepSeek AI. Contact details come straight from the directory.`
          : `Real businesses from the OpenStreetMap directory${areaLine}, matched and ranked by DeepSeek AI to what you sell. Contact details as listed in the directory.`,
      })
    }
    return NextResponse.json({
      leads: osm.leads,
      mode: 'OSM',
      source: 'OSM',
      ...(dirNotice || ai.notice ? { notice: dirNotice || ai.notice } : {}),
      ...(osm.note ? { osmNote: osm.note } : {}),
      ...(body.debug ? { glmTrace, geminiTrace } : {}),
      note: `Real businesses from the OpenStreetMap directory${areaLine}. Contact details as listed. AI ranking is resting, so these are unranked.`,
    })
  }

  // 4) FALLBACK B — Explee verified data when configured (no fabricated demo data, ever)
  const ex = Date.now() - t0 < 50_000 ? await searchLeads(definition, city || undefined, cap) : { leads: [] }
  if (ex.leads.length > 0) {
    return NextResponse.json({ ...ex, source: 'EXPLEE' })
  }

  // One clean, honest message. No clause pile ups: name what happened, give the next move.
  // When BOTH search engines were tried, surface the most actionable cause (a money
  // or key problem beats a quota rest) instead of stacking two errors.
  const slowRun = Date.now() - t0 > 50_000
  const mapWhy = osm.note ? ` ${osm.note}` : ' The map directory had nothing for that description either.'
  const engineErrors: { error: string; reason?: string }[] = []
  if (!ai.ok) engineErrors.push({ error: ai.error })
  if (zai && !zai.ok) engineErrors.push({ error: zai.error, reason: zai.reason })
  const engineError = engineErrors.length
    ? engineErrors.find((e) => e.reason === 'BALANCE' || e.reason === 'KEY_INVALID' || e.reason === 'RATE')?.error ?? engineErrors[0].error
    : ''
  const note = ai.ok || zai?.ok
    ? `The web search and the map directory both came back empty for that description.${osm.note ? ` ${osm.note}` : ''} Try naming the type of business and the area more directly. For example: taverns in Soweto that need security services.`
    : `${engineError}${mapWhy}${!ai.ok && ai.error !== engineError ? ` The Google engine also could not answer this minute: ${ai.error}` : ''}${slowRun ? ' The search ran out of its time budget. One more try is usually quicker.' : ''}`

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
