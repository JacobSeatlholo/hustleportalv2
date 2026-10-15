import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { resolveProject } from '@/lib/workspace'
import { normKey } from '@/lib/leadpool'

export const maxDuration = 30

/**
 * The owner's hand pick: choose a verified contact from the shared pool and
 * drop it straight into any registered member's pipeline.
 *
 * This is the curation layer on top of the automated feeds. The pool drinks
 * from the outreach projects and every scan; here the owner reads it, filters
 * it by project or search, and hands the right faces to the right member —
 * the member finds them waiting in their pipeline, stage New, source TEAM,
 * at no cost to them.
 *
 * GUARD: the standard exec gate. A regular member session hits the same 403
 * wall as every other exec surface.
 */

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const url = new URL(req.url)
  const q = clean(url.searchParams.get('q')).toLowerCase()
  const tag = clean(url.searchParams.get('tag'))
  const take = Math.min(Math.max(Number(url.searchParams.get('take')) || 60, 1), 120)

  const where = {
    active: true,
    verifyState: { not: 'stale' },
    ...(tag ? { poolTag: tag } : {}),
  }
  const [rows, facets, activeTotal] = await Promise.all([
    db.leadPool.findMany({
      where,
      orderBy: [{ verifyScore: 'desc' }, { lastSeenAt: 'desc' }],
      take: 200,
      select: {
        id: true, company: true, contactName: true, role: true, email: true, phone: true,
        website: true, city: true, industry: true, poolTag: true, why: true,
        verifyScore: true, confirmCount: true, verifyChecks: true, timesServed: true, lastSeenAt: true,
      },
    }),
    db.leadPool.groupBy({ by: ['poolTag'], where: { active: true, verifyState: { not: 'stale' } }, _count: { _all: true } }),
    db.leadPool.count({ where: { active: true, verifyState: { not: 'stale' } } }),
  ])

  // The search runs in memory over the head rows: the pool is thousands, not
  // millions, and the owner searches by name, city, industry or contact.
  const filtered = rows
    .filter((r) => {
      if (!q) return true
      return [r.company, r.city, r.industry, r.contactName, r.email, r.poolTag]
        .some((f) => (f || '').toLowerCase().includes(q))
    })
    .slice(0, take)

  return NextResponse.json({
    ok: true,
    total: activeTotal,
    facets: facets.map((f) => ({ tag: f.poolTag || '', count: f._count._all })),
    rows: filtered.map((r) => ({
      id: r.id,
      company: r.company,
      ...(r.contactName ? { contactName: r.contactName } : {}),
      ...(r.role ? { role: r.role } : {}),
      ...(r.email ? { email: r.email } : {}),
      ...(r.phone ? { phone: r.phone } : {}),
      ...(r.website ? { website: r.website } : {}),
      ...(r.city ? { city: r.city } : {}),
      ...(r.industry ? { industry: r.industry } : {}),
      ...(r.poolTag ? { poolTag: r.poolTag } : {}),
      ...(r.why ? { why: r.why } : {}),
      verifyScore: r.verifyScore,
      confirmCount: r.confirmCount,
      served: r.timesServed,
      seenAt: r.lastSeenAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({}))
  const userId = clean(body?.userId)
  const poolIds: string[] = Array.isArray(body?.poolIds) ? body.poolIds.filter((x: unknown) => typeof x === 'string').slice(0, 100) : []
  if (!userId) return NextResponse.json({ error: 'Pick a member first.' }, { status: 400 })
  if (poolIds.length === 0) return NextResponse.json({ error: 'Pick at least one contact.' }, { status: 400 })

  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, accountStatus: true } })
  if (!target) return NextResponse.json({ error: 'That member is not on the platform anymore.' }, { status: 404 })
  if (target.accountStatus === 'SUSPENDED') {
    return NextResponse.json({ error: `${target.name} is paused right now. Restore their account first, then hand them leads.` }, { status: 409 })
  }

  const project = await resolveProject(userId, typeof body?.projectId === 'string' ? body.projectId : null)
  const picks = await db.leadPool.findMany({ where: { id: { in: poolIds }, active: true } })

  // A member never receives the same company twice: their existing pipeline
  // is the first dedupe, the hand picked batch dedupes itself too.
  const existing = await db.lead.findMany({ where: { userId }, select: { company: true }, take: 5000 })
  const seen = new Set(existing.map((l) => normKey(l.company)))

  let added = 0
  let skipped = 0
  const touched: string[] = []
  for (const p of picks) {
    const key = normKey(p.company)
    if (!key || seen.has(key)) { skipped++; continue }
    seen.add(key)
    try {
      await db.lead.create({
        data: {
          userId,
          projectId: project.id,
          company: p.company,
          contactName: p.contactName,
          role: p.role,
          profileUrl: p.profileUrl,
          email: p.email,
          phone: p.phone || p.phoneRaw,
          website: p.website,
          industry: p.industry,
          city: p.city,
          country: 'South Africa',
          source: 'TEAM',
          stage: 'NEW',
          value: 0,
          unlocked: Boolean(p.email || p.phone),
          notes: `Hand picked for you by the Business Hustle team from our verified contact pool.${p.why ? ` Fit: ${p.why}` : ''}${p.website ? ` Verify them at ${p.website}` : ''}`,
        },
        select: { id: true },
      })
      touched.push(p.id)
      added++
    } catch {
      skipped++
    }
  }

  // Rotation bookkeeping: a handed over contact has been served, so scans
  // keep meeting fresh faces instead of the same names.
  if (touched.length > 0) {
    await db.leadPool
      .updateMany({ where: { id: { in: touched } }, data: { timesServed: { increment: 1 }, lastServedAt: new Date() } })
      .catch(() => {})
  }

  const message =
    added === 0
      ? `Nothing new to hand over: ${skipped === 1 ? 'that contact is' : 'those contacts are'} already in ${target.name}'s pipeline.`
      : `${added} verified contact${added === 1 ? '' : 's'} now waiting in ${target.name}'s pipeline (${project.name}).${skipped > 0 ? ` ${skipped} skipped as already there.` : ''}`

  return NextResponse.json({
    ok: true,
    added,
    skipped,
    member: { id: target.id, name: target.name, email: target.email },
    projectName: project.name,
    message,
  })
}
