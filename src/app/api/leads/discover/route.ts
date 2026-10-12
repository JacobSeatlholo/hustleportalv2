import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'
import { searchLeads } from '@/lib/explee'
import { searchOsmLeads } from '@/lib/osm'

export const maxDuration = 60

/**
 * POST /api/leads/discover — source REAL leads.
 *
 * PRIMARY: Gemini with Google Search grounding — the model can only report businesses
 * it actually saw in search results (websites, directories, maps listings, news).
 * No fabricated companies, no synthetic contacts: real results or nothing.
 *
 * TEASER: with no definition supplied, the AI builds the search from the seller's saved
 * profile (website, offerings, value proposition) and finds a few real businesses in the
 * seller's area that likely need what they sell — the taste that sells the R199 plan.
 *
 * FALLBACK: Explee verified data when configured. Demo/fabricated leads are gone —
 * "the teaser must be real results and not bs".
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

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const cap = Math.min(Math.max(parseInt(body.limit) || 10, 1), 20)
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
  let teaser = false
  if (!definition) {
    const project = await db.project.findFirst({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })
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
      'You are a meticulous B2B lead researcher for South African small businesses. You are grounded in live Google Search results. You report ONLY businesses that actually exist and are publicly findable — you NEVER invent a company name, website, phone number or email. When unsure, return fewer leads rather than risk a fake one. South African context first (townships, suburbs, metros).',
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

  // 1) PRIMARY — grounded web search (real businesses only).
  // Deadline budget: Vercel caps this function at 60s — the Gemini chain gets
  // 30s (hard deadline inside callGemini too), leaving room for the OSM map
  // fallback, so the caller always gets an honest response instead of a 504.
  const t0 = Date.now()
  const ai = await geminiGenerate(userId, { ...buildSearch(), timeoutMs: 30_000 })

  if (ai.ok) {
    const parsed = parseJsonLoose<{ leads?: AiLead[] }>(ai.text)
    const seen = new Set<string>()
    const leads = (parsed?.leads || [])
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
    if (leads.length > 0) {
      return NextResponse.json({
        leads,
        mode: 'AI_SEARCH',
        source: 'WEB',
        ...(ai.notice ? { notice: ai.notice } : {}),
        note: teaser
          ? `Scouted live from the web using your saved profile${pinArea ? ' · within 5 km of your location' : city ? ` · focused on ${city}` : ''}. These are real, publicly findable businesses — add them to your pipeline and start the conversation.`
          : `Live web results grounded in Google Search — real, publicly findable businesses${pinArea ? ' within 5 km of your location' : ''}.`,
      })
    }
  }

  // 2) FALLBACK A — OpenStreetMap: real, keyless directory listings (Gemini only
  //    helped translate the need into map tags; Overpass supplies the actual data).
  //    Only started when there is still runway (the chain needs ~15s of its own).
  //    With a GPS pin we search a tight 5 km radius around it instead of geocoding the city name.
  const osm = Date.now() - t0 < 35_000
    ? await searchOsmLeads(area, definition, cap, { deadlineAt: t0 + 50_000, lat, lng })
    : { leads: [], note: 'skipped — the web search used the time budget' }
  if (osm.leads.length > 0) {
    return NextResponse.json({
      leads: osm.leads,
      mode: 'OSM',
      source: 'OSM',
      ...(ai.notice ? { notice: ai.notice } : {}),
      note: `Real businesses from the OpenStreetMap directory${pinArea ? ' within 5 km of your location' : area ? ` in ${area}` : ''} — publicly mappable, contact details as listed. Search grounding was busy, so these come from the map instead.`,
    })
  }

  // 3) FALLBACK B — Explee verified data when configured (no fabricated demo data, ever)
  const ex = Date.now() - t0 < 50_000 ? await searchLeads(definition, city || undefined, cap) : { leads: [] }
  if (ex.leads.length > 0) {
    return NextResponse.json({ ...ex, source: 'EXPLEE' })
  }

  return NextResponse.json(
    {
      leads: [],
      mode: 'NONE',
      ...(ai.notice ? { notice: ai.notice } : {}),
      note:
        (ai.ok
          ? `The web search and the map directory both came back empty for that description — try naming the type of business and area more directly (e.g. "taverns in Soweto that need security services"). ${osm.note || ''}`.trim()
          : `${ai.error}${Date.now() - t0 > 50_000 ? ' (the search ran out of its time budget — try once more, it is usually quicker on a retry)' : ''} — the map directory also had nothing (${osm.note || 'no area match'}). Try naming the business type and area more directly.`),
    },
    { status: 200 }
  )
}
