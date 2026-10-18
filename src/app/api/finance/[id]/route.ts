import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/finance/[id] — the owner may relabel an entry (category, description).
// Money never changes by accident: type, amount and occurredAt are immutable here.
export async function PATCH(req: NextRequest, ctx: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const entry = await db.financeEntry.findUnique({ where: { id } })
  if (!entry || entry.userId !== userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: { category?: string | null; description?: string } = {}
  if ('category' in body) data.category = body.category ? String(body.category).trim() || null : null
  if ('description' in body) {
    const d = String(body.description || '').trim()
    if (!d) return NextResponse.json({ error: 'Description cannot be empty.' }, { status: 400 })
    data.description = d
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const updated = await db.financeEntry.update({ where: { id }, data })
  return NextResponse.json({ entry: updated })
}
