import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * The CRM timeline, the first real CRM feature: one client, every touch on
 * one dated feed. What joins the feed:
 *   notes    relationship notes the owner writes (POST here to add one)
 *   tasks    work linked to this client on the Tasks board
 *   invoices invoices issued to this client's email address
 *   emails   every platform sent email to this client's address, with opens
 *   meetings facilitated meetings where the client sits on either side
 *   client   the day the relationship started
 *
 * Matching is by the client's email address, scoped to the owner. A client
 * with no email simply sees notes, tasks and the day they were added, the
 * feed is honest about what it can and cannot see.
 */

type TimelineItem = {
  type: 'note' | 'task' | 'invoice' | 'email' | 'meeting' | 'client'
  at: string
  title: string
  detail?: string
  status?: string
  ref?: { kind: string; id: string }
}

function normEmail(s: string | null | undefined): string {
  return String(s || '').toLowerCase().trim()
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const client = await db.client.findFirst({ where: { id, userId } })
  if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const email = normEmail(client.email)
  const items: TimelineItem[] = [
    {
      type: 'client',
      at: client.createdAt.toISOString(),
      title: `${client.name} added to your CRM`,
      detail: client.source && client.source !== 'MANUAL' ? `Source: ${client.source}` : undefined,
    },
  ]

  const [notes, tasks, invoices, emails, meetings] = await Promise.all([
    db.clientNote.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' }, take: 60 }),
    db.task.findMany({ where: { clientId: client.id, isPrivate: false }, orderBy: { createdAt: 'desc' }, take: 40, select: { id: true, title: true, status: true, dueDate: true, createdAt: true } }),
    email
      ? db.invoice.findMany({ where: { userId, clientEmail: { equals: email, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, take: 40, select: { id: true, number: true, clientName: true, status: true, total: true, issuedAt: true, createdAt: true } })
      : Promise.resolve([] as Array<{ id: string; number: string; clientName: string; status: string; total: number; issuedAt: Date | null; createdAt: Date }>),
    email
      ? db.emailLog.findMany({ where: { userId, toEmail: email, status: { in: ['SENT', 'FAILED', 'QUEUED'] } }, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, subject: true, status: true, campaign: true, openedAt: true, openCount: true, sentAt: true, createdAt: true } })
      : Promise.resolve([] as Array<{ id: string; subject: string; status: string; campaign: string | null; openedAt: Date | null; openCount: number; sentAt: Date | null; createdAt: Date }>),
    email
      ? db.meeting.findMany({ where: { OR: [{ memberEmail: { equals: email, mode: 'insensitive' } }, { guestEmail: { equals: email, mode: 'insensitive' } }] }, orderBy: { startsAt: 'desc' }, take: 20, select: { id: true, title: true, status: true, startsAt: true, location: true } })
      : Promise.resolve([] as Array<{ id: string; title: string; status: string; startsAt: Date; location: string | null }>),
  ])

  for (const n of notes) {
    items.push({
      type: 'note',
      at: n.createdAt.toISOString(),
      title: n.body,
      ref: { kind: 'note', id: n.id },
    })
  }
  for (const t of tasks) {
    items.push({
      type: 'task',
      at: t.createdAt.toISOString(),
      title: t.title,
      status: t.status,
      detail: t.dueDate ? `Due ${t.dueDate.toISOString().slice(0, 10)}` : undefined,
      ref: { kind: 'task', id: t.id },
    })
  }
  for (const inv of invoices) {
    items.push({
      type: 'invoice',
      at: (inv.issuedAt || inv.createdAt).toISOString(),
      title: `Invoice ${inv.number} to ${inv.clientName}`,
      status: inv.status,
      detail: `R${inv.total.toFixed(2)}`,
      ref: { kind: 'invoice', id: inv.id },
    })
  }
  for (const m of emails) {
    items.push({
      type: 'email',
      at: (m.sentAt || m.createdAt).toISOString(),
      title: m.subject || 'An email without a subject',
      status: m.status,
      detail: m.openedAt ? `Opened ${m.openCount} time${m.openCount === 1 ? '' : 's'}` : undefined,
      ref: { kind: 'email', id: m.id },
    })
  }
  for (const m of meetings) {
    items.push({
      type: 'meeting',
      at: m.startsAt.toISOString(),
      title: m.title,
      status: m.status,
      detail: m.location || undefined,
      ref: { kind: 'meeting', id: m.id },
    })
  }

  items.sort((a, b) => (a.at < b.at ? 1 : -1))
  return NextResponse.json({
    client: { id: client.id, name: client.name, email: client.email, phone: client.phone, company: client.company },
    items: items.slice(0, 150),
    counts: {
      notes: notes.length,
      tasks: tasks.length,
      invoices: invoices.length,
      emails: emails.length,
      meetings: meetings.length,
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const client = await db.client.findFirst({ where: { id, userId } })
  if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const text = String((body as { body?: unknown }).body || '').trim().slice(0, 2000)
  if (!text) return NextResponse.json({ error: 'Write the note first.' }, { status: 400 })

  const note = await db.clientNote.create({ data: { clientId: client.id, userId, body: text } })
  return NextResponse.json({ note }, { status: 201 })
}
