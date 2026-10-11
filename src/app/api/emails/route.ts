import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { sendViaUserGmail } from '@/lib/mailer'

// GET /api/emails → the user's email log (drafts first, newest first)
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const emails = await db.emailLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ emails })
}

// POST /api/emails → send a draft (or ad-hoc mail) via the user's own Gmail
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const to = String(body.to || '').trim()
  const subject = String(body.subject || '').trim()
  const mailBody = String(body.body || '').trim()
  if (!to || !to.includes('@')) return NextResponse.json({ error: 'A valid recipient email is required.' }, { status: 400 })
  if (!subject || !mailBody) return NextResponse.json({ error: 'Subject and body are required.' }, { status: 400 })

  const result = await sendViaUserGmail(userId, { to, subject, body: mailBody })

  // If this send belongs to a logged draft, update it; otherwise log the send
  let email
  if (body.draftId) {
    const draft = await db.emailLog.findFirst({ where: { id: body.draftId, userId } })
    if (draft) {
      email = await db.emailLog.update({
        where: { id: draft.id },
        data: { toEmail: to, subject, body: mailBody, status: result.ok ? 'SENT' : 'FAILED', error: result.ok ? null : result.error },
      })
    }
  }
  if (!email) {
    email = await db.emailLog.create({
      data: {
        userId,
        projectId: body.projectId || null,
        toEmail: to,
        subject,
        body: mailBody,
        status: result.ok ? 'SENT' : 'FAILED',
        error: result.ok ? null : result.error,
      },
    })
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error, email }, { status: 400 })
  }
  return NextResponse.json({ email })
}

// DELETE /api/emails?id= → remove a draft/log row
export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
  const existing = await db.emailLog.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.emailLog.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
