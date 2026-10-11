import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { getOrCreateDefaultProject } from '@/lib/workspace'

type Params = { params: Promise<{ id: string }> }

// GET /api/projects/[id] → single workspace with counts
export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const project = await db.project.findFirst({ where: { id, userId } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [leads, clients, finance, appointments, invoices] = await Promise.all([
    db.lead.count({ where: { projectId: id } }),
    db.client.count({ where: { projectId: id } }),
    db.financeEntry.count({ where: { projectId: id } }),
    db.appointment.count({ where: { projectId: id } }),
    db.invoice.count({ where: { projectId: id } }),
  ])
  return NextResponse.json({ project, counts: { leads, clients, finance, appointments, invoices } })
}

// PATCH /api/projects/[id] → update business profile
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await db.project.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  for (const field of [
    'name', 'industry', 'valueProp', 'targetMarket', 'offerings', 'tone',
    'website', 'contactEmail', 'contactPhone', 'salesPitch',
  ]) {
    if (field in body) data[field] = body[field] === '' ? null : body[field]
  }
  if (existing.isDefault && typeof data.name === 'string' && !String(data.name).trim()) {
    delete data.name // default workspace must keep a name
  }
  const project = await db.project.update({ where: { id }, data })
  return NextResponse.json({ project })
}

// DELETE /api/projects/[id] → remove a workspace (its rows fall back to the default)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const project = await db.project.findFirst({ where: { id, userId } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.isDefault) {
    return NextResponse.json({ error: 'The default "My Business" workspace cannot be deleted.' }, { status: 400 })
  }
  const fallback = await getOrCreateDefaultProject(userId)
  await Promise.all([
    db.lead.updateMany({ where: { projectId: id }, data: { projectId: fallback.id } }),
    db.client.updateMany({ where: { projectId: id }, data: { projectId: fallback.id } }),
    db.financeEntry.updateMany({ where: { projectId: id }, data: { projectId: fallback.id } }),
    db.appointment.updateMany({ where: { projectId: id }, data: { projectId: fallback.id } }),
    db.invoice.updateMany({ where: { projectId: id }, data: { projectId: fallback.id } }),
  ])
  await db.project.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
