import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getStrategist } from '@/lib/corporate'
import { checkDocsKey, findPartnerDoc } from '@/lib/partnerDocs'
import { newSigningToken, loadOriginalPdf, sha256hex } from '@/lib/esign'
import { sendSystemMail } from '@/lib/mailer'

// ============ E-SIGN SESSIONS — deal room side (Task 212) ============
// GET  (gate key) → the sessions list for this door's deal room.
// POST (gate key) → create a signing session for a private-docs PDF and email
//        the signer their /sign/<token> link (falls back to a copyable link
//        when the mail engine is not configured — shown honestly).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function gate(req: NextRequest, slug: string): boolean {
  const key = new URL(req.url).searchParams.get('key') || ''
  return checkDocsKey(key) && !!getStrategist(slug)
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  if (!gate(req, slug)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const sessions = await db.esignSession.findMany({
    where: { slug },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true, token: true, docTitle: true, signerName: true, signerEmail: true,
      status: true, sentVia: true, createdAt: true, viewedAt: true, signedAt: true,
      signedSha256: true,
    },
  })
  return NextResponse.json({ sessions }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const url = new URL(req.url)
  if (!gate(req, slug)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as
    | { file?: string; signerName?: string; signerEmail?: string }
    | null
  if (!body || !body.file || !body.signerName || !body.signerEmail) {
    return NextResponse.json({ error: 'file, signerName and signerEmail are required.' }, { status: 400 })
  }
  if (!EMAIL_RE.test(body.signerEmail)) {
    return NextResponse.json({ error: 'That email does not look valid.' }, { status: 400 })
  }
  const doc = findPartnerDoc(body.file)
  if (!doc || doc.base !== body.file || !body.file.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Unknown document (send the PDF).' }, { status: 400 })
  }

  // Verify the PDF is actually on disk before promising anyone a signing link.
  let originalSha256 = ''
  try {
    const { bytes } = await loadOriginalPdf(body.file)
    originalSha256 = sha256hex(bytes)
  } catch {
    return NextResponse.json({ error: 'Document file missing on the server.' }, { status: 500 })
  }

  const token = newSigningToken()
  const session = await db.esignSession.create({
    data: {
      token,
      slug,
      docBase: body.file,
      docTitle: doc.title,
      signerName: body.signerName.slice(0, 120),
      signerEmail: body.signerEmail.slice(0, 200),
      originalSha256,
    },
  })

  const origin = `${url.protocol}//${url.host}`
  const signUrl = `${origin}/sign/${token}`
  const mail = await sendSystemMail({
    to: session.signerEmail,
    subject: `Signature request: ${doc.title}`,
    body: `Hi ${session.signerName},\n\nThe draft "${doc.title}" is ready for your signature.\n\nOpen your signing page, review the document and draw your signature:\n${signUrl}\n\nThe signed copy and a certificate of electronic signature are generated automatically when you sign.`,
    title: doc.title,
    headline: 'Signature requested',
    ctaLabel: 'Review and sign',
    ctaUrl: signUrl,
    preheader: 'One document is waiting for your signature',
  })

  if (mail.ok) {
    await db.esignSession.update({ where: { id: session.id }, data: { sentVia: 'email', linkSentAt: new Date() } })
  }
  return NextResponse.json(
    { ok: true, token, url: signUrl, emailed: mail.ok, emailError: mail.ok ? undefined : mail.error },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// DELETE (gate key + token) → remove a signing session from this room: QA
// passes, mistaken sends, test rows. The stored signed copy lives inside the
// session row, so deleting the session deletes its copy and audit with it —
// that is the point: a removed session leaves no trace in the room.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const url = new URL(req.url)
  if (!gate(req, slug)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const token = url.searchParams.get('token') || ''
  if (!token) return NextResponse.json({ error: 'token is required.' }, { status: 400 })
  const session = await db.esignSession.findUnique({ where: { token } })
  if (!session || session.slug !== slug) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  await db.esignSession.delete({ where: { id: session.id } })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
