import { getConfig, CONFIG_KEYS } from '@/lib/config'

// Base override exists for local QA only (a mock server plays Explee);
// production never sets it and always talks to the real API.
const EXPLEE_BASE = process.env.EXPLEE_BASE?.trim() || 'https://api.explee.com'

export interface ExpleeLead {
  externalId: string
  company: string
  contactName?: string
  email?: string
  phone?: string
  website?: string
  industry?: string
  city?: string
  country?: string
  score?: number
  sourceRef?: string
  employees?: number
  founded?: number
}

export interface ExpleeSearchMeta {
  total: number
  resultsCount: number
  creditsCharged: number
  remainingBalance: number
}

export interface ExpleeSearchResult {
  leads: ExpleeLead[]
  mode: 'LIVE' | 'NONE'
  meta?: ExpleeSearchMeta
  note?: string
}

function firstOf(v: unknown): string | undefined {
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim() || undefined
  if (typeof v === 'string') return v.trim() || undefined
  return undefined
}

function normalizeExplee(c: Record<string, unknown>, i: number): ExpleeLead | null {
  const name = (c.name as string) || (c.company_name as string) || (c.legal_name as string) || null
  if (!name) return null
  const url = (c.url as string) || null
  const domain = (c.domain as string) || null
  const website = url || (domain ? `https://${domain}` : undefined)
  const linkedinId = c.linkedin_id
  const sourceRef =
    typeof linkedinId === 'number' && linkedinId > 0
      ? `https://www.linkedin.com/company/${linkedinId}`
      : url || (domain ? `https://${domain}` : undefined)
  return {
    externalId: String(c.id ?? c.company_id ?? (domain || `explee_${i}_${Date.now()}`)),
    company: name.trim(),
    email: firstOf(c.emails),
    phone: firstOf(c.phones),
    website: website || undefined,
    industry: (c.industry as string) || undefined,
    city: (c.geo_city as string) || undefined,
    country: (c.geo as string) || 'ZA',
    score: typeof c.domain_is_alive === 'number' ? Math.round(c.domain_is_alive * 100) : undefined,
    ...(sourceRef ? { sourceRef } : {}),
    ...(typeof c.size === 'number' ? { employees: c.size } : {}),
    ...(typeof c.founded === 'number' ? { founded: c.founded } : {}),
  }
}

/**
 * Live Explee company search against the real Public API contract:
 * POST /public/api/v1/search/companies with { filters: { definition, geo_city, geo_include }, page, page_size }.
 * Credits cost 0.5 per company returned; meta carries the running balance.
 * No key configured or source unreachable → empty result with an honest note.
 * Fabricated "demo" leads were removed on purpose: real results or nothing.
 */
export async function expleeSearchCompanies(opts: {
  definition: string
  city?: string
  limit?: number
  apiKey?: string
}): Promise<ExpleeSearchResult> {
  const apiKey = (opts.apiKey ?? (await getConfig(CONFIG_KEYS.EXPLEE_API_KEY))).trim()
  if (apiKey.length <= 5) {
    return { leads: [], mode: 'NONE', note: 'No Explee key configured yet.' }
  }
  const definition = opts.definition.trim()
  if (!definition) return { leads: [], mode: 'NONE', note: 'No campaign definition to search for.' }

  const filters: Record<string, unknown> = {
    definition,
    geo_include: ['ZA'],
  }
  if (opts.city) filters.geo_city = [opts.city]

  try {
    const res = await fetch(`${EXPLEE_BASE}/public/api/v1/search/companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        filters,
        page: 1,
        page_size: Math.min(Math.max(opts.limit ?? 25, 1), 200),
      }),
      signal: AbortSignal.timeout(75_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return {
        leads: [],
        mode: 'NONE',
        note: `Explee responded with HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''} — no verified results to show.`,
      }
    }
    const data = (await res.json()) as {
      companies?: Record<string, unknown>[]
      meta?: { total?: number; results_count?: number; credits_charged?: number; remaining_balance?: number }
    }
    const items = (data?.companies || [])
      .map((c, i) => normalizeExplee(c, i))
      .filter((x): x is ExpleeLead => Boolean(x))
    const m = data?.meta
    return {
      leads: items,
      mode: items.length ? 'LIVE' : 'NONE',
      ...(m
        ? {
            meta: {
              total: Number(m.total ?? items.length),
              resultsCount: Number(m.results_count ?? items.length),
              creditsCharged: Number(m.credits_charged ?? 0),
              remainingBalance: Number(m.remaining_balance ?? 0),
            },
          }
        : {}),
    }
  } catch {
    return { leads: [], mode: 'NONE', note: 'Could not reach Explee — try again shortly.' }
  }
}

/**
 * Backwards compatible helper for the discover route: same signature as before,
 * now speaking the real Explee contract under the hood.
 */
export async function searchLeads(
  definition: string,
  city: string | undefined,
  limit: number
): Promise<{ leads: ExpleeLead[]; mode: 'LIVE' | 'NONE'; note?: string }> {
  const r = await expleeSearchCompanies({ definition, city, limit })
  return { leads: r.leads, mode: r.mode, ...(r.note ? { note: r.note } : {}) }
}

// =================== Outreach pulse: hot leads ===================
// The owner's campaigns talk to prospects around the clock. When one replies
// with real interest, Explee marks it hot and this is how the Executive
// Dashboard sees it without opening Explee. Contract:
// GET /public/api/v1/autogtm/hot-leads  -> { leads: HotLeadItem[], total, has_more, next_offset }
// GET /public/api/v1/autogtm/campaigns  -> { campaigns: [{ id, name, status, ... }], total }

export interface ExpleeCampaignInfo {
  id: number
  name: string
  status: string
}

export interface ExpleeHotLead {
  personId: string
  campaignId: number
  campaignName?: string
  name?: string
  email?: string
  jobTitle?: string
  companyName?: string
  companyDomain?: string
  linkedinUrl?: string
  phone?: string
  country?: string
  whyHot?: string
  becameHotAt?: string
}

export interface ExpleeHotLeadsResult {
  leads: ExpleeHotLead[]
  total: number
  hasMore: boolean
  campaigns: ExpleeCampaignInfo[]
  mode: 'LIVE' | 'NONE'
  note?: string
}

async function expleeGetJson(
  path: string,
  apiKey: string
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(`${EXPLEE_BASE}${path}`, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return { ok: false, status: res.status, data: null }
    return { ok: true, status: res.status, data: (await res.json()) as Record<string, unknown> }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}

/**
 * Every hot lead across the whole Explee organization (the API key resolves to
 * the businesshustle workspace), newest first, with campaign names joined so
 * the owner can see which campaign warmed each prospect up. A failed campaign
 * list never hides hot leads: names fall back to the campaign id.
 *
 * "All" means all: the walk keeps fetching pages through next_offset until the
 * server says there are none left, so a growing campaign never gets truncated
 * at one screenful. Pass campaignId to focus on a single campaign (the API
 * filters server side); omit it for the whole organization.
 */
export async function expleeHotLeads(opts?: { limit?: number; campaignId?: number; apiKey?: string }): Promise<ExpleeHotLeadsResult> {
  const apiKey = (opts?.apiKey ?? (await getConfig(CONFIG_KEYS.EXPLEE_API_KEY))).trim()
  const empty = { leads: [], total: 0, hasMore: false, campaigns: [], mode: 'NONE' as const }
  if (apiKey.length <= 5) return { ...empty, note: 'No Explee key configured yet.' }

  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 200)
  const campaignId =
    typeof opts?.campaignId === 'number' && Number.isFinite(opts.campaignId) && opts.campaignId > 0
      ? opts.campaignId
      : null
  const campaignParam = campaignId ? `&campaign_id=${campaignId}` : ''
  const [campaignsRes, firstRes] = await Promise.all([
    expleeGetJson('/public/api/v1/autogtm/campaigns', apiKey),
    expleeGetJson(`/public/api/v1/autogtm/hot-leads?limit=${limit}${campaignParam}`, apiKey),
  ])

  if (!firstRes.ok) {
    const why =
      firstRes.status === 401
        ? 'Explee rejected the API key. Paste a fresh one in settings.'
        : firstRes.status
          ? `Explee responded with HTTP ${firstRes.status}.`
          : 'Could not reach Explee — try again shortly.'
    return { ...empty, note: why }
  }

  const campaignRows = Array.isArray(campaignsRes.data?.campaigns)
    ? (campaignsRes.data!.campaigns as Record<string, unknown>[])
    : []
  const campaigns: ExpleeCampaignInfo[] = campaignRows
    .filter((c) => typeof c.id === 'number')
    .map((c) => ({ id: c.id as number, name: String(c.name ?? `Campaign ${c.id}`), status: String(c.status ?? '') }))
  const campaignMap = new Map(campaigns.map((c) => [c.id, c.name]))

  const rows = Array.isArray(firstRes.data?.leads) ? (firstRes.data!.leads as Record<string, unknown>[]) : []
  const allRows = [...rows]

  // Walk the remaining pages. Guarded at 25 pages so a surprise can never hang
  // the dashboard: 25 x 200 already covers five thousand warm prospects.
  let hasMore = firstRes.data?.has_more === true
  let nextOffset = typeof firstRes.data?.next_offset === 'number' ? firstRes.data.next_offset : null
  let pages = 1
  while (hasMore && nextOffset !== null && nextOffset > 0 && pages < 25) {
    const pageRes = await expleeGetJson(
      `/public/api/v1/autogtm/hot-leads?limit=${limit}&offset=${nextOffset}${campaignParam}`,
      apiKey
    )
    if (!pageRes.ok) break
    const pageRows = Array.isArray(pageRes.data?.leads) ? (pageRes.data!.leads as Record<string, unknown>[]) : []
    allRows.push(...pageRows)
    hasMore = pageRes.data?.has_more === true
    nextOffset = typeof pageRes.data?.next_offset === 'number' ? pageRes.data.next_offset : null
    pages += 1
  }

  const leads: ExpleeHotLead[] = allRows
    .map((r) => {
      const campaignId = Number(r.campaign_id ?? 0)
      return {
        personId: String(r.person_id ?? ''),
        campaignId,
        campaignName: campaignMap.get(campaignId) || (campaignId ? `Campaign ${campaignId}` : undefined),
        name: (r.name as string) || undefined,
        email: (r.email as string) || undefined,
        jobTitle: (r.job_title as string) || undefined,
        companyName: (r.company_name as string) || undefined,
        companyDomain: (r.company_domain as string) || undefined,
        linkedinUrl: (r.linkedin_url as string) || undefined,
        phone: (r.phone as string) || undefined,
        country: (r.country as string) || undefined,
        whyHot: (r.why_hot as string) || undefined,
        becameHotAt: (r.became_hot_at as string) || undefined,
      }
    })
    .filter((l) => l.personId)

  return {
    leads,
    total: typeof firstRes.data?.total === 'number' ? firstRes.data.total : leads.length,
    hasMore,
    campaigns,
    mode: 'LIVE',
  }
}
