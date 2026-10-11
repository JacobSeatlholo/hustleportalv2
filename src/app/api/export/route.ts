import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { toCSV, csvFilename } from '@/lib/csv'

// GET /api/export?type=leads|clients|finance|invoices|appointments → CSV download
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const type = new URL(req.url).searchParams.get('type') || 'leads'

  let rows: Record<string, unknown>[] = []
  if (type === 'leads') {
    const data = await db.lead.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
    rows = data.map((l) => ({
      company: l.company, contact: l.contactName, email: l.email, phone: l.phone,
      industry: l.industry, city: l.city, source: l.source, stage: l.stage,
      value_rand: l.value, unlocked: l.unlocked, created: l.createdAt.toISOString().slice(0, 10),
    }))
  } else if (type === 'clients') {
    const data = await db.client.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
    rows = data.map((c) => ({
      name: c.name, company: c.company, email: c.email, phone: c.phone,
      monthly_value_rand: c.monthlyValue, status: c.status, created: c.createdAt.toISOString().slice(0, 10),
    }))
  } else if (type === 'finance') {
    const data = await db.financeEntry.findMany({ where: { userId }, orderBy: { occurredAt: 'desc' } })
    rows = data.map((f) => ({
      type: f.type, description: f.description, category: f.category,
      amount_rand: f.amount, date: f.occurredAt.toISOString().slice(0, 10),
    }))
  } else if (type === 'invoices') {
    const data = await db.invoice.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
    rows = data.map((i) => ({
      number: i.number, client: i.clientName, status: i.status,
      subtotal_rand: i.subtotal, tax_rate: i.taxRate, total_rand: i.total,
      issued: i.issuedAt.toISOString().slice(0, 10), due: i.dueAt?.toISOString().slice(0, 10) || '',
    }))
  } else if (type === 'appointments') {
    const data = await db.appointment.findMany({ where: { userId }, orderBy: { startsAt: 'desc' } })
    rows = data.map((a) => ({
      title: a.title, client: a.clientName, starts_at: a.startsAt.toISOString(),
      meet_link: a.meetLink, source: a.source, gcal: a.gcalEventId ? 'synced' : '',
    }))
  } else {
    return NextResponse.json({ error: 'Unknown export type. Use leads|clients|finance|invoices|appointments.' }, { status: 400 })
  }

  return new NextResponse(toCSV(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(type)}"`,
    },
  })
}
