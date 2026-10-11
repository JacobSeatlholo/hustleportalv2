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
}

/**
 * Search Explee for companies matching a natural-language definition.
 * No key configured or source unreachable → empty result with an honest note.
 * Fabricated "demo" leads were removed on purpose: real results or nothing.
 */
export async function searchLeads(
  definition: string,
  city: string | undefined,
  limit: number
): Promise<{ leads: ExpleeLead[]; mode: 'LIVE' | 'NONE'; note?: string }> {
  const apiKey = (await getConfig(CONFIG_KEYS.EXPLEE_API_KEY)).trim()
  if (apiKey.length <= 5) {
    return { leads: [], mode: 'NONE' }
  }
  try {
    const res = await fetch(`${EXPLEE_BASE}/public/api/v1/search/companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        definition,
        ...(city ? { location: { cities: [city] } } : {}),
        limit: Math.min(limit, 50),
      }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) {
      return {
        leads: [],
        mode: 'NONE',
        note: `Explee responded with HTTP ${res.status} — no verified results to show.`,
      }
    }
    const data = await res.json()
    const items: ExpleeLead[] = (data?.results || data?.companies || data || [])
      .map((c: Record<string, unknown>, i: number) => normalizeExplee(c, i))
      .filter(Boolean)
    return { leads: items, mode: items.length ? 'LIVE' : 'NONE' }
  } catch {
    return { leads: [], mode: 'NONE', note: 'Could not reach the verified lead source — try again shortly.' }
  }
}

function normalizeExplee(c: Record<string, unknown>, i: number): ExpleeLead | null {
  const name =
    (c.company_name as string) || (c.name as string) || (c.legal_name as string) || null
  if (!name) return null
  return {
    externalId: String(c.id ?? c.company_id ?? `explee_${i}_${Date.now()}`),
    company: name,
    contactName: (c.contact_name as string) || (c.decision_maker as string) || undefined,
    email: (c.email as string) || undefined,
    phone: (c.phone as string) || (c.phone_number as string) || undefined,
    website: (c.website as string) || (c.domain as string) || undefined,
    industry: (c.industry as string) || (c.sector as string) || undefined,
    city: (c.city as string) || undefined,
    country: (c.country as string) || 'South Africa',
    score: typeof c.score === 'number' ? Math.round(c.score) : undefined,
  }
}
