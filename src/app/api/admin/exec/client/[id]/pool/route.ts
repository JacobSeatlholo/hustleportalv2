import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { resolveProject } from '@/lib/workspace'
import { runClientCampaign } from '@/lib/campaign'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/admin/exec/client/[id]/pool — run a lead campaign for this client,
// right now. Body: { definition?, city?, limit? }. Explee first, the platform's
// verified pool as the free fallback. Results land on the client's bench
// (status NEW), never straight in their pipeline: the owner reviews first.
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const definition = typeof body?.definition === 'string' ? body.definition.slice(0, 400) : undefined
  const city = typeof body?.city === 'string' ? body.city.slice(0, 80) : undefined
  const limit = Number.isFinite(Number(body?.limit)) ? Number(body.limit) : undefined

  const result = await runClientCampaign(id, { definition, city, limit })
  if (!result) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const counts = await db.clientPoolLead.groupBy({ by: ['status'], where: { userId: id }, _count: { _all: true } })
  const countMap = Object.fromEntries(counts.map((g) => [g.status, g._count._all]))

  const message =
    result.mode === 'SKIPPED'
      ? (result.note || 'A campaign just ran for this client. Their pool is already stocked.')
      : result.mode === 'EXPLEE'
        ? `Explee delivered ${result.served} candidate${result.served === 1 ? '' : 's'}: ${result.added} new on their pool${result.skipped ? `, ${result.skipped} skipped as duplicates` : ''}.`
        : result.served > 0
          ? `${result.added} fresh face${result.added === 1 ? '' : 's'} from your verified pool${result.skipped ? `, ${result.skipped} skipped as duplicates` : ''}.`
          : 'No new faces this round. Widen the search words or try again after the next scans warm the pool.'

  return NextResponse.json({
    ok: true,
    ...result,
    poolCounts: { NEW: countMap.NEW ?? 0, ADDED: countMap.ADDED ?? 0, DISMISSED: countMap.DISMISSED ?? 0 },
    message,
  })
}

// PATCH /api/admin/exec/client/[id]/pool — work the bench.
// Body: { action: 'add' | 'addAll' | 'dismiss', ids?: string[], projectId? }
//   add      → named rows join the client's pipeline (stage NEW) and leave the bench
//   addAll   → every waiting row joins
//   dismiss  → named rows are set aside (they stop counting as waiting)
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const body = await req.json().catch(() => ({}))
  const action = body?.action
  if (action !== 'add' && action !== 'addAll' && action !== 'dismiss') {
    return NextResponse.json({ error: 'Action must be add, addAll or dismiss.' }, { status: 400 })
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string').slice(0, 200) : []
  if ((action === 'add' || action === 'dismiss') && ids.length === 0) {
    return NextResponse.json({ error: 'Pick at least one lead first.' }, { status: 400 })
  }

  const waiting = await db.clientPoolLead.findMany({
    where: { userId: id, status: 'NEW', ...(action === 'addAll' ? {} : { id: { in: ids } }) },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })
  if (waiting.length === 0) {
    return NextResponse.json({ ok: true, added: 0, dismissed: 0, message: 'Nothing waiting on that pick.' })
  }

  if (action === 'dismiss') {
    const r = await db.clientPoolLead.updateMany({
      where: { id: { in: waiting.map((w) => w.id) }, userId: id },
      data: { status: 'DISMISSED' },
    })
    return NextResponse.json({ ok: true, added: 0, dismissed: r.count, message: `${r.count} lead${r.count === 1 ? '' : 's'} set aside. They can come back on a later campaign.` })
  }

  // add / addAll → the client's pipeline. Workspace: explicit projectId (validated)
  // else the client's default project. Sources ride along so the client sees
  // exactly where each face came from, in words a member understands.
  const project = await resolveProject(id, typeof body?.projectId === 'string' ? body.projectId : null)

  let added = 0
  const stamps: { leadId: string; poolId: string }[] = []
  for (const w of waiting) {
    try {
      const lead = await db.lead.create({
        data: {
          userId: id,
          projectId: project.id,
          company: w.company,
          contactName: w.contactName,
          role: w.role,
          profileUrl: w.profileUrl,
          email: w.email,
          phone: w.phone,
          website: w.website,
          industry: w.industry,
          city: w.city,
          country: w.country,
          source: w.source === 'EXPLEE' ? 'TEAM' : w.source,
          stage: 'NEW',
          value: 0,
          notes: `Loaded by the business owner from the verified lead pool.${w.website ? ` Verify them at ${w.website}` : ''}${w.sourceRef ? ` Source: ${w.sourceRef}` : ''}`,
        },
        select: { id: true },
      })
      stamps.push({ leadId: lead.id, poolId: w.id })
      added++
    } catch {
      /* a rare create failure must not stop the rest of the batch */
    }
  }

  await Promise.all(
    stamps.map((s) =>
      db.clientPoolLead
        .update({ where: { id: s.poolId }, data: { status: 'ADDED', leadId: s.leadId, addedAt: new Date() } })
        .catch(() => {})
    )
  )

  const skipped = waiting.length - added
  return NextResponse.json({
    ok: true,
    added,
    dismissed: 0,
    projectName: project.name,
    message: `${added} lead${added === 1 ? '' : 's'} now in ${target.name}'s pipeline (${project.name}).${skipped ? ` ${skipped} could not be saved.` : ''}`,
  })
}
