import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SENT'],
  SENT: ['PAID', 'OVERDUE'],
  OVERDUE: ['PAID', 'SENT'],
  PAID: [],
}

// GET /api/invoices/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const invoice = await db.invoice.findFirst({ where: { id, userId } })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ invoice: { ...invoice, items: JSON.parse(invoice.items || '[]') } })
}

// PATCH /api/invoices/[id] → status transitions / edits / logo
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await db.invoice.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (typeof body.status === 'string') {
    const allowed = TRANSITIONS[existing.status] || []
    if (!allowed.includes(body.status)) {
      return NextResponse.json({ error: `Can't move a ${existing.status} invoice to ${body.status}.` }, { status: 400 })
    }
    data.status = body.status
    if (body.status === 'PAID') data.paidAt = new Date()
    if (body.status === 'SENT') data.issuedAt = existing.issuedAt
  }
  if ('clientName' in body && String(body.clientName).trim()) data.clientName = String(body.clientName).trim()
  if ('clientEmail' in body) data.clientEmail = body.clientEmail || null
  if ('notes' in body) data.notes = body.notes || null
  if ('logoUrl' in body) {
    data.logoUrl = typeof body.logoUrl === 'string' && body.logoUrl.startsWith('data:image/') ? body.logoUrl : null
  }
  const invoice = await db.invoice.update({ where: { id }, data })
  return NextResponse.json({ invoice: { ...invoice, items: JSON.parse(invoice.items || '[]') } })
}

// DELETE /api/invoices/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await db.invoice.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.invoice.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
