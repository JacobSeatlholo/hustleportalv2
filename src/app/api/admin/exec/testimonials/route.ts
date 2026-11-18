import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'

// ============ EXEC TESTIMONIAL MODERATION (Task 219) ============
// The desk's yes/no over what the world may read. GET lists everything newest
// first (pending flagged); POST approves or deletes by id. Exec only — the
// same requireExec gate as every /api/admin/exec surface.

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const rows = await db.testimonial.findMany({
    orderBy: [{ approved: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true, name: true, business: true, location: true, body: true,
      rating: true, refSlug: true, approved: true, createdAt: true,
      user: { select: { email: true } },
    },
  })
  return NextResponse.json({ testimonials: rows })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const body = (await req.json().catch(() => null)) as { id?: string; action?: string } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!id || !['approve', 'delete'].includes(action)) {
    return NextResponse.json({ error: 'id and action (approve | delete) are required.' }, { status: 400 })
  }
  if (action === 'approve') {
    await db.testimonial.update({ where: { id }, data: { approved: true } })
  } else {
    await db.testimonial.deleteMany({ where: { id } })
  }
  return NextResponse.json({ ok: true })
}
