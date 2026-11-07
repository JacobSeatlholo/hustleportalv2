import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

interface IncomingDraft {
  to?: string
  subject?: string
  body?: string
}

// POST /api/admin/exec/client/[id]/mail-drafts — stage ready-to-review email
// drafts into a member's Mail. Body: { campaign: string, drafts: IncomingDraft[] }
//
// This is the approval gate for client campaigns, by design: the team
// running the campaign writes the outreach once, the drafts land in the
// member's Email log as DRAFT rows, and NOTHING sends until the member
// opens a draft, checks it and presses Send themself (the composer's normal
// send path — wallet airtime law, free-send bundle and the
// failed-send-no-charge promise all apply untouched).
//
// Every draft row keeps the campaign tag, so the open tracker can later tie
// a read receipt back to this campaign and promote the bench lead into the
// pipeline (see /api/mail/open/[id]).
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const body = await req.json().catch(() => ({}))
  const campaign = typeof body?.campaign === 'string' ? body.campaign.trim().slice(0, 60) : ''
  const incoming: IncomingDraft[] = Array.isArray(body?.drafts) ? body.drafts.slice(0, 50) : []
  if (!campaign) return NextResponse.json({ error: 'A campaign tag is required.' }, { status: 400 })
  if (incoming.length === 0) return NextResponse.json({ error: 'Give me at least one draft.' }, { status: 400 })

  const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  // Dedup: never stage the same campaign → same address twice, so a re-run
  // of the staging script cannot flood the member's log with copies.
  const existing = await db.emailLog.findMany({
    where: { userId: id, campaign },
    select: { toEmail: true, status: true },
    take: 500,
  })
  const already = new Set(existing.map((e) => `${e.toEmail.toLowerCase()}|${e.status}`))

  const rows: { userId: string; toEmail: string; subject: string; body: string; status: string; campaign: string }[] = []
  let skipped = 0
  for (const d of incoming) {
    const to = String(d.to || '').trim()
    const subject = String(d.subject || '').trim()
    const mailBody = String(d.body || '').trim()
    if (!to.includes('@') || !subject || mailBody.length < 10) { skipped++; continue }
    if (already.has(`${to.toLowerCase()}|DRAFT`) || already.has(`${to.toLowerCase()}|SENT`)) { skipped++; continue }
    rows.push({
      userId: id,
      toEmail: to,
      subject,
      body: mailBody,
      status: 'DRAFT',
      campaign,
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, created: 0, skipped, message: 'Nothing new to stage — every draft is already waiting (or sent) for this campaign.' })
  }

  const result = await db.emailLog.createMany({ data: rows })
  return NextResponse.json({
    ok: true,
    created: result.count,
    skipped,
    message: `${result.count} draft${result.count === 1 ? '' : 's'} staged into ${target.name}'s Mail under "${campaign}". Nothing sends until they open, check and press Send.`,
  })
}
