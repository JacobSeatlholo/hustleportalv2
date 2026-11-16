import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'
import { STRATEGISTS, REFERRAL_PER_LEAD_CENTS, MEMBER_SPLIT_CENTS } from '@/lib/corporate'

// GET /api/admin/exec/corporate — the brand-strategist tracking door (Task 208).
// Every corporate claim, newest first, with its referral attribution, plus a
// per-strategist summary so the boss can see at a glance who is working the
// market and what the referral ledger owes once the referred accounts start
// taking managed leads.
//
// The payout column is a PROJECTION: claims x R50/lead assumes every referred
// office buys managed leads at some future volume. Real payouts accrue when
// DFY billing ships (Task 203 roadmap); this page never pretends otherwise.

const PAGE = 100

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit')) || PAGE, 200)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  const [rows, total] = await Promise.all([
    db.corporateLead.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.corporateLead.count(),
  ])

  // Per-strategist rollup: claims, member-sourced share, and the projection.
  const byStrategist = STRATEGISTS.map((s) => {
    const mine = rows.filter((r) => r.refSlug === s.slug)
    const memberSourced = mine.filter((r) => r.refMember).length
    return {
      slug: s.slug,
      name: s.name,
      company: s.company,
      claims: mine.length,
      memberSourced,
      directSourced: mine.length - memberSourced,
      projectedRand: (mine.length * REFERRAL_PER_LEAD_CENTS) / 100,
      splitNote: `R${(REFERRAL_PER_LEAD_CENTS - MEMBER_SPLIT_CENTS) / 100} strategist / R${MEMBER_SPLIT_CENTS / 100} member per managed lead, once accounts take managed leads`,
    }
  })

  return NextResponse.json({
    total,
    rows: rows.map((r) => ({
      id: r.id,
      business: r.business,
      contactName: r.contactName,
      email: r.email,
      phone: r.phone,
      teamSize: r.teamSize,
      message: r.message,
      source: r.source,
      status: r.status,
      refSlug: r.refSlug,
      refMember: r.refMember,
      createdAt: r.createdAt,
    })),
    byStrategist,
    referralLaw: {
      perLeadRand: REFERRAL_PER_LEAD_CENTS / 100,
      memberSplitRand: MEMBER_SPLIT_CENTS / 100,
      note: 'Projected only. Real payouts accrue with DFY billing.',
    },
  })
}
