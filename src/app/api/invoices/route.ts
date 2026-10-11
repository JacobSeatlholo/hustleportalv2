import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { resolveProject } from '@/lib/workspace'

type Item = { description: string; quantity: number; unitPrice: number }

function parseItems(raw: unknown): Item[] {
  let items: unknown = raw
  if (typeof raw === 'string') {
    try { items = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(items)) return []
  return items
    .map((i) => {
      const it = i as Partial<Item>
      return {
        description: String(it.description || '').slice(0, 300),
        quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
        unitPrice: Number(it.unitPrice) >= 0 ? Number(it.unitPrice) : 0,
      }
    })
    .filter((i) => i.description.trim().length > 0)
}

function money(n: number) {
  return Math.round(n * 100) / 100
}

// GET /api/invoices?status=
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const status = new URL(req.url).searchParams.get('status')
  const invoices = await db.invoice.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ invoices })
}

// POST /api/invoices → create with auto number + ZAR totals (15% VAT default)
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const clientName = String(body.clientName || '').trim()
  if (!clientName) return NextResponse.json({ error: 'Who is this invoice for? Add a client name.' }, { status: 400 })
  const items = parseItems(body.items)
  if (items.length === 0) {
    return NextResponse.json({ error: 'Add at least one line item with a description.' }, { status: 400 })
  }
  const project = await resolveProject(userId, body.projectId)

  const subtotal = money(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0))
  const taxRate = Number(body.taxRate) >= 0 ? Number(body.taxRate) : 15
  const total = money(subtotal * (1 + taxRate / 100))

  // Auto number: INV-0001 style, per user, retry on collision
  let number = ''
  for (let i = 0; i < 5; i++) {
    const count = await db.invoice.count({ where: { userId } })
    const candidate = `INV-${String(count + 1 + i).padStart(4, '0')}`
    const clash = await db.invoice.findUnique({ where: { number: candidate } })
    if (!clash) { number = candidate; break }
  }
  if (!number) number = `INV-${Date.now().toString().slice(-6)}`

  const dueAt = body.dueAt ? new Date(body.dueAt) : new Date(Date.now() + 14 * 86400000)
  const invoice = await db.invoice.create({
    data: {
      userId,
      projectId: project.id,
      number,
      clientName,
      clientEmail: body.clientEmail || null,
      items: JSON.stringify(items),
      subtotal,
      taxRate,
      total,
      notes: body.notes || null,
      logoUrl: typeof body.logoUrl === 'string' && body.logoUrl.startsWith('data:image/') ? body.logoUrl : null,
      // Bank details snapshot: printed on this invoice forever, even if settings change later.
      bankDetails: typeof body.bankDetails === 'string' && body.bankDetails.trim() ? body.bankDetails.slice(0, 600) : null,
      status: body.status === 'SENT' ? 'SENT' : 'DRAFT',
      dueAt,
    },
  })
  return NextResponse.json({ invoice }, { status: 201 })
}
