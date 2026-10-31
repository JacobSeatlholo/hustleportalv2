import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { getConfigJson, setConfig, CONFIG_KEYS } from '@/lib/config'
import { XPITCH_SEED, XPitchSeedLead } from '@/lib/xpitchSeed'

export const maxDuration = 30

/**
 * /api/admin/exec/xpitch — THE OWNER'S GROWTH PIPELINE.
 *
 * The lead pool is the MEMBERS' product: rows there get served to paying
 * scans, so pitch targets for HustlePortal itself never belong in it. This
 * is the owner's own list — the SA sellers found on X to pitch subscriptions
 * to — with a status each so outreach is workable from the exec dashboard:
 *
 *   todo → dm (first DM sent) → replied → joined (subscriber!) — or skip.
 *
 * State lives in PlatformConfig under CONFIG_KEYS.XPITCH_PIPELINE as
 * { status: Record<handle, status>, updatedAt }. The list itself is seeded
 * once from the audited sweep snapshot (src/lib/xpitchSeed.ts); new sweep
 * waves can re-seed by bumping the seed and wiping the key.
 */

const STORE_KEY = CONFIG_KEYS.XPITCH_PIPELINE
const STATUSES = ['todo', 'dm', 'replied', 'joined', 'skip'] as const
type Status = (typeof STATUSES)[number]

interface XPitchStore {
  status: Record<string, Status>
  updatedAt?: string
}

async function loadStore(): Promise<XPitchStore> {
  const s = await getConfigJson<XPitchStore | null>(STORE_KEY, null)
  if (s && s.status && typeof s.status === 'object') return { status: s.status, updatedAt: s.updatedAt }
  return { status: {}, updatedAt: undefined }
}

function countsOf(store: XPitchStore) {
  const counts: Record<Status, number> = { todo: 0, dm: 0, replied: 0, joined: 0, skip: 0 }
  for (const lead of XPITCH_SEED) counts[store.status[lead.handle] ?? 'todo']++
  return counts
}

function rowsOf(store: XPitchStore) {
  return XPITCH_SEED.map((l: XPitchSeedLead) => ({ ...l, status: store.status[l.handle] ?? 'todo' }))
}

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const store = await loadStore()
  return NextResponse.json({
    ok: true,
    counts: countsOf(store),
    leads: rowsOf(store),
    total: XPITCH_SEED.length,
    updatedAt: store.updatedAt ?? null,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({}))
  const handle = String(body?.handle || '').trim()
  const status = String(body?.status || '').trim() as Status
  if (!handle || !XPITCH_SEED.some((l) => l.handle.toLowerCase() === handle.toLowerCase())) {
    return NextResponse.json({ error: 'Unknown handle.' }, { status: 400 })
  }
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 })
  }

  const store = await loadStore()
  store.status[handle] = status
  store.updatedAt = new Date().toISOString()
  await setConfig(STORE_KEY, JSON.stringify(store))

  return NextResponse.json({ ok: true, handle, status, counts: countsOf(store) })
}
