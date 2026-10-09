import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

// GET/POST clients
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clients = await db.client.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ clients })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, company, email, phone, notes, monthlyValue } = await req.json()
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Client name is required.' }, { status: 400 })
  }
  const client = await db.client.create({
    data: {
      userId,
      name: String(name).trim(),
      company: company || null,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
      monthlyValue: Number(monthlyValue) || 0,
    },
  })
  return NextResponse.json({ client })
}
