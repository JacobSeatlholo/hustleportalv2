import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  sharedPageHtml,
  invalidTokenPage,
  HTML_HEADERS,
  type SharedComment,
} from '@/lib/meeting'

export const dynamic = 'force-dynamic'

// GET /m/<shareToken> — the shared meeting page the owner hands to both
// parties (WhatsApp, email, however they talk). Shows the appointment details,
// the note thread, and the actions either side may take: post a note, propose
// a new time, confirm a proposed time. The token is the credential: unguessable,
// stable, and it never expires — the page always reflects the latest truth.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const clean = String(token || '').trim()
  if (!clean) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })

  const meeting = await db.meeting.findUnique({
    where: { shareToken: clean },
    include: { comments: { orderBy: { createdAt: 'asc' } } },
  })
  const share = meeting?.shareToken || null
  if (!meeting || !share) {
    return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  }

  const msg = new URL(req.url).searchParams.get('msg')?.trim() || ''
  const comments: SharedComment[] = meeting.comments.map((c) => ({
    id: c.id,
    side: c.side,
    authorName: c.authorName,
    body: c.body,
    createdAt: c.createdAt,
  }))

  return new NextResponse(sharedPageHtml({ ...meeting, shareToken: share }, comments, msg), { headers: HTML_HEADERS })
}
