import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId, hashPassword, verifyPassword } from '@/lib/auth'

// PATCH /api/profile, update own profile
export async function PATCH(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const data: Record<string, unknown> = {}
  for (const k of ['name', 'businessName', 'industry', 'city', 'phone']) {
    if (k in body) data[k] = body[k] || null
  }
  if ('password' in body && body.password) {
    const me = await db.user.findUnique({ where: { id: userId } })
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!body.currentPassword || !(await verifyPassword(String(body.currentPassword), me.passwordHash))) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 403 })
    }
    if (String(body.password).length < 6) {
      return NextResponse.json({ error: 'New password must be at least 6 characters.' }, { status: 400 })
    }
    data.passwordHash = await hashPassword(String(body.password))
  }
  const user = await db.user.update({ where: { id: userId }, data })
  return NextResponse.json({ ok: true, user: { id: user.id, name: user.name } })
}
