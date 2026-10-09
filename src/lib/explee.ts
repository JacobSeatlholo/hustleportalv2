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
 * Falls back to a realistic demo generator when no API key is configured.
 */
export async function searchLeads(
  definition: string,
  city: string | undefined,
  limit: number
): Promise<{ leads: ExpleeLead[]; mode: 'LIVE' | 'DEMO'; note?: string }> {
  const apiKey = (await getConfig(CONFIG_KEYS.EXPLEE_API_KEY)).trim()
  if (apiKey.length > 5) {
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
        const text = await res.text().catch(() => '')
        return {
          leads: demoLeads(definition, city, limit),
          mode: 'DEMO',
          note: `Explee API error ${res.status} — showing demo leads instead.`,
        }
      }
      const data = await res.json()
      const items: ExpleeLead[] = (data?.results || data?.companies || data || [])
        .map((c: Record<string, unknown>, i: number) => normalizeExplee(c, i))
        .filter(Boolean)
      return { leads: items.length ? items : demoLeads(definition, city, limit), mode: 'LIVE' }
    } catch {
      return {
        leads: demoLeads(definition, city, limit),
        mode: 'DEMO',
        note: 'Could not reach Explee — showing demo leads instead.',
      }
    }
  }
  return {
    leads: demoLeads(definition, city, limit),
    mode: 'DEMO',
    note: 'Demo mode — add your Explee API key in Admin to pull live leads.',
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

// ---------- Demo generator (realistic SA businesses) ----------

const STREETS = ['Vilakazi', 'Khumalo', 'Mlangeni', 'Dlamini', 'Sisulu', 'Mbeki', 'Tambo', 'Luthuli']
const AREAS: Record<string, string[]> = {
  Johannesburg: ['Soweto', 'Alexandra', 'Braamfontein', 'Randburg', 'Midrand', 'Sandton'],
  Durban: ['Umlazi', 'Chatsworth', 'Pinetown', 'Umhlanga', 'Phoenix'],
  Pretoria: ['Mamelodi', 'Soshanguve', 'Hatfield', 'Centurion'],
  'Port Elizabeth': ['New Brighton', 'Walmer', 'Summerstrand'],
}
const TYPES = [
  'Trading', 'Projects', 'Solutions', 'Group', 'Enterprises', 'Services', 'Concepts', 'Ventures',
]
const SECTORS = [
  'Construction', 'Cleaning Services', 'Logistics', 'Catering', 'Security Services',
  'Beauty & Wellness', 'IT Support', 'Printing & Branding', 'Waste Management', 'Transport',
]
const FIRST = ['Sipho', 'Thandi', 'Lerato', 'Kagiso', 'Nomvula', 'Bongani', 'Ayanda', 'Zanele', 'Sibusiso', 'Palesa', 'Themba', 'Naledi']
const LAST = ['Nkosi', 'Dlamini', 'Mokoena', 'Ndlovu', 'Mahlangu', 'Zulu', 'Maseko', 'Khumalo', 'Sithole', 'Mabaso']

function seededPick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length]
}

export function demoLeads(definition: string, city: string | undefined, limit: number): ExpleeLead[] {
  const base = Date.now()
  const out: ExpleeLead[] = []
  const words = definition.toLowerCase().split(/\s+/)
  const sectorFromDef = SECTORS.find((s) => words.includes(s.toLowerCase().split(' ')[0]))
  const cities = city && AREAS[city] ? AREAS[city] : Object.values(AREAS).flat()
  for (let i = 0; i < limit; i++) {
    const seed = base + i * 7919
    const owner = `${seededPick(FIRST, seed)} ${seededPick(LAST, seed >> 3)}`
    const town = seededPick(cities, seed >> 5)
    const sector = sectorFromDef || seededPick(SECTORS, seed >> 7)
    out.push({
      externalId: `demo_${base}_${i}`,
      company: `${owner.split(' ')[1]} ${seededPick(TYPES, seed >> 2)} (${town})`,
      contactName: owner,
      email: undefined, // locked behind reveal
      phone: undefined,
      website: undefined,
      industry: sector,
      city: town,
      country: 'South Africa',
      score: 3 + (Math.abs(seed) % 3),
    })
  }
  return out
}

/** Demo reveal data — deterministic per lead. */
export function demoReveal(company: string, city?: string, contactName?: string) {
  const seed = company.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const name = contactName || `${seededPick(FIRST, seed)} ${seededPick(LAST, seed >> 3)}`
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return {
    email: `${name.split(' ')[0].toLowerCase()}@${slug.slice(0, 14)}.co.za`,
    phone: `+27 ${60 + (seed % 30)} ${100 + (seed % 800)} ${2000 + (seed % 7000)}`.replace(/\s/g, ' '),
    website: `www.${slug.slice(0, 18)}.co.za`,
    contactName: name,
  }
}
