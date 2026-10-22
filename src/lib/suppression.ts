/**
 * POPIA listing suppression, the enforcement half of "remove my business".
 *
 * A business that asks to leave the lead index stops appearing everywhere:
 * scan ingestion drops it, the verified pool never serves it, and the paid
 * reveal refuses it before any charge. Pool filters match on the normalised
 * name only (broad on purpose, an opt-out must never leak through a city
 * or fingerprint variation); the reveal check is precise (map listing id,
 * or name plus city when both are known). A 60 second cache keeps the
 * per-request cost at one read while keeping take-down near-immediate.
 */
import { db } from '@/lib/db'

export function normKey(v: string | null | undefined): string {
  return (v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export type SuppressionRow = {
  id: string
  name: string
  nameKey: string
  city: string
  osmId: string | null
  createdAt: Date
}

let cache: { at: number; rows: SuppressionRow[] } | null = null
const TTL_MS = 60_000

async function rows(): Promise<SuppressionRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows
  try {
    const fresh = await db.listingSuppression.findMany({
      select: { id: true, name: true, nameKey: true, city: true, osmId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    cache = { at: Date.now(), rows: fresh }
    return fresh
  } catch {
    // suppression must never take a scan or a reveal down, serve the cache
    return cache?.rows || []
  }
}

export function invalidateSuppressionCache(): void {
  cache = null
}

/** Normalised names of every suppressed business, the broad pool filter. */
export async function suppressedNameKeys(): Promise<Set<string>> {
  const all = await rows()
  return new Set(all.map((r) => r.nameKey).filter((k) => k))
}

/** External map listing ids under suppression, exact filter for scan results. */
export async function suppressedOsmIds(): Promise<Set<string>> {
  const all = await rows()
  return new Set(all.map((r) => r.osmId).filter((v): v is string => !!v))
}

/**
 * Precise check for the paid reveal: the exact map listing id, or the name
 * plus city (a suppressed name with no city on record blocks by name alone).
 */
export async function isSuppressed(opts: { company: string; city?: string | null; externalId?: string | null }): Promise<boolean> {
  const all = await rows()
  if (all.length === 0) return false
  if (opts.externalId && all.some((r) => r.osmId && r.osmId === opts.externalId)) return true
  const key = normKey(opts.company)
  if (!key) return false
  const city = normKey(opts.city)
  return all.some((r) => r.nameKey === key && (!r.city || !city || r.city === city))
}

/** Record a removal request. Repeating one is a no-op, not an error. */
export async function createSuppression(input: { name: string; city?: string; osmId?: string | null; contact?: string | null; reason?: string | null; source?: string }): Promise<{ created: boolean }> {
  const nameKey = normKey(input.name)
  if (!nameKey) return { created: false }
  try {
    await db.listingSuppression.create({
      data: {
        name: input.name.trim().slice(0, 160),
        nameKey,
        city: normKey(input.city).slice(0, 60),
        osmId: input.osmId || null,
        contact: input.contact?.trim().slice(0, 160) || null,
        reason: input.reason?.trim().slice(0, 500) || null,
        source: input.source || 'WEB',
      },
    })
    invalidateSuppressionCache()
    return { created: true }
  } catch (e) {
    // unique (nameKey, city), already honoured
    if ((e as { code?: string })?.code === 'P2002') return { created: false }
    throw e
  }
}
