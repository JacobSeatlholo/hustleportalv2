import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getConfig, CONFIG_KEYS } from '@/lib/config'

export const maxDuration = 60

/**
 * ONE-TIME DOOR — Task 175 verified-bench pull (Task 146 precedent). The
 * platform's own verified-feed lane (Explee) is the only source that can
 * yield real, verified business emails at volume today; Overpass is
 * cloud-IP-hostile and the directories are anti-bot-gated. This door:
 *   - token-gated (wrong token = 404),
 *   - reads the Explee key from platform config SERVER SIDE (the key never
 *     appears in any response),
 *   - walks POST /public/api/v1/search/companies with the caller's specs
 *     (definition, city, page, pageSize ≤ 200, ≤ 4 specs per call),
 *   - returns normalized leads (company, email, phone, website, city,
 *     industry, externalId) plus the account meta (credits charged, balance
 *     left) so the burn is visible on every call,
 *   - never sends anything, never writes platform rows (staging is the
 *     bench-door's separate one-shot job).
 * Deleted right after today's pull.
 */

const DOOR_TOKEN = 'f39367bf2d2e50dd852120e44a55a053'
const EXPLEE_BASE = process.env.EXPLEE_BASE?.trim() || 'https://api.explee.com'

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

type Spec = { definition?: string; city?: string; page?: number; pageSize?: number }

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { specs?: Spec[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const specs = (body.specs || [])
    .filter((s) => typeof s.definition === 'string' && s.definition.trim().length > 1)
    .slice(0, 4)
  if (specs.length === 0) {
    return NextResponse.json({ error: 'No valid specs.' }, { status: 400 })
  }

  const apiKey = ((await getConfig(CONFIG_KEYS.EXPLEE_API_KEY)) || '').trim()
  if (apiKey.length <= 5) {
    return NextResponse.json({ error: 'No Explee key configured on the platform.', results: [] }, { status: 503 })
  }

  const results: unknown[] = []
  for (const spec of specs) {
    const page = Math.max(1, Math.min(50, Math.round(Number(spec.page) || 1)))
    const pageSize = Math.max(1, Math.min(200, Math.round(Number(spec.pageSize) || 100)))
    const filters: Record<string, unknown> = { definition: String(spec.definition).trim(), geo_include: ['ZA'] }
    if (spec.city) filters.geo_city = [String(spec.city)]
    try {
      const res = await fetch(`${EXPLEE_BASE}/public/api/v1/search/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ filters, page, page_size: pageSize }),
        signal: AbortSignal.timeout(45_000),
      })
      if (!res.ok) {
        results.push({ spec, error: `explee HTTP ${res.status}`, leads: [] })
        continue
      }
      const data = await res.json()
      const leads = (data?.companies || []).map((c: Record<string, unknown>) => ({
        externalId: String(c.id ?? c.company_id ?? c.domain ?? ''),
        company: String(c.name ?? c.company_name ?? c.legal_name ?? '').trim(),
        email: (Array.isArray(c.emails) ? c.emails[0] : c.email) || null,
        phone: (Array.isArray(c.phones) ? c.phones[0] : c.phone) || null,
        website: (c.url as string) || ((c.domain as string) ? `https://${c.domain}` : null),
        industry: (c.industry as string) || null,
        city: (c.geo_city as string) || spec.city || null,
      })).filter((l: { company: string }) => l.company)
      results.push({
        spec,
        leads,
        meta: data?.meta ? {
          total: Number(data.meta.total ?? 0),
          resultsCount: Number(data.meta.results_count ?? 0),
          creditsCharged: Number(data.meta.credits_charged ?? 0),
          remainingBalance: Number(data.meta.remaining_balance ?? 0),
        } : null,
      })
    } catch (e) {
      results.push({ spec, error: String(e).slice(0, 120), leads: [] })
    }
  }

  return NextResponse.json({ ok: true, results })
}
