import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'
import type { Prisma } from '@prisma/client'

// GET /api/admin/exec/mail — the platform wide sent mail archive, exec only.
// Every row in EmailLog regardless of which member sent it, newest first, with
// the sending member attached. ?q= searches recipient, subject, campaign and
// sender identity (this is the "find the email we sent to beyondself" door),
// ?status= filters the send state, ?limit/?offset page through.

const PAGE = 50

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const status = (url.searchParams.get('status') || '').trim()
  const limit = Math.min(Number(url.searchParams.get('limit')) || PAGE, 200)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  const where: Prisma.EmailLogWhereInput = {}
  if (status && status !== 'ALL') where.status = status
  if (q) {
    // Recipient, subject line, campaign tag, or the member who sent it.
    where.OR = [
      { toEmail: { contains: q, mode: 'insensitive' } },
      { subject: { contains: q, mode: 'insensitive' } },
      { campaign: { contains: q, mode: 'insensitive' } },
      { user: { is: { OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { businessName: { contains: q, mode: 'insensitive' } },
      ] } } },
    ]
  }

  const [rows, total] = await Promise.all([
    db.emailLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit,
      skip: offset,
      include: {
        user: { select: { name: true, businessName: true, email: true } },
        lead: { select: { company: true } },
      },
    }),
    db.emailLog.count({ where }),
  ])

  return NextResponse.json({
    emails: rows.map((r) => ({
      id: r.id,
      toEmail: r.toEmail,
      subject: r.subject,
      body: r.body,
      status: r.status,
      error: r.error,
      provider: r.provider,
      campaign: r.campaign,
      openCount: r.openCount,
      openedAt: r.openedAt,
      sentAt: r.sentAt,
      createdAt: r.createdAt,
      leadCompany: r.lead?.company ?? null,
      sender: r.user ? { name: r.user.name, businessName: r.user.businessName, email: r.user.email } : null,
    })),
    total,
    limit,
    offset,
  })
}
