import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'

// GET/POST finance entries
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const entries = await db.financeEntry.findMany({
    where: { userId },
    orderBy: { occurredAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { type, description, amount, category, occurredAt } = await req.json()
  if (!type || !['INCOME', 'EXPENSE'].includes(type)) {
    return NextResponse.json({ error: 'Type must be INCOME or EXPENSE.' }, { status: 400 })
  }
  if (!description || !amount || Number(amount) <= 0) {
    return NextResponse.json({ error: 'Description and a positive amount are required.' }, { status: 400 })
  }
  const entry = await db.financeEntry.create({
    data: {
      userId,
      type,
      description: String(description),
      category: category || null,
      amount: Number(amount),
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    },
  })
  await bumpChallenge(userId, 'log_expense')
  return NextResponse.json({ entry })
}
