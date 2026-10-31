import { getConfigJson, CONFIG_KEYS } from '@/lib/config'

/**
 * Shared store for the owner's pitch pipeline (/api/admin/exec/xpitch).
 * Kept in a lib module because Next.js route files may only export their
 * handlers — other routes (review gate) and scripts import from here.
 *
 * Store shape (PlatformConfig XPITCH_PIPELINE):
 *   { status: Record<handle, Status>, extra?: Record<handle, ExtraLead>, updatedAt }
 *
 * - status: the funnel position of every lead (seed + extra)
 * - extra: leads the OWNER personally added through the review gate —
 *   they ride exactly like seed rows but live in the DB, so a seed
 *   re-generation never wipes the boss's own adds.
 */
export const XPITCH_STATUSES = ['todo', 'dm', 'replied', 'joined', 'skip'] as const
export type XPitchStatus = (typeof XPITCH_STATUSES)[number]

export interface XPitchExtraLead {
  handle: string
  name: string
  trade: string
  city: string
  followers: number
  url: string
  phone: string
  email: string
  platform: 'x' | 'tiktok' | 'facebook'
  lastPost: string
  fresh: 'fresh' | 'warm' | 'stale' | 'no-posts' | 'unknown'
  addedVia?: string
  addedAt?: string
}

export interface XPitchStore {
  status: Record<string, XPitchStatus>
  extra?: Record<string, XPitchExtraLead>
  updatedAt?: string
}

export async function loadPipeline(): Promise<XPitchStore> {
  const s = await getConfigJson<Partial<XPitchStore> | null>(CONFIG_KEYS.XPITCH_PIPELINE, null)
  const status = (s && s.status && typeof s.status === 'object' ? s.status : {}) as Record<string, XPitchStatus>
  const extra = (s && s.extra && typeof s.extra === 'object' ? s.extra : {}) as Record<string, XPitchExtraLead>
  return { status, extra, updatedAt: s?.updatedAt }
}
