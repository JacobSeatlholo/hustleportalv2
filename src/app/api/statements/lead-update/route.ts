import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { hasStatementAccess } from '@/lib/statements'
import { resolveProject } from '@/lib/workspace'

// POST /api/statements/lead-update — the "Update lead?" door behind the prompt
// that follows a sent statement email. SEH-internal only (the same
// hasStatementAccess gate as every statements route).
//
// The send already happened (POST /api/emails with matchLead handed back the
// match); NOTHING is written until the boss taps the button that lands here.
// One tap, one atomic write:
//   { emailLogId, leadId, moveToWon? }  → pin the sent email to that lead's
//       timeline (open-tracking shows on the lead detail), and optionally move
//       the lead to WON (only ever forward to WON, never down);
//   { emailLogId, create: { company, email? } } → no lead matched, so add one
//       (stage WON, the statements book remembered in its notes) and pin the
//       email to it — next month's statement finds them on its own.
// Idempotent: relinking the same lead or keeping the same stage is a no-op.
// The prompt names the lead's current stage, so the tap IS the decision — the
// door just carries it out.

type Params = { params: Promise<{ id: string }> } // route symmetry; no [id] in this path

const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTE_SENT', 'WON', 'LOST']

async function gate() {
  const userId = await getUserId()
  if (!userId) return { err: 401 as const }
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, platformAdmin: true },
  })
  if (!me) return { err: 401 as const }
  if (!(await hasStatementAccess(me))) return { err: 403 as const }
  return { me }
}

export async function POST(req: NextRequest, _ctx: Params) {
  const g = await gate()
  if ('err' in g) return NextResponse.json({ error: g.err === 401 ? 'Unauthorized' : 'Forbidden' }, { status: g.err })
  const userId = g.me.id

  const body = await req.json().catch(() => ({}))
  const emailLogId = typeof body.emailLogId === 'string' ? body.emailLogId : ''
  if (!emailLogId) return NextResponse.json({ error: 'Missing emailLogId.' }, { status: 400 })
  const log = await db.emailLog.findFirst({ where: { id: emailLogId, userId } })
  if (!log) return NextResponse.json({ error: 'That email is not in your log.' }, { status: 404 })

  // ---- create path: no lead matched, the boss says add one ----
  if (body.create) {
    const company = String(body.create.company || '').trim()
    if (!company) return NextResponse.json({ error: 'A company name is required.' }, { status: 400 })
    const email = String(body.create.email || '').trim() || null
    const project = await resolveProject(userId, null)
    const lead = await db.lead.create({
      data: {
        userId,
        projectId: project.id,
        company,
        email,
        stage: 'WON',
        source: 'MANUAL',
        notes: 'Added from the statements book after emailing their statement.',
      },
      select: { id: true, company: true, stage: true },
    })
    await db.emailLog.update({ where: { id: log.id }, data: { leadId: lead.id } })
    return NextResponse.json({ ok: true, lead })
  }

  // ---- link path: pin the email to an existing lead ----
  const leadId = typeof body.leadId === 'string' ? body.leadId : ''
  if (!leadId) return NextResponse.json({ error: 'Missing leadId.' }, { status: 400 })
  const memberships = await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })
  const teamIds = memberships.map((m) => m.teamId)
  const lead = await db.lead.findFirst({
    where: { id: leadId, OR: [{ userId }, { teamId: { in: teamIds } }] },
  })
  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  const move = body.moveToWon === true && lead.stage !== 'WON' && STAGES.includes(lead.stage)
  const updated = await db.$transaction(async (tx) => {
    if (move) {
      await tx.lead.update({ where: { id: lead.id }, data: { stage: 'WON' } })
    }
    await tx.emailLog.update({ where: { id: log.id }, data: { leadId: lead.id } })
    return tx.lead.findUnique({ where: { id: lead.id }, select: { id: true, company: true, stage: true } })
  })
  return NextResponse.json({ ok: true, lead: updated, moved: move })
}
