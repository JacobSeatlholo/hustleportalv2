import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadSessionOriginal } from '@/lib/esign'

// ============ SIGNER: stream the original PDF (Task 212) ============
// GET /api/sign/<token>/pdf — inline for the built-in viewer. The token IS the
// authority here; possession of it is the signing invitation. First view
// flips the session SENT → VIEWED and records IP + user agent for the audit.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const session = await db.esignSession.findUnique({ where: { token } })
  if (!session) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  if (session.status === 'SENT') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    await db.esignSession.update({
      where: { id: session.id },
      data: { status: 'VIEWED', viewedAt: new Date(), viewerIp: ip, userAgent: (req.headers.get('user-agent') || 'unknown').slice(0, 300) },
    })
  }

  try {
    const { bytes, filename } = await loadSessionOriginal(session)
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  } catch (e) {
    // Surface the real reason — a broken document link must be diagnosable.
    return NextResponse.json(
      { error: e instanceof Error ? `Document missing: ${e.message}` : 'Document missing.' },
      { status: 404 },
    )
  }
}
