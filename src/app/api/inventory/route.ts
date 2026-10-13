import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'
import { planState, FREE_LIMITS, upgradeJson } from '@/lib/limits'

/**
 * Inventory — dead-simple stock management.
 * GET    /api/inventory          → { items, totals }
 * POST   /api/inventory          → create { name, sku?, quantity?, unit?, costPrice?, sellPrice?, lowStockAt?, notes? }
 * PATCH  /api/inventory          → update { id, ...fields } (quantity is the NEW value; use `adjust` for ±delta)
 * DELETE /api/inventory?id=      → remove
 */
function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const items = await db.inventoryItem.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }],
    take: 500,
  })
  const stockValue = items.reduce((a, i) => a + i.quantity * i.costPrice, 0)
  const retailValue = items.reduce((a, i) => a + i.quantity * i.sellPrice, 0)
  const lowCount = items.filter((i) => i.lowStockAt > 0 && i.quantity <= i.lowStockAt).length
  return NextResponse.json({
    items,
    totals: { count: items.length, stockValue, retailValue, lowCount },
  })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const name = String(b.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Item name is required.' }, { status: 400 })
  // Free plan ceiling: 3 stock items. The meter in the UI reads the same number.
  const { paid } = await planState(userId)
  if (!paid) {
    const count = await db.inventoryItem.count({ where: { userId } })
    if (count >= FREE_LIMITS.inventoryItems) {
      return upgradeJson('inventory', FREE_LIMITS.inventoryItems)
    }
  }
  const item = await db.inventoryItem.create({
    data: {
      userId,
      name,
      sku: String(b.sku || '').trim() || null,
      quantity: num(b.quantity) ?? 0,
      unit: String(b.unit || '').trim() || null,
      costPrice: num(b.costPrice) ?? 0,
      sellPrice: num(b.sellPrice) ?? 0,
      lowStockAt: num(b.lowStockAt) ?? 0,
      notes: String(b.notes || '').trim() || null,
    },
  })
  await bumpChallenge(userId, 'add_task') // stock work counts as business housekeeping XP
  return NextResponse.json({ item })
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const id = String(b.id || '')
  const existing = await db.inventoryItem.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Item not found.' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (b.name !== undefined) data.name = String(b.name).trim() || existing.name
  if (b.sku !== undefined) data.sku = String(b.sku).trim() || null
  if (b.unit !== undefined) data.unit = String(b.unit).trim() || null
  if (b.notes !== undefined) data.notes = String(b.notes).trim() || null
  if (b.costPrice !== undefined) data.costPrice = num(b.costPrice) ?? existing.costPrice
  if (b.sellPrice !== undefined) data.sellPrice = num(b.sellPrice) ?? existing.sellPrice
  if (b.lowStockAt !== undefined) data.lowStockAt = num(b.lowStockAt) ?? existing.lowStockAt
  if (b.adjust !== undefined) data.quantity = Math.max(0, existing.quantity + (num(b.adjust) ?? 0))
  else if (b.quantity !== undefined) data.quantity = Math.max(0, num(b.quantity) ?? existing.quantity)

  const item = await db.inventoryItem.update({ where: { id: existing.id }, data })
  return NextResponse.json({ item })
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id') || ''
  const existing = await db.inventoryItem.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Item not found.' }, { status: 404 })
  await db.inventoryItem.delete({ where: { id: existing.id } })
  return NextResponse.json({ ok: true })
}
