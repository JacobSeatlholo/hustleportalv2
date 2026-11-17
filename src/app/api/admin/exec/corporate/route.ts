import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'
import { STRATEGISTS, REFERRAL_PER_LEAD_CENTS, MEMBER_SPLIT_CENTS } from '@/lib/corporate'
import { generateAccessCode } from '@/lib/corporateAccess'

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

  // ?action=codes — the access-code hand-out ledger (Task 215).
  if (url.searchParams.get('action') === 'codes') {
    const codes = await db.corporateAccessCode.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
    return NextResponse.json({
      codes: codes.map((c) => ({
        id: c.id,
        code: c.code,
        label: c.label,
        slug: c.slug,
        viaCode: c.viaCode,
        maxUses: c.maxUses,
        usedCount: c.usedCount,
        active: c.active,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
      })),
    })
  }

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
      industry: r.industry,
      leadsNeeded: r.leadsNeeded,
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

// POST /api/admin/exec/corporate — the access-code mint and the application
// workflow (Task 215). Actions:
//   { action: 'mint-code', label?, slug?, viaCode?, maxUses?, expiresInDays? }
//       → a hand-out code for the locked corporate door. Attribution is baked
//         into the code so claims that ride it land on the right strategist.
//   { action: 'deactivate-code', codeId } → pull a code off the street.
//   { action: 'mark-application', leadId, status } → APPROVED | REJECTED | CONTACTED.
export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'mint-code') {
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) || null : null
    const slug = typeof body.slug === 'string' && STRATEGISTS.some((s) => s.slug === body.slug) ? body.slug : null
    const viaCode = typeof body.viaCode === 'string' ? body.viaCode.trim().toUpperCase().slice(0, 40) || null : null
    const maxUses = Math.min(Math.max(Number(body.maxUses) || 1, 1), 500)
    const expiresInDays = Math.min(Math.max(Number(body.expiresInDays) || 0, 0), 365)
    const row = await db.corporateAccessCode.create({
      data: {
        code: generateAccessCode(),
        label,
        slug,
        viaCode: slug ? viaCode : null, // member attribution only makes sense with its door
        maxUses,
        expiresAt: expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
        createdBy: gate.me.id,
      },
    })
    return NextResponse.json({ ok: true, code: row.code, id: row.id, maxUses: row.maxUses, expiresAt: row.expiresAt })
  }

  if (action === 'deactivate-code') {
    const codeId = typeof body.codeId === 'string' ? body.codeId : ''
    if (!codeId) return NextResponse.json({ error: 'codeId is required.' }, { status: 400 })
    const row = await db.corporateAccessCode.update({ where: { id: codeId }, data: { active: false } })
    return NextResponse.json({ ok: true, id: row.id, active: row.active })
  }

  if (action === 'mark-application') {
    const leadId = typeof body.leadId === 'string' ? body.leadId : ''
    const status = typeof body.status === 'string' ? body.status : ''
    if (!leadId || !['CONTACTED', 'APPROVED', 'REJECTED', 'WON', 'LOST'].includes(status)) {
      return NextResponse.json({ error: 'leadId and a valid status are required.' }, { status: 400 })
    }
    const row = await db.corporateLead.update({ where: { id: leadId }, data: { status } })
    return NextResponse.json({ ok: true, id: row.id, status: row.status })
  }

  return NextResponse.json({ error: 'Unknown action. Use mint-code, deactivate-code or mark-application.' }, { status: 400 })
}
