import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ============ SIGNER: download the signed PDF (Task 212) ============
// GET /api/sign/<token>/file — only after the session is SIGNED; streams the
// stamped copy (signature + execution block + certificate page) from Postgres.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const session = await db.esignSession.findUnique({ where: { token } })
  if (!session || session.status !== 'SIGNED' || !session.signedPdf) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  return new NextResponse(new Uint8Array(session.signedPdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${session.docBase.replace(/\.pdf$/i, '')}_SIGNED.pdf"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
