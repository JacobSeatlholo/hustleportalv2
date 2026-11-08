import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { opportunisticTick } from '@/lib/campaignqueue'
import { resolveProject } from '@/lib/workspace'

// GET /api/mail/open/[id], the invisible 1x1 open tracker bound to an EmailLog
// row. Public by necessity (mail clients fetch it, no auth). First fetch stamps
// openedAt and bumps openCount; when the send is linked to a lead, the lead's
// pipeline stage moves NEW -> CONTACTED so the team sees who actually read.
// When the send is a campaign blast with no lead (the boss's imported lists),
// the first open instead upgrades the matching pool row: the mailbox answered,
// a human glanced, so the contact earns the OPENED segment and a real verify
// score. That is the hand earned path from cold list to verified pool face.
// Exec-staged blasts (the owner's own treg/OSM harvest) queue raw addresses
// with no leadId — their opens first try the sender's OWN bench (Lead rows
// matching the sender's userId, NEW -> CONTACTED) before the pool upgrade.
// For a member's campaign send to a bench lead (exec staged, ClientPoolLead),
// the read receipt is the promotion moment: the bench row joins the pipeline
// as a real CONTACTED lead, unlocked — the member's own sent mail already
// carries the address, charging to see it would be a paywall on their own
// outbox. Only read receipts earn this; silence never moves a row.

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
      select: { id: true, userId: true, leadId: true, campaign: true, toEmail: true, openedAt: true },
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
        // Bench promotion first: this member's campaign email reached a lead
        // sitting on their campaign bench and a human READ it. That read is
        // the earn moment — the bench row joins the pipeline as a real,
        // unlocked, CONTACTED lead. The conditional update is the race guard:
        // two opens racing for the same bench row can only claim it once,
        // so a lead can never be promoted twice.
        const bench = await db.clientPoolLead.findFirst({
          where: { userId: log.userId, email: log.toEmail.toLowerCase(), status: 'NEW' },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, company: true, contactName: true, role: true, email: true, phone: true,
            website: true, industry: true, city: true, country: true, why: true, score: true,
          },
        })
        if (bench) {
          const claim = await db.clientPoolLead.updateMany({
            where: { id: bench.id, status: 'NEW' },
            data: { status: 'ADDED', addedAt: new Date() },
          })
          if (claim.count === 1) {
            const project = await resolveProject(log.userId, null)
            const lead = await db.lead.create({
              data: {
                userId: log.userId,
                projectId: project.id,
                company: bench.company,
                contactName: bench.contactName,
                role: bench.role,
                email: bench.email,
                phone: bench.phone,
                website: bench.website,
                industry: bench.industry,
                city: bench.city,
                value: 0,
                notes: `${bench.why ? `${bench.why} ` : ''}${bench.country ? `Country: ${bench.country}. ` : ''}Read the campaign email and moved into the pipeline automatically, read receipt on file.`,
                source: 'TEAM',
                stage: 'CONTACTED',
                unlocked: true,
                score: bench.score,
              },
            })
            await db.clientPoolLead.update({ where: { id: bench.id }, data: { leadId: lead.id } })
          }
        } else {
          // Platform bench: exec-staged blasts (the owner's own treg/OSM/POOL
          // harvest) queue as raw addresses with no leadId on the row, but the
          // address usually sits on the sender's own bench as a Lead row. Same
          // ownership law as the direct branch and the bench promotion: an open
          // only ever moves a row the SENDER owns (userId match), only ever
          // forward (NEW -> CONTACTED), and only on a real read receipt.
          const plat = await db.lead.findFirst({
            where: { userId: log.userId, email: log.toEmail.toLowerCase(), stage: 'NEW' },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })
          if (plat) {
            // The updateMany where-stage guard is the race guard, same as above.
            await db.lead.updateMany({
              where: { id: plat.id, stage: 'NEW' },
              data: { stage: 'CONTACTED' },
            })
          } else {
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
