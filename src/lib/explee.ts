import { getConfig, CONFIG_KEYS } from '@/lib/config'

const EXPLEE_BASE = 'https://api.explee.com'

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
