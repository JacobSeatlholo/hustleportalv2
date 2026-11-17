import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadSessionOriginal, sha256hex, stampSignedPdf, sast } from '@/lib/esign'
import { sendSystemMail } from '@/lib/mailer'

// ============ SIGNER: execute the signature (Task 212) ============
// POST /api/sign/<token>/sign  body: { signaturePng (data URL), typedName, consent }
// Stamps the drawn signature + execution block onto the last page, appends
// the certificate page, stores the signed PDF in Postgres and emails the
// signer their copy link. One signature per session — replay returns 409.

const MAX_SIG_BYTES = 600_000

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const session = await db.esignSession.findUnique({ where: { token } })
  if (!session) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (session.status === 'SIGNED' || session.signedPdf) {
    return NextResponse.json({ error: 'This document has already been signed.' }, { status: 409 })
  }

  const body = (await req.json().catch(() => null)) as
    | { signaturePng?: string; initialsPng?: string; typedName?: string; consent?: boolean; typedFields?: Array<{ label?: string; value?: string }> }
    | null
  if (!body?.consent) {
    return NextResponse.json({ error: 'Consent is required to sign electronically.' }, { status: 400 })
  }
  const typedName = (body.typedName || '').trim()
  if (typedName.length < 2 || typedName.length > 120) {
    return NextResponse.json({ error: 'Type your full name to confirm the signature.' }, { status: 400 })
  }
  // Typed info rendered into the execution block (Task 215): up to 8
  // label/value rows, plain text, length-capped so the certificate page holds.
  const MAX_FIELDS = 8
  const typedFields: Array<{ label: string; value: string }> = []
  if (Array.isArray(body.typedFields)) {
    for (const f of body.typedFields.slice(0, MAX_FIELDS)) {
      const label = (f?.label || '').trim()
      const value = (f?.value || '').trim()
      if (!label && !value) continue
      if (!label || label.length > 60 || value.length > 200) {
        return NextResponse.json({ error: 'Typed fields need a label (max 60 chars) and a value (max 200 chars).' }, { status: 400 })
      }
      typedFields.push({ label, value })
    }
  }
  const dataUrl = body.signaturePng || ''
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match || match[1].length > MAX_SIG_BYTES) {
    return NextResponse.json({ error: 'Draw your signature in the box (image too large or invalid).' }, { status: 400 })
  }
  // Optional per-page initials (Task 214): drawn in their own box, stamped on
  // every page of the document before the certificate is appended.
  const MAX_INIT_BYTES = 300_000
  let initialsBase64: string | undefined
  if (body.initialsPng) {
    const initMatch = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.initialsPng)
    if (!initMatch || initMatch[1].length > MAX_INIT_BYTES) {
      return NextResponse.json({ error: 'The initials image is too large or invalid — clear it or sign without initials.' }, { status: 400 })
    }
    initialsBase64 = initMatch[1]
  }

  try {
    const { bytes: original, title } = await loadSessionOriginal(session)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const ua = (req.headers.get('user-agent') || 'unknown').slice(0, 300)
    const signedAt = new Date()

    const stamped = await stampSignedPdf({
      originalBytes: original,
      docTitle: title,
      sigPngBase64: match[1],
      initialsPngBase64: initialsBase64,
      typedName,
      typedFields,
      signerEmail: session.signerEmail,
      sessionId: session.id,
      signerIp: ip,
      userAgent: ua,
      originalSha256: session.originalSha256 || sha256hex(original),
      viewedAt: session.viewedAt,
      signedAt,
    })

    await db.esignSession.update({
      where: { id: session.id },
      data: {
        status: 'SIGNED',
        signedAt,
        signerIp: ip,
        signedUserAgent: ua,
        originalSha256: session.originalSha256 || sha256hex(original),
        signedSha256: stamped.signedSha256,
        signedPdf: Buffer.from(stamped.bytes),
      },
    })

    const origin = `${new URL(req.url).protocol}//${new URL(req.url).host}`
    await sendSystemMail({
      to: session.signerEmail,
      subject: `Signed: ${session.docTitle}`,
      body: `Hi ${session.signerName},\n\nYou signed "${session.docTitle}" on ${sast(signedAt)}.\n\nDownload your signed copy (the certificate of electronic signature is appended as the last page) any time from your signing page:\n${origin}/sign/${session.token}\n\nKeep this link — it is your copy of the signed document.`,
      title: 'Signature complete',
      headline: 'Document signed',
      ctaLabel: 'Download signed copy',
      ctaUrl: `${origin}/sign/${session.token}`,
      preheader: 'Your signed document is ready',
    })

    return NextResponse.json({ ok: true, signedAt: signedAt.toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Signing failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
