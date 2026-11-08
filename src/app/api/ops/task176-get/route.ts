import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * ONE-TIME DOOR #3 (Task 176) — catalog_get on the finalist endpoints: exact
 * parameters, response fields, treg-measured success rates and real prices,
 * so the 1000-lead lane is chosen with eyes open. catalog_get is metadata —
 * it routes NOTHING to providers, so nothing can be spent. Read-only, one
 * session, deleted after.
 */

const DOOR_TOKEN = 'e8426d0c93f1a57b4802c3be6a1f7d5290ac63be14f78026'

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

const TREG_MCP_URL = 'https://treg.to/mcp/'
const TREG_TOKEN = (process.env.TREG_TOKEN || process.env.TREG_API_TOKEN || '').trim()

const IDS = [
  'treg.people.search',
  'apollo.people.search',
  'dropleads.people.search',
  'dropleads.people.enrich.verified',
  'quickenrich.companies.search',
  'tomba.companies.emails.list',
  'treg.people.email.find',
]

export async function POST(req: NextRequest) {
  if (!TREG_TOKEN || TREG_TOKEN.length <= 20) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const out: Record<string, unknown> = {}
  for (const id of IDS) {
    try {
      const res = await fetch(TREG_MCP_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TREG_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'catalog_get', arguments: { endpoint_id: id } } }),
        signal: AbortSignal.timeout(25_000),
      })
      if (!res.ok) {
        out[id] = { error: `http ${res.status}` }
        continue
      }
      const json = (await res.json()) as { result?: { structuredContent?: unknown; content?: { text?: string }[] } }
      out[id] = json.result?.structuredContent ?? json.result?.content?.[0]?.text ?? json.result ?? null
    } catch (e) {
      out[id] = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  return NextResponse.json({ ok: true, catalog: out })
}
