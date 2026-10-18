import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'
import { planState, FREE_LIMITS, upgradeJson } from '@/lib/limits'
import { cleanNumber, normSku } from '@/lib/quality'

/**
 * POST /api/inventory/import — bring an existing stock list in without retyping it.
 * Body: { csv: string } — pasted or uploaded CSV text.
 *
 * Recognised columns (aliases included): name/item/product, sku/code/barcode,
 * quantity/qty/stock, unit, cost/buy price, sell/price/retail, low stock/reorder, notes.
 *
 * Quality law: name required per row, numbers cleaned ("R 1 250,00" parses),
 * duplicates (same SKU or same item name) are skipped and reported — never
 * double-counted stock. Free plan imports up to its item ceiling and says so.
 */

interface CsvRow {
  [key: string]: string
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      cur.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      cur.push(field)
      field = ''
      if (cur.some((c) => c.trim() !== '')) rows.push(cur)
      cur = []
    } else field += ch
  }
  cur.push(field)
  if (cur.some((c) => c.trim() !== '')) rows.push(cur)
  if (!rows.length) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => {
    const obj: CsvRow = {}
    headers.forEach((h, i) => (obj[h] = (r[i] || '').trim()))
    return obj
  })
}

const FIELD_ALIASES: Record<string, string[]> = {
  name: ['name', 'item', 'item name', 'product', 'product name', 'stock item', 'description', 'title'],
  sku: ['sku', 'code', 'item code', 'stock code', 'barcode', 'product code', 'upc'],
  quantity: ['quantity', 'qty', 'stock', 'on hand', 'in stock', 'count', 'stock on hand', 'available'],
  unit: ['unit', 'units', 'uom', 'measure'],
  costPrice: ['cost', 'cost price', 'buy price', 'buy', 'purchase price', 'unit cost', 'wholesale', 'cost per unit'],
  sellPrice: ['sell', 'sell price', 'selling price', 'price', 'retail', 'retail price', 'unit price', 'sale price', 'selling'],
  lowStockAt: ['low stock', 'low stock at', 'reorder at', 'reorder level', 'reorder point', 'minimum', 'min stock', 'alert at'],
  notes: ['notes', 'note', 'comments', 'comment'],
}

function pick(row: CsvRow, field: string): string | undefined {
  const aliases = FIELD_ALIASES[field] || [field]
  for (const a of aliases) {
    const v = row[a]
    if (v && v.trim() !== '') return v.trim()
  }
  return undefined
}

const MAX_IMPORT_ROWS = 500
const itemKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80)

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const csv = body.csv
  if (!csv || typeof csv !== 'string' || csv.trim().length === 0) {
    return NextResponse.json({ error: 'Paste CSV content or upload a file.' }, { status: 400 })
  }
  const rows = parseCsv(csv)
  if (!rows.length) return NextResponse.json({ error: 'No data rows found in CSV.' }, { status: 400 })
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `That file carries ${rows.length} rows. The import takes up to ${MAX_IMPORT_ROWS} at a time — split it and go again.` }, { status: 400 })
  }

  const { paid } = await planState(userId)
  const currentCount = await db.inventoryItem.count({ where: { userId } })
  const freeCeiling = paid ? Infinity : FREE_LIMITS.inventoryItems
  if (!paid && currentCount >= FREE_LIMITS.inventoryItems) {
    return upgradeJson('inventory', FREE_LIMITS.inventoryItems)
  }

  const existing = await db.inventoryItem.findMany({
    where: { userId },
    select: { name: true, sku: true },
  })
  const seenSkus = new Set<string>()
  const seenNames = new Set<string>()
  for (const it of existing) {
    if (it.sku) seenSkus.add(normSku(it.sku))
    seenNames.add(itemKey(it.name))
  }

  let imported = 0
  let duplicates = 0
  let invalid = 0
  let limitHeld = 0
  const duplicateSamples: string[] = []
  const invalidSamples: string[] = []

  for (const row of rows) {
    const name = pick(row, 'name')
    if (!name) {
      invalid++
      if (invalidSamples.length < 5) invalidSamples.push('(no item name)')
      continue
    }
    const skuRaw = pick(row, 'sku')
    const skuKey = skuRaw ? normSku(skuRaw) : ''
    const nameKey = itemKey(name)
    if ((skuKey && seenSkus.has(skuKey)) || seenNames.has(nameKey)) {
      duplicates++
      if (duplicateSamples.length < 5) duplicateSamples.push(name.slice(0, 40))
      continue
    }
    if (imported + currentCount >= freeCeiling) {
      limitHeld++
      continue
    }
    if (skuKey) seenSkus.add(skuKey)
    seenNames.add(nameKey)

    await db.inventoryItem.create({
      data: {
        userId,
        name: name.slice(0, 120),
        sku: skuRaw || null,
        quantity: Math.max(0, cleanNumber(pick(row, 'quantity'))),
        unit: pick(row, 'unit') || null,
        costPrice: Math.max(0, cleanNumber(pick(row, 'costPrice'))),
        sellPrice: Math.max(0, cleanNumber(pick(row, 'sellPrice'))),
        lowStockAt: Math.max(0, cleanNumber(pick(row, 'lowStockAt'))),
        notes: pick(row, 'notes') || null,
      },
    })
    imported++
  }
  if (imported > 0) await bumpChallenge(userId, 'add_task')
  return NextResponse.json({ imported, duplicates, invalid, limitHeld, total: rows.length, duplicateSamples, invalidSamples })
}
