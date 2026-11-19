import { db } from '@/lib/db'
import { getStrategist, REFERRAL_PER_LEAD_CENTS, MANAGED_PER_LEAD_CENTS } from '@/lib/corporate'
import { strategistDashboardUrl } from '@/lib/corporateKeys'
import { sast } from '@/lib/esign'

// ============ PARTNER DIGEST (Task 215, background analytics) ============
// The numbers behind the strategist's weekly email and the self-serve
// "send me my numbers now" hook. Same laws as the partner dashboard page
// (src/app/corporate/[slug]/dashboard/page.tsx) — one economics, two surfaces:
//   - The funnel is the accounts that signed up through the partner's door
//     (User.corporatePartner = slug) — attribution lives on the account.
//   - The share is R50 per managed lead DELIVERED, read from live reveal
//     transactions — accrual, not a promise.
//   - Business names only in the call lists; the inbox is the partner's own.

export interface PartnerDigest {
  slug: string
  company: string
  contactEmail?: string
  dashboardUrlPath: string
  accounts: number
  newAccountsWeek: number
  activated: number
  managedLeads: number
  shareCents: number
  topupsWeekCents: number
  closeNow: string[]
  warming: string[]
  lastActivity: string | null
}

export async function computePartnerDigest(slug: string): Promise<PartnerDigest | null> {
  const partner = getStrategist(slug)
  if (!partner) return null

  const accounts = await db.user.findMany({
    where: { corporatePartner: partner.slug },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, businessName: true, createdAt: true,
      wallet: { select: { balance: true } },
    },
  })
  const ids = accounts.map((a) => a.id)
  // Reveal counts per account: the managed-leads meter and the R50 accrual.
  const revealRows = ids.length > 0
    ? await db.creditTx.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, type: 'LEAD_REVEAL' },
        _count: { _all: true },
      })
    : []
  const revealsByUser = new Map(revealRows.map((r) => [r.userId, r._count._all]))
  const lastActivity = ids.length > 0
    ? await db.creditTx.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _max: { createdAt: true },
      })
    : []
  const lastByUser = new Map(lastActivity.map((r) => [r.userId, r._max.createdAt]))
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const topupRows = ids.length > 0
    ? await db.topUp.findMany({
        where: { userId: { in: ids }, status: 'PAID' },
        select: { userId: true, amountCents: true, paidAt: true, createdAt: true },
      })
    : []
  const topupByUser = new Map<string, number>()
  const topupWeekByUser = new Map<string, number>()
  for (const t of topupRows) {
    topupByUser.set(t.userId, (topupByUser.get(t.userId) ?? 0) + t.amountCents)
    const when = t.paidAt ?? t.createdAt
    if (when && when >= weekAgo) topupWeekByUser.set(t.userId, (topupWeekByUser.get(t.userId) ?? 0) + t.amountCents)
  }

  const rows = accounts.map((a) => ({
    ...a,
    reveals: revealsByUser.get(a.id) ?? 0,
    lastActive: lastByUser.get(a.id) ?? null,
    topupCents: topupByUser.get(a.id) ?? 0,
    balance: a.wallet?.balance ?? 0,
  }))

  const totalReveals = rows.reduce((n, r) => n + r.reveals, 0)
  const name = (r: { businessName: string | null; name: string }) => r.businessName || r.name
  // Same closing targets as the dashboard: below one lead is a stalled card,
  // under three is a top-up conversation waiting to happen.
  const closeNow = rows.filter((r) => r.reveals > 0 && r.balance < MANAGED_PER_LEAD_CENTS).map(name)
  const warming = rows
    .filter((r) => r.reveals > 0 && r.balance >= MANAGED_PER_LEAD_CENTS && r.balance < 3 * MANAGED_PER_LEAD_CENTS)
    .map(name)
  const lastOfAll = rows.map((r) => r.lastActive).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null

  return {
    slug: partner.slug,
    company: partner.company,
    contactEmail: partner.contactEmail,
    dashboardUrlPath: strategistDashboardUrl(partner.slug) ?? `/corporate/${partner.slug}/dashboard`,
    accounts: rows.length,
    newAccountsWeek: rows.filter((r) => r.createdAt >= weekAgo).length,
    activated: rows.filter((r) => r.reveals > 0).length,
    managedLeads: totalReveals,
    shareCents: totalReveals * REFERRAL_PER_LEAD_CENTS,
    topupsWeekCents: [...topupWeekByUser.values()].reduce((n, v) => n + v, 0),
    closeNow,
    warming,
    lastActivity: lastOfAll ? sast(lastOfAll) : null,
  }
}
