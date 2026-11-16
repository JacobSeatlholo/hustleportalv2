import { NextRequest, NextResponse } from 'next/server'
import { getStrategist } from '@/lib/corporate'
import { checkDocsKey, findPartnerDoc, PRIVATE_DOCS_DIR } from '@/lib/partnerDocs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// ============ PARTNER DOC STREAMING (Task 211) ============
// GET /api/corporate/[slug]/docs?key=<gate key>&file=<name>.pdf|docx
// Gate: wrong or missing key returns a bare 404 — the endpoint does not
// advertise that it exists, and the allowlist means only the three deal-room
// documents can ever leave the server.

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const url = new URL(req.url)

  if (!checkDocsKey(url.searchParams.get('key'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  if (!getStrategist(slug)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const fileName = url.searchParams.get('file') || ''
  const doc = findPartnerDoc(fileName)
  if (!doc || doc.base !== fileName) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  try {
    const bytes = await readFile(path.join(PRIVATE_DOCS_DIR, doc.base))
    const isPdf = doc.base.toLowerCase().endsWith('.pdf')
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${doc.base}"`,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
}
