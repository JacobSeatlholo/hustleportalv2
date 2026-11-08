import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { tregBalanceMicro } from '@/lib/tregverify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ONE-TIME DOOR #4 (Task 176) — the pilot: prove the 1000-lead lane on real
 * data before any volume. Three FREE dropleads.people.search probes (search
 * is metered $0 — only returned-data actions cost) + at most ONE
 * dropleads.people.enrich.verified on the first promising row ($0.0036,
 * billed per success only). Provider keys injected server-side by treg; no
 * credential leaves the deployment. Read-only on the platform DB. Deleted in
 * the same session.
 */

const DOOR_TOKEN = 'b91f7c35a60448e2bd9e715c3f8a2046de7093b1c58e6d24'

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

const TREG_MCP_URL = 'https://treg.to/mcp/'
const TREG_TOKEN = (process.env.TREG_TOKEN || process.env.TREG_API_TOKEN || '').trim()

async function tregCall(endpointId: string, args: Record<string, unknown>, timeoutMs = 45_000): Promise<{ status: number; body: unknown }> {
  const res = await fetch(TREG_MCP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TREG_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'call', arguments: { endpoint_id: endpointId, params: args } } }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
    const j = parsed as { result?: { structuredContent?: unknown; content?: { text?: string }[] } }
    if (j.result?.structuredContent !== undefined) parsed = j.result.structuredContent
    else if (j.result?.content?.[0]?.text) {
      try { parsed = JSON.parse(j.result.content[0].text as string) } catch { parsed = j.result.content[0].text }
    }
  } catch { /* raw text */ }
  return { status: res.status, body: parsed }
}

function leadRows(body: unknown): { total: unknown; rows: unknown[] } {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const data = (b.data ?? {}) as Record<string, unknown>
  const rows = (data.leads ?? b.leads ?? []) as unknown[]
  const total = data.total ?? b.total ?? null
  return { total, rows }
}

const SEARCHES: { name: string; filters: Record<string, unknown>; limit: number }[] = [
  { name: 'sa_owner_jobtitle', filters: { countries: ['South Africa'], jobTitles: ['Owner'], requireEmail: true }, limit: 5 },
  { name: 'sa_founder_seniority', filters: { countries: ['South Africa'], seniority: ['owner', 'founder'], requireEmail: true }, limit: 5 },
  { name: 'sa_any_email', filters: { countries: ['South Africa'], requireEmail: true }, limit: 3 },
]

export async function POST(req: NextRequest) {
  if (!TREG_TOKEN || TREG_TOKEN.length <= 20) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const before = await tregBalanceMicro({ fresh: true })
  const searches: Record<string, unknown> = {}

  let pilotRow: Record<string, unknown> | null = null
  for (const s of SEARCHES) {
    try {
      const r = await tregCall('dropleads.people.search', { filters: s.filters, pagination: { page: 1, limit: s.limit } })
      const { total, rows } = leadRows(r.body)
      searches[s.name] = { status: r.status, total, returned: rows.length, rows: rows.slice(0, 5) }
      if (!pilotRow && rows.length) {
        const first = rows[0] as Record<string, unknown>
        // pick the first row that carries an id + org/domain we can enrich on
        if (first && (first.id || first.domain || first.organization_name)) pilotRow = first
      }
    } catch (e) {
      searches[s.name] = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  let enrich: unknown = { skipped: 'no pilot row' }
  if (pilotRow) {
    const args: Record<string, unknown> = { email_verification_type: 'valid_and_catchall' }
    for (const k of ['id', 'first_name', 'last_name', 'name', 'organization_name', 'domain', 'linkedin_url']) {
      if (pilotRow[k]) args[k] = pilotRow[k]
    }
    try {
      const r = await tregCall('dropleads.people.enrich.verified', args, 50_000)
      enrich = { status: r.status, body: r.body }
    } catch (e) {
      enrich = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  const after = await tregBalanceMicro({ fresh: true })

  return NextResponse.json({
    ok: true,
    balanceBeforeMicro: before,
    balanceAfterMicro: after,
    spendMicro: before != null && after != null ? before - after : null,
    searches,
    enrich,
  })
}
