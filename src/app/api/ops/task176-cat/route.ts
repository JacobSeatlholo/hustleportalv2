import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * ONE-TIME DOOR #2 (Task 176) — treg catalog recon, answer to "can treg FIND
 * 1000 relevant people and will the balance hold". Runs ONLY free metadata
 * calls: catalog_search (fixed task queries, no provider routing) + my_tools
 * + the durable probe-spend counter. There is NO `call` here — no provider
 * endpoint can be routed, so nothing can be spent. Read-only, deleted in the
 * same session.
 */

const DOOR_TOKEN = 'c3b18a4f2e7d9c6051ba8e34f7a2d9560b8c41e7fd02a695'

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

const TREG_MCP_URL = 'https://treg.to/mcp/'
const TREG_TOKEN = (process.env.TREG_TOKEN || process.env.TREG_API_TOKEN || '').trim()

async function mcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(TREG_MCP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TREG_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) return { error: `http ${res.status}` }
  const json = (await res.json()) as { result?: { structuredContent?: unknown; content?: { text?: string }[] } }
  return json.result?.structuredContent ?? json.result?.content?.[0]?.text ?? json.result ?? null
}

const QUERIES = [
  "find a person's work email by name and company",
  'search companies by industry and city with contact emails',
  'search people by job title and country',
  'google maps businesses by keyword and location with email',
  'email finder for a company domain',
  'south africa companies contact database',
  'b2b contact database with verified emails',
  'enrich company with email address and phone',
]

interface SearchOut { q: string; data: unknown; error?: string }

export async function POST(req: NextRequest) {
  if (!TREG_TOKEN || TREG_TOKEN.length <= 20) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const searches: SearchOut[] = []
  for (const q of QUERIES) {
    try {
      const data = await mcpTool('catalog_search', { query: q })
      // trim: keep the verdict + the top results, cap text
      const obj = (typeof data === 'object' && data !== null ? data : {}) as { results?: unknown[]; verdict?: unknown; [k: string]: unknown }
      const results = Array.isArray(obj.results) ? obj.results.slice(0, 8) : undefined
      searches.push({ q, data: { verdict: obj.verdict, results, keys: Object.keys(obj) } })
    } catch (e) {
      searches.push({ q, data: null, error: e instanceof Error ? e.message : String(e) })
    }
  }

  let myTools: unknown = null
  try {
    myTools = await mcpTool('my_tools', {})
  } catch (e) {
    myTools = { error: e instanceof Error ? e.message : String(e) }
  }

  let probeSpend: number | null = null
  try {
    const row = await db.platformConfig.findUnique({ where: { key: 'TREG_PROBE_SPEND' } })
    probeSpend = row?.value ? Number(row.value) : 0
  } catch { /* read-only door, best effort */ }

  return NextResponse.json({ ok: true, searches, myTools, probeSpendMicro: probeSpend })
}
