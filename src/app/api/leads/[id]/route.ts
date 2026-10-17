import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'

type Params = { params: Promise<{ id: string }> }

const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTE_SENT', 'WON', 'LOST']

async function findLead(userId: string, id: string) {
  // own lead, or one shared via a team the user belongs to
  const memberships = await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })
  const teamIds = memberships.map((m) => m.teamId)
  return db.lead.findFirst({
    where: { id, OR: [{ userId }, { teamId: { in: teamIds } }] },
  })
}

// PATCH /api/leads/[id] → stage moves, value/notes/contact edits
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const lead = await findLead(userId, id)
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (typeof body.stage === 'string') {
    if (!STAGES.includes(body.stage)) {
      return NextResponse.json({ error: 'Unknown pipeline stage.' }, { status: 400 })
    }
    if (body.stage !== lead.stage) data.stage = body.stage
  }
  if (typeof body.value === 'number' && Number.isFinite(body.value) && body.value >= 0) data.value = body.value
  if ('notes' in body) data.notes = body.notes == null ? null : String(body.notes)
  if ('contactName' in body) data.contactName = body.contactName || null
  if ('email' in body) data.email = body.email || null
  if ('phone' in body) data.phone = body.phone || null
  if ('score' in body) data.score = typeof body.score === 'number' ? body.score : null

  // Move the contact into another pipeline (project). Owner only — a teammate
  // viewing a shared lead cannot re-home it. Stage and notes travel with it.
  if ('projectId' in body) {
    if (lead.userId !== userId) {
      return NextResponse.json({ error: 'Only the lead owner can move it between projects.' }, { status: 403 })
    }
    const next = body.projectId == null || body.projectId === '' ? null : String(body.projectId)
    if (next) {
      const project = await db.project.findFirst({ where: { id: next, userId: lead.userId }, select: { id: true } })
      if (!project) return NextResponse.json({ error: 'That project does not exist.' }, { status: 400 })
      if (project.id !== lead.projectId) data.projectId = project.id
    } else if (lead.projectId) {
      data.projectId = null
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ lead })
  }
  const updated = await db.lead.update({ where: { id: lead.id }, data })

  // XP for moving a lead FORWARD in the pipeline
  if (
    typeof data.stage === 'string' &&
    STAGES.indexOf(String(data.stage)) > STAGES.indexOf(lead.stage) &&
    !['WON', 'LOST'].includes(lead.stage)
  ) {
    await bumpChallenge(lead.userId, 'move_stage')
  }

  return NextResponse.json({ lead: updated })
}

// DELETE /api/leads/[id] → owner only
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const lead = await db.lead.findFirst({ where: { id, userId } })
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.lead.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
