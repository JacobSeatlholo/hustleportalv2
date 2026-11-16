import { NextRequest, NextResponse } from 'next/server'
import { getStrategist } from '@/lib/corporate'
import { checkDocsKey, findPartnerDoc, PRIVATE_DOCS_DIR } from '@/lib/partnerDocs'
import { docusignConfig, docusignStatus, createEmbeddedSigning } from '@/lib/docusign'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// ============ DOCUSIGN SEND ROUTE (Task 211) ============
// GET  → { configured, missing } so the deal room can render an honest
//        connected / not-connected state.
// POST { file, signerName, signerEmail } → creates an envelope from the
//        private-docs PDF and returns the embedded signing URL. The browser
//        never touches DocuSign; only the recipient-view URL comes back.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const url = new URL(req.url)
  if (!checkDocsKey(url.searchParams.get('key')) || !getStrategist(slug)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  return NextResponse.json(docusignStatus(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const url = new URL(req.url)
  const key = url.searchParams.get('key') || ''
  if (!checkDocsKey(key) || !getStrategist(slug)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

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
  if (!doc || doc.base !== body.file || !doc.base.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Unknown document (send the PDF).' }, { status: 400 })
  }

  const cfg = docusignConfig()
  if (!cfg) {
    const { missing } = docusignStatus()
    return NextResponse.json(
      { error: `DocuSign is not connected yet. Missing env: ${missing.join(', ')}.` },
      { status: 503 },
    )
  }

  try {
    const bytes = await readFile(path.join(PRIVATE_DOCS_DIR, doc.base))
    const origin = `${url.protocol}//${url.host}`
    const result = await createEmbeddedSigning(cfg, {
      pdfBase64: Buffer.from(bytes).toString('base64'),
      docName: `${doc.title} (DRAFT)`,
      signerName: body.signerName,
      signerEmail: body.signerEmail,
      returnUrl: `${origin}/corporate/${slug}/documents?key=${encodeURIComponent(key)}&signed=1`,
      emailSubject: `${doc.title} — draft for signature (HustlePortal × Trinity Direct Consortium)`,
    })
    return NextResponse.json(
      { ok: true, envelopeId: result.envelopeId, url: result.url },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : 'DocuSign send failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
