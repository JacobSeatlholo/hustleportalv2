import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { expleeHotLeads } from '@/lib/explee'

// GET /api/admin/exec/hotleads — the outreach pulse on the Executive Dashboard:
// every hot lead across the businesshustle Explee workspace, newest first,
// pulled live from the Explee API with campaign names joined. Exec only.
//
// A short in memory cache keeps dashboard refreshes gentle on the Explee API.
// Only clean LIVE answers are cached, so trouble always shows fresh and honest.

const CACHE_TTL_MS = Number(process.env.EXEC_HOTLEADS_TTL_MS) || 60_000
let hotCache: { at: number; payload: Record<string, unknown> } | null = null

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  if (hotCache && Date.now() - hotCache.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hotCache.payload, cached: true })
  }

  const result = await expleeHotLeads({ limit: 200 })

  if (result.mode !== 'LIVE') {
    return NextResponse.json({
      total: 0,
      hasMore: false,
      campaigns: [],
      leads: [],
      engine: 'NONE',
      fetchedAt: new Date().toISOString(),
      note: result.note ?? 'Explee has no answers right now.',
    })
  }

  const payload = {
    total: result.total,
    hasMore: result.hasMore,
    campaigns: result.campaigns,
    leads: result.leads,
    engine: 'LIVE',
    fetchedAt: new Date().toISOString(),
    note: null as string | null,
  }
  hotCache = { at: Date.now(), payload }
  return NextResponse.json(payload)
}
