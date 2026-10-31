import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import {
  tregEnabled,
  tregToolsCatalog,
  tregProbeCall,
  tregProbeSpendMicro,
  TREG_PROBE_BUDGET_USD,
  type TregCatalogTool,
} from '@/lib/tregverify'

/**
 * GET  /api/admin/exec/treg/catalog — WHAT ELSE CAN THIS TOKEN DO.
 *
 * One free metadata call (tools/list) against the treg MCP returns the whole
 * provider catalog the team token can route to. Cached 24h in PlatformConfig
 * so the lens never re-asks on a refresh; ?fresh=1 forces a re-read. The
 * catalog is how new doors get chosen with eyes open: an X/social search
 * endpoint, a phone verifier, whatever else the providers sell — name,
 * description, the endpoint ids and every price the text admits, before a
 * single paid call is spent on any of it.
 *
 * POST /api/admin/exec/treg/catalog — THE PROBE DOOR, one metered call.
 *
 * Body: { endpointId, args?, maxCostUsd? }. Executes ONE tools/call against
 * any endpoint in the catalog with a hard lifetime budget (TREG_PROBE_BUDGET_USD,
 * $1.00, durable in PlatformConfig — survives restarts and operator memory).
 * Every real call lands on the call ledger with via 'probe' and its receipt,
 * and the durable TREG_PROBE_SPEND counter books the cost. A refused or
 * failing probe buys nothing. The token never leaves the server and never
 * appears in any response.
 */

const CACHE_KEY = 'TREG_CATALOG'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface CatalogCache {
  fetchedAt: number
  ok: boolean
  tools: TregCatalogTool[]
  error?: string
}

async function readCache(): Promise<CatalogCache | null> {
  try {
    const row = await db.platformConfig.findUnique({ where: { key: CACHE_KEY } })
    if (!row?.value) return null
    const c = JSON.parse(row.value) as CatalogCache
    if (!c || typeof c.fetchedAt !== 'number') return null
    return c
  } catch {
    return null
  }
}

async function writeCache(c: CatalogCache): Promise<void> {
  try {
    await db.platformConfig.upsert({
      where: { key: CACHE_KEY },
      update: { value: JSON.stringify(c) },
      create: { key: CACHE_KEY, value: JSON.stringify(c) },
    })
  } catch {
    /* the cache is an optimisation, never a dependency */
  }
}

function shape(c: CatalogCache, cached: boolean) {
  const endpointCount = c.tools.reduce((a, t) => a + t.endpoints.length, 0)
  return {
    ok: c.ok,
    cached,
    fetchedAt: new Date(c.fetchedAt).toISOString(),
    ageHours: Math.round(((Date.now() - c.fetchedAt) / 3_600_000) * 10) / 10,
    toolCount: c.tools.length,
    endpointCount,
    tools: c.tools,
    ...(c.error ? { error: c.error } : {}),
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const fresh = req.nextUrl.searchParams.get('fresh') === '1'
  if (!fresh) {
    const c = await readCache()
    if (c && Date.now() - c.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json(shape(c, true))
    }
  }

  if (!tregEnabled) {
    return NextResponse.json(
      { ok: false, error: 'TREG_TOKEN is not set on this deployment — the catalog needs the team token.' },
      { status: 400 }
    )
  }

  const cat = await tregToolsCatalog()
  const entry: CatalogCache = { fetchedAt: Date.now(), ok: cat.ok, tools: cat.tools, ...(cat.error ? { error: cat.error } : {}) }
  if (cat.ok) await writeCache(entry)
  return NextResponse.json(shape(entry, false))
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  if (!tregEnabled) {
    return NextResponse.json({ error: 'TREG_TOKEN is not set on this deployment.' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as { endpointId?: string; args?: Record<string, unknown>; maxCostUsd?: number; tool?: string }
  // Whitelist: provider calls ride `call` by endpoint id; the catalog's own
  // free discovery tools are addressed by name. Anything else is refused.
  const TOOL_NAMES = ['call', 'catalog_search', 'catalog_get', 'my_tools', 'balance'] as const
  const tool = (TOOL_NAMES as readonly string[]).includes(String(body.tool)) ? String(body.tool) : 'call'
  const endpointId = String(body.endpointId || '').trim()
  if (tool === 'call' && (!endpointId || !/^[a-z0-9_.]+$/i.test(endpointId))) {
    return NextResponse.json({ error: 'Send { endpointId } — a dotted endpoint id straight from the catalog.' }, { status: 400 })
  }

  // The lifetime guard, read before a cent is spent.
  const spentBefore = await tregProbeSpendMicro()
  const budgetMicro = Math.round(TREG_PROBE_BUDGET_USD * 1e6)
  if (spentBefore >= budgetMicro) {
    return NextResponse.json({
      ok: false,
      budgetReached: true,
      capUsd: TREG_PROBE_BUDGET_USD,
      spentUsd: Number((spentBefore / 1e6).toFixed(4)),
      error: `The probe budget has spent its $${TREG_PROBE_BUDGET_USD.toFixed(2)} ($${(spentBefore / 1e6).toFixed(4)} so far). Nothing was spent now. Raise TREG_PROBE_BUDGET_USD deliberately in code if the door earns it.`,
    })
  }

  const remainingUsd = Math.max(0, (budgetMicro - spentBefore) / 1e6)
  const maxCostUsd = Math.min(Number(body.maxCostUsd) || remainingUsd, remainingUsd)
  const args = body.args && typeof body.args === 'object' ? body.args : {}

  const r = await tregProbeCall(endpointId, args, { timeoutMs: 30_000, maxCostUsd, tool })
  const spentAfter = await tregProbeSpendMicro()

  return NextResponse.json({
    ...r,
    budget: {
      capUsd: TREG_PROBE_BUDGET_USD,
      spentUsd: Number((spentAfter / 1e6).toFixed(4)),
      remainingUsd: Number((Math.max(0, budgetMicro - spentAfter) / 1e6).toFixed(4)),
    },
    message: r.ok
      ? `Probe call cost $${(r.costUsd ?? 0).toFixed(4)}${r.callId ? ` (call ${r.callId})` : ''}. Probe budget remaining $${((budgetMicro - spentAfter) / 1e6).toFixed(2)}.`
      : `The probe bought nothing: ${r.error || `treg status ${r.status}`}.`,
  })
}
