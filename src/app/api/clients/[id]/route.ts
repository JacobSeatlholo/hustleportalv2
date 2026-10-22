import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'

// PATCH /api/clients/[id], update a client
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await db.client.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  const { name, company, email, phone, notes, monthlyValue, status } = await req.json()
  if (name !== undefined && !String(name).trim()) {
    return NextResponse.json({ error: 'Client name is required.' }, { status: 400 })
  }
  if (status !== undefined && !['ACTIVE', 'CHURNED'].includes(String(status))) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  }
  const client = await db.client.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(company !== undefined ? { company: company ? String(company).trim() : null } : {}),
      ...(email !== undefined ? { email: email ? String(email).trim() : null } : {}),
      ...(phone !== undefined ? { phone: phone ? String(phone).trim() : null } : {}),
      ...(notes !== undefined ? { notes: notes ? String(notes) : null } : {}),
      ...(monthlyValue !== undefined ? { monthlyValue: Number(monthlyValue) || 0 } : {}),
      ...(status !== undefined ? { status: String(status) } : {}),
    },
  })
  return NextResponse.json({ client })
}

// DELETE /api/clients/[id], remove a client
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await db.client.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
  await db.client.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
