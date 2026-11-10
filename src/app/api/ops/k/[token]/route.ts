import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

// One-shot read door (Task 146 precedent; fourth lawful run — Task 181, Task 181
// restore, and this). Exists ONLY to re-read the kloofstreet-2026-11 campaign's
// send/open rows and their linked leads so the boss's openers follow-up pack can
// be rebuilt after a second sandbox recycle wiped download/. Read-only: sends
// nothing, edits nothing, moves no stage. Deleted in the same task once the read
// lands; the token lives only in the path.

type Ctx = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params
  if (token !== '6747e54eaa494c56990371ad1b55fa002df41943cc8f991e') {
    return new Response('not found', { status: 404 })
  }
  const logs = await db.emailLog.findMany({
    where: { campaign: 'kloofstreet-2026-11' },
    select: {
      id: true, toEmail: true, status: true, error: true, sentAt: true,
      openedAt: true, openCount: true, leadId: true, subject: true, createdAt: true,
    },
    orderBy: { sentAt: 'asc' },
  })
  const leadIds = logs.map((l) => l.leadId).filter((x): x is string => !!x)
  const emails = Array.from(new Set(logs.map((l) => l.toEmail.toLowerCase())))
  const [leads, leadsByEmail] = await Promise.all([
    db.lead.findMany({
      where: { id: { in: leadIds } },
      select: {
        id: true, company: true, contactName: true, role: true, phone: true, email: true,
        website: true, address: true, city: true, industry: true, stage: true,
        notes: true, score: true, emailBouncedAt: true,
      },
    }),
    db.lead.findMany({
      where: { email: { in: emails } },
      select: {
        id: true, company: true, contactName: true, role: true, phone: true, email: true,
        website: true, address: true, city: true, industry: true, stage: true,
        notes: true, score: true, emailBouncedAt: true,
      },
    }),
  ])
  return Response.json({ logs, leads, leadsByEmail })
}
