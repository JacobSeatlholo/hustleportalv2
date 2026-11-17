import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { canSeeDeal, DEAL_STAGES } from '@/lib/dealroom'

// ============ DEAL DETAIL (Task 213) ============
// GET    → the deal with its tasks, documents and signing sessions
// PATCH  { stage?, notes?, title?, company?, contactName?, contactEmail?, contactPhone?, value? }
// DELETE → owner or creator only; blocked while any document still has a
//          signing session (signed records must stay intact).

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const deal = await canSeeDeal(id, userId)
  if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 })

  const [tasks, docs] = await Promise.all([
    db.task.findMany({
      where: { dealId: id },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true, title: true, status: true, priority: true, dueDate: true,
        createdAt: true, isPrivate: true,
        assignee: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
        _count: { select: { comments: true, docs: true } },
      },
    }),
    db.docFile.findMany({
      where: { dealId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, filename: true, size: true, sha256: true, uploaderId: true, createdAt: true, taskId: true },
    }),
  ])

  const docIds = docs.map((d) => d.id)
  const sessions = docIds.length
    ? await db.esignSession.findMany({
        where: { docFileId: { in: docIds } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, token: true, docFileId: true, docTitle: true, signerName: true,
          signerEmail: true, status: true, sentVia: true, createdAt: true, viewedAt: true, signedAt: true,
        },
      })
    : []

  return NextResponse.json({ deal, tasks, docs, sessions })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const deal = await canSeeDeal(id, userId)
  if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as {
    stage?: string; notes?: string | null; title?: string; company?: string
    contactName?: string; contactEmail?: string | null; contactPhone?: string | null
    value?: number | string | null
  } | null
  if (!body) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (body.stage !== undefined) {
    if (!DEAL_STAGES.includes(body.stage as (typeof DEAL_STAGES)[number])) {
      return NextResponse.json({ error: 'Unknown stage.' }, { status: 400 })
    }
    data.stage = body.stage
  }
  if (body.notes !== undefined) data.notes = body.notes?.trim() ? body.notes.trim().slice(0, 4000) : null
  if (body.title !== undefined && body.title.trim()) data.title = body.title.trim().slice(0, 160)
  if (body.company !== undefined && body.company.trim()) data.company = body.company.trim().slice(0, 160)
  if (body.contactName !== undefined && body.contactName.trim()) data.contactName = body.contactName.trim().slice(0, 120)
  if (body.contactEmail !== undefined) data.contactEmail = body.contactEmail?.trim().slice(0, 200) || null
  if (body.contactPhone !== undefined) data.contactPhone = body.contactPhone?.trim().slice(0, 60) || null
  if (body.value !== undefined) {
    const v = body.value === '' || body.value === null ? null : Number(body.value)
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      return NextResponse.json({ error: 'Deal value must be a number in rands.' }, { status: 400 })
    }
    data.value = v
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const updated = await db.deal.update({
    where: { id },
    data,
    include: {
      owner: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      _count: { select: { tasks: true, docs: true } },
    },
  })
  return NextResponse.json({ deal: updated })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const deal = await canSeeDeal(id, userId)
  if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 })
  if (deal.ownerId !== userId && deal.creatorId !== userId) {
    return NextResponse.json({ error: 'Only the deal owner can delete it.' }, { status: 403 })
  }
  const sessions = await db.esignSession.count({ where: { docFile: { dealId: id } } })
  if (sessions > 0) {
    return NextResponse.json(
      { error: 'This deal has documents with signing sessions. Signed records cannot be deleted.' },
      { status: 409 },
    )
  }
  await db.deal.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
