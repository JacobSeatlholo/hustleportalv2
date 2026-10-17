import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

// GET /api/mail/open/[id] — the invisible 1x1 open tracker bound to an EmailLog
// row. Public by necessity (mail clients fetch it, no auth). First fetch stamps
// openedAt and bumps openCount; when the send is linked to a lead, the lead's
// pipeline stage moves NEW -> CONTACTED so the team sees who actually read.

type Ctx = { params: Promise<{ id: string }> }

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  try {
    const log = await db.emailLog.findUnique({
      where: { id },
      select: { id: true, leadId: true, openedAt: true },
    })
    if (log) {
      await db.emailLog.update({
        where: { id: log.id },
        data: { openCount: { increment: 1 }, ...(log.openedAt ? {} : { openedAt: new Date() }) },
      })
      if (log.leadId) {
        const lead = await db.lead.findUnique({ where: { id: log.leadId }, select: { stage: true } })
        if (lead?.stage === 'NEW') {
          await db.lead.update({ where: { id: log.leadId }, data: { stage: 'CONTACTED' } })
        }
      }
    }
  } catch {
    // tracking must never break the email render
  }
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    },
  })
}
