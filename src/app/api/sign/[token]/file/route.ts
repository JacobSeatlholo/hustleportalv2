import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ============ SIGNER: download the signed PDF (Task 212) ============
// GET /api/sign/<token>/file — only after the session is SIGNED; streams the
// stamped copy (signature + execution block + certificate page) from Postgres.
// ?inline=1 renders in the browser (the signing page's preview pane); without
// it the file downloads as an attachment.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const session = await db.esignSession.findUnique({ where: { token } })
  if (!session || session.status !== 'SIGNED' || !session.signedPdf) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  // HTTP headers are ByteStrings — docBase can carry ™ or other non-ASCII
  // (the TDC agreement's filename does), so the header name is ASCII-folded.
  // The real name still shows in the session record and the page UI.
  const headerName = session.docBase.replace(/\.pdf$/i, '').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '') + '_SIGNED.pdf'
  const inline = new URL(req.url).searchParams.get('inline') === '1'
  return new NextResponse(new Uint8Array(session.signedPdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${headerName}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
