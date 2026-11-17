import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { canSeeDoc } from '@/lib/dealroom'

// ============ DOCUMENT FILE (Task 213) ============
// GET /api/docs/<id>/file → stream the original PDF (visible to whoever can
// see the parent task or deal). Deletion lives on /api/docs/<id>.

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const meta = await canSeeDoc(id, userId)
  if (!meta) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
  const doc = await db.docFile.findUnique({ where: { id } })
  if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
  return new NextResponse(new Uint8Array(doc.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${doc.filename.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
