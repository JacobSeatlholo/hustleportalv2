import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { opportunisticTick } from '@/lib/campaignqueue'

// GET /api/mail/open/[id], the invisible 1x1 open tracker bound to an EmailLog
// row. Public by necessity (mail clients fetch it, no auth). First fetch stamps
// openedAt and bumps openCount; when the send is linked to a lead, the lead's
// pipeline stage moves NEW -> CONTACTED so the team sees who actually read.
// When the send is a campaign blast with no lead (the boss's imported lists),
// the first open instead upgrades the matching pool row: the mailbox answered,
// a human glanced, so the contact earns the OPENED segment and a real verify
// score. That is the hand earned path from cold list to verified pool face.

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
      select: { id: true, leadId: true, campaign: true, toEmail: true, openedAt: true },
    })
    if (log) {
      const firstOpen = !log.openedAt
      await db.emailLog.update({
        where: { id: log.id },
        data: { openCount: { increment: 1 }, ...(log.openedAt ? {} : { openedAt: new Date() }) },
      })
      if (log.leadId) {
        const lead = await db.lead.findUnique({ where: { id: log.leadId }, select: { stage: true } })
        if (lead?.stage === 'NEW') {
          await db.lead.update({ where: { id: log.leadId }, data: { stage: 'CONTACTED' } })
        }
      } else if (firstOpen && log.campaign && log.toEmail) {
        // Campaign send with no pipeline lead: the open feeds the pool instead.
        // The mailbox is real and a human looked, the strongest cold list signal
        // there is. Score jumps to 85 (open beats every passive check but never
        // a 100), state goes active, and the row moves to the OPENED segment so
        // the exec can distribute exactly the ones who engaged.
        const pool = await db.leadPool.findFirst({
          where: { email: log.toEmail.toLowerCase(), active: true },
          orderBy: { lastSeenAt: 'desc' },
          select: { id: true, poolTag: true, verifyScore: true },
        })
        if (pool) {
          const base = (pool.poolTag || '').replace(/-OPENED$/i, '')
          await db.leadPool.update({
            where: { id: pool.id },
            data: {
              verifyScore: Math.max(pool.verifyScore || 0, 85),
              verifyState: 'active',
              lastVerifiedAt: new Date(),
              poolTag: base ? `${base}-OPENED` : null,
            },
          })
        }
      }
    }
  } catch {
    // tracking must never break the email render
  }
  // Every opened mail nudges the queue engine forward (cooldown gated, DB
  // paced). Awaits first: serverless freezes work that starts after the
  // response, and the pixel is exactly the kind of traffic a live campaign
  // generates on its own.
  await opportunisticTick()
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    },
  })
}
