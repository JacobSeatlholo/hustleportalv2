import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { canSeeDoc } from '@/lib/dealroom'
import { newSigningToken } from '@/lib/esign'
import { sendSystemMail } from '@/lib/mailer'

// ============ E-SIGN FROM AN UPLOADED DOCUMENT (Task 213) ============
// POST /api/docs/<id>/esign { signerName, signerEmail } → creates a first-party
// signing session (Task 212 engine) for the uploaded PDF and emails the signer
// their /sign/<token> link. Sessions created here carry docFileId, so the
// signer's page streams exactly the uploaded bytes; slug 'platform' marks it
// as an in-app deal room session rather than a strategist-door one.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s]+$/

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const doc = await canSeeDoc(id, userId)
  if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
  if (!doc.filename.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Only PDFs can be signed.' }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as
    | { signerName?: string; signerEmail?: string }
    | null
  const signerName = body?.signerName?.trim() || ''
  const signerEmail = body?.signerEmail?.trim() || ''
  if (!signerName || !signerEmail) {
    return NextResponse.json({ error: 'signerName and signerEmail are required.' }, { status: 400 })
  }
  if (!EMAIL_RE.test(signerEmail)) {
    return NextResponse.json({ error: 'That email does not look valid.' }, { status: 400 })
  }

  const title = doc.filename.replace(/\.pdf$/i, '')
  const token = newSigningToken()
  const session = await db.esignSession.create({
    data: {
      token,
      slug: 'platform',
      docBase: doc.filename,
      docTitle: title,
      docFileId: doc.id,
      signerName: signerName.slice(0, 120),
      signerEmail: signerEmail.slice(0, 200),
      originalSha256: doc.sha256, // pinned at upload — the signer sees exactly these bytes
    },
  })

  const origin = `${new URL(req.url).protocol}//${new URL(req.url).host}`
  const signUrl = `${origin}/sign/${token}`
  const mail = await sendSystemMail({
    to: signerEmail,
    subject: `Signature request: ${title}`,
    body: `Hi ${signerName},\n\nThe document "${title}" is ready for your signature.\n\nOpen your signing page, review the document and draw your signature:\n${signUrl}\n\nThe signed copy and a certificate of electronic signature are generated automatically when you sign.`,
    title,
    headline: 'Signature requested',
    ctaLabel: 'Review and sign',
    ctaUrl: signUrl,
    preheader: 'One document is waiting for your signature',
  })
  if (mail.ok) {
    await db.esignSession.update({ where: { id: session.id }, data: { sentVia: 'email', linkSentAt: new Date() } })
  }

  return NextResponse.json(
    {
      ok: true,
      session: {
        id: session.id, token, docTitle: title, signerName, signerEmail,
        status: session.status, createdAt: session.createdAt,
      },
      url: signUrl,
      emailed: mail.ok,
      emailError: mail.ok ? undefined : mail.error,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
