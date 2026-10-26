import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { applyLeadFeedback } from '@/lib/leadfeedback'

export const maxDuration = 15

/**
 * POST /api/leads/feedback, the seller's verdict on a lead's quality.
 *
 * One tap on the contact card: "Good fit", or "Not a fit" with a reason and
 * an optional word. The verdict lands on the lead, feeds the seller's taste
 * profile, pools onto the shared face, and a bad-fit platform lead goes
 * straight back to the pool for a better-fit seller. Own imports (MANUAL /
 * CSV) keep their place in the pipeline: their data stays theirs.
 *
 * feedback: "GOOD_FIT" | "BAD_FIT" | "CLEAR" (CLEAR undoes a verdict).
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || !body.leadId) {
    return NextResponse.json({ error: 'leadId required.' }, { status: 400 })
  }

  // Same visibility law as the rest of the pipeline: own rows, or rows shared
  // through a team the seller belongs to. A teammate's verdict is as honest
  // as the owner's, they sell to the same faces.
  const memberships = await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })
  const teamIds = memberships.map((m) => m.teamId)
  const lead = await db.lead.findFirst({
    where: { id: String(body.leadId), OR: [{ userId }, { teamId: { in: teamIds } }] },
    select: { id: true },
  })
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result = await applyLeadFeedback({
    leadId: lead.id,
    feedback: String(body.feedback || ''),
    reason: typeof body.reason === 'string' ? body.reason : null,
    note: typeof body.note === 'string' ? body.note : null,
  })
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 })

  const updated = await db.lead.findUnique({ where: { id: lead.id } })
  return NextResponse.json({ lead: updated, released: result.released, poolMatched: result.poolMatched, message: result.message })
}
