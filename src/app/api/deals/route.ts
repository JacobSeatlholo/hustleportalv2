import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { myTeamIds } from '@/lib/dealroom'

// ============ DEALS — the in-platform deal room (Task 213) ============
// GET  ?scope=mine|team → the pipeline (light list for the board)
// POST { title, company, contactName, contactEmail?, contactPhone?, value?, teamId? }
//       → create a deal by filling in the form. ownerId = creatorId = caller;
//         teamId null = private to the owner.

export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scope = new URL(req.url).searchParams.get('scope') || 'mine'
  const teamIds = await myTeamIds(userId)

  let where: Record<string, unknown>
  if (scope === 'team') {
    if (teamIds.length === 0) return NextResponse.json({ deals: [] })
    where = { teamId: { in: teamIds } }
  } else {
    where = {
      OR: [
        { ownerId: userId },
        { creatorId: userId },
        ...(teamIds.length ? [{ teamId: { in: teamIds } }] : []),
      ],
    }
  }

  const deals = await db.deal.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: {
      id: true, title: true, company: true, contactName: true, contactEmail: true,
      contactPhone: true, value: true, stage: true, notes: true, ownerId: true,
      teamId: true, createdAt: true, updatedAt: true,
      owner: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      _count: { select: { tasks: true, docs: true } },
    },
  })
  return NextResponse.json({ deals })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as {
    title?: string; company?: string; contactName?: string; contactEmail?: string
    contactPhone?: string; value?: number | string; teamId?: string | null
  } | null
  if (!body?.title?.trim() || !body?.company?.trim() || !body?.contactName?.trim()) {
    return NextResponse.json({ error: 'Deal name, company and contact person are required.' }, { status: 400 })
  }

  const value = body.value === '' || body.value === null || body.value === undefined
    ? null
    : Number(body.value)
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    return NextResponse.json({ error: 'Deal value must be a number in rands.' }, { status: 400 })
  }

  let linkedTeamId: string | null = null
  if (body.teamId) {
    const member = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId: body.teamId, userId } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member of that team.' }, { status: 403 })
    linkedTeamId = body.teamId
  }

  const deal = await db.deal.create({
    data: {
      title: body.title.trim().slice(0, 160),
      company: body.company.trim().slice(0, 160),
      contactName: body.contactName.trim().slice(0, 120),
      contactEmail: body.contactEmail?.trim().slice(0, 200) || null,
      contactPhone: body.contactPhone?.trim().slice(0, 60) || null,
      value,
      ownerId: userId,
      creatorId: userId,
      teamId: linkedTeamId,
    },
    include: {
      owner: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      _count: { select: { tasks: true, docs: true } },
    },
  })
  return NextResponse.json({ deal }, { status: 201 })
}
