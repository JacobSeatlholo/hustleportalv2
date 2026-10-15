import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { expleeHotLeads } from '@/lib/explee'

// GET /api/admin/exec/hotleads — the outreach pulse on the Executive Dashboard:
// every hot lead across the businesshustle Explee workspace, newest first,
// pulled live from the Explee API with campaign names joined. Exec only.
// Pass ?campaignId=<id> to focus the panel on one campaign; omit it for the
// whole organization. All pages are walked server side, so the owner always
// sees every warm prospect, never just the first screenful.
//
// A short in memory cache keeps dashboard refreshes gentle on the Explee API.
// It is keyed by campaign filter (so switching views never serves the wrong
// slice) and only clean LIVE answers are cached, so trouble always shows fresh
// and honest.

const CACHE_TTL_MS = Number(process.env.EXEC_HOTLEADS_TTL_MS) || 60_000
let hotCache: { at: number; campaignId: number | null; payload: Record<string, unknown> } | null = null

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const rawCampaign = new URL(req.url).searchParams.get('campaignId')
  const campaignId = rawCampaign && /^\d+$/.test(rawCampaign) ? Number(rawCampaign) : null

  if (hotCache && hotCache.campaignId === campaignId && Date.now() - hotCache.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hotCache.payload, cached: true })
  }

  const result = await expleeHotLeads({ limit: 200, campaignId: campaignId ?? undefined })

  if (result.mode !== 'LIVE') {
    return NextResponse.json({
      total: 0,
      hasMore: false,
      campaigns: result.campaigns,
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
  hotCache = { at: Date.now(), campaignId, payload }
  return NextResponse.json(payload)
}
