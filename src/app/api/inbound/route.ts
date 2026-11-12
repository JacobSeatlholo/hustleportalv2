import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'
import { matchLead } from '@/lib/leadMatch'
import { MAX_BODY_CHARS } from '@/lib/mailinbound'

// ============ UNMATCHED INBOUND QUEUE (executive) ============
//
// Mail that arrived at the capture address from a sender nothing resolved
// to waits here — the migration funnel made honest. The executive reviews
// it and either CLAIMs it for an account (their log gains the record, the
// relationship starts) or IGNOREs it (spam, wrong address, junk — and it
// never entered anyone's books). No auto-creation: a shared inbox must
// never guess which tenant an email belongs to.

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const rows = await db.inboundMail.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: { select: { name: true, email: true } } },
  })
  const counts = {
    unmatched: await db.inboundMail.count({ where: { status: 'UNMATCHED' } }),
    logged: await db.inboundMail.count({ where: { status: 'LOGGED' } }),
    ignored: await db.inboundMail.count({ where: { status: 'IGNORED' } }),
  }
  return NextResponse.json({ rows, counts })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  const action = String(body.action || '')
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

  const row = await db.inboundMail.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status !== 'UNMATCHED') {
    return NextResponse.json({ error: `Already ${row.status.toLowerCase()}.` }, { status: 400 })
  }

  if (action === 'IGNORE') {
    await db.inboundMail.update({ where: { id }, data: { status: 'IGNORED' } })
    return NextResponse.json({ ok: true, action: 'IGNORED' })
  }

  if (action === 'CLAIM') {
    // Claim target: the executive's own account by default, or a named
    // account (the migration hand-off). The target must exist.
    let targetId = gate.me.id
    if (typeof body.userId === 'string' && body.userId && body.userId !== gate.me.id) {
      const target = await db.user.findUnique({ where: { id: body.userId }, select: { id: true } })
      if (!target) return NextResponse.json({ error: 'Target account not found.' }, { status: 404 })
      targetId = target.id
    }

    // Same matching law as every other capture: ONE email match links the
    // pipeline contact, zero or many match nothing.
    let leadId: string | null = null
    try {
      const m = await matchLead(targetId, row.fromEmail, null)
      if (m.kind === 'ONE') leadId = m.lead.id
    } catch { /* linking is a bonus */ }

    const email = await db.emailLog.create({
      data: {
        userId: targetId,
        leadId,
        direction: 'IN',
        status: 'LOGGED',
        provider: 'SES_INBOUND',
        fromEmail: row.fromEmail,
        toEmail: row.toEmail || '(no visible recipients)',
        ccEmail: row.ccEmail,
        subject: row.subject,
        body: (row.textBody || '').slice(0, MAX_BODY_CHARS),
        sentAt: row.receivedAt,
      },
    })
    await db.inboundMail.update({
      where: { id },
      data: { status: 'LOGGED', userId: targetId, leadId, emailLogId: email.id },
    })
    return NextResponse.json({ ok: true, action: 'LOGGED', emailId: email.id })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
