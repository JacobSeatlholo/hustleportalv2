// Server-only home of the partner dashboard keys (Task 221 hardening).
// They used to sit on the STRATEGISTS registry in corporate.ts, which client
// components import (the wallet pulls getStrategist) — so the key shipped in
// every member's JS bundle and any curious client could extract the
// strategist's funnel link. Keys now live here, imported only by server
// routes and pages; nothing in this file may reach a client bundle.
import { getStrategist, STRATEGISTS } from '@/lib/corporate'

const DASHBOARD_KEYS: Record<string, string> = {
  trinitydirect: 'bh-tdc-dashboard-8v3nq5',
}

export function dashboardKeyFor(slug: string): string | undefined {
  return DASHBOARD_KEYS[slug.toLowerCase().trim()]
}

export function strategistForDashboardKey(key: string): { slug: string } | undefined {
  const entry = Object.entries(DASHBOARD_KEYS).find(([, k]) => k === key)
  return entry ? { slug: entry[0] } : undefined
}

export function strategistDashboardUrl(slug: string): string | undefined {
  const key = dashboardKeyFor(slug)
  if (!key || !getStrategist(slug)) return undefined
  return `/corporate/${slug}/dashboard?key=${encodeURIComponent(key)}`
}

// The workspace menu bridge: the partnership's registered email resolves to
// his dashboard URL. Server-side only — /api/auth/me ships the keyless
// slug+name so the menu can show the row, this route carries the key.
export function strategistDashboardForEmail(email?: string | null): string | undefined {
  if (!email) return undefined
  const e = email.toLowerCase().trim()
  const s = STRATEGISTS.find((st) => st.contactEmail?.toLowerCase().trim() === e)
  return s ? strategistDashboardUrl(s.slug) : undefined
}
