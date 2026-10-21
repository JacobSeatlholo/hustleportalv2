import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { sendMail } from '@/lib/mailer'
import { planState, FREE_LIMITS, upgradeJson } from '@/lib/limits'
import { rateLimit, tooMany } from '@/lib/ratelimit'

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

// POST /api/emails → send a draft (or ad-hoc mail) — plug & play:
// user's own Gmail if connected, otherwise the HustlePortal mail engine sends for them.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Send-rate ceiling per account: a human never hits 60 sends in an hour,
  // but this door sends real email through the platform mail engine — the
  // ceiling keeps a compromised or scripted account from turning HustlePortal
  // into a spam relay. 60/hour, generous and honest.
  const sendGate = rateLimit(`emails:send:${userId}`, 60, 60 * 60 * 1000)
  if (!sendGate.ok) {
    return NextResponse.json(tooMany(sendGate.retryAfterSec), { status: 429 })
  }
  const body = await req.json().catch(() => ({}))
  const to = String(body.to || '').trim()
  const subject = String(body.subject || '').trim()
  const mailBody = String(body.body || '').trim()
  if (!to || !to.includes('@')) return NextResponse.json({ error: 'A valid recipient email is required.' }, { status: 400 })
  if (!subject || !mailBody) return NextResponse.json({ error: 'Subject and body are required.' }, { status: 400 })

  // Free plan ceiling: 6 sent emails from the account. Failed sends never burn one.
  // Checked BEFORE the send so the sixth email still goes out on the button press.
  const { paid } = await planState(userId)
  let freeRemaining: number | undefined
  if (!paid) {
    const sent = await db.emailLog.count({ where: { userId, status: 'SENT' } })
    if (sent >= FREE_LIMITS.emailSends) return upgradeJson('email', FREE_LIMITS.emailSends)
    freeRemaining = FREE_LIMITS.emailSends - sent - 1
  }

  // Attachments (the Video Studio pitch video rides here): base64 strings,
  // sanitized and size capped inside sendMail — invalid entries drop quietly.
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.map((a: { filename?: unknown; content?: unknown }) => ({
        filename: String(a?.filename || 'attachment'),
        content: String(a?.content || ''),
      }))
    : undefined

  const result = await sendMail(userId, { to, subject, body: mailBody, attachments })
  const provider = result.ok ? result.provider : 'NONE'

  // If this send belongs to a logged draft, update it; otherwise log the send
  let email
  if (body.draftId) {
    const draft = await db.emailLog.findFirst({ where: { id: body.draftId, userId } })
    if (draft) {
      email = await db.emailLog.update({
        where: { id: draft.id },
        data: { toEmail: to, subject, body: mailBody, status: result.ok ? 'SENT' : 'FAILED', provider, error: result.ok ? null : result.error },
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
        provider,
        error: result.ok ? null : result.error,
      },
    })
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error, email }, { status: 400 })
  }
  return NextResponse.json({ email, notice: result.notice || null, freeRemaining: freeRemaining ?? null })
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
