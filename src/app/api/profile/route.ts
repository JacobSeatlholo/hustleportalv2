import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId, hashPassword, verifyPassword, bumpSessionEpoch } from '@/lib/auth'

// PATCH /api/profile, update own profile
export async function PATCH(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const data: Record<string, unknown> = {}
  for (const k of ['name', 'businessName', 'industry', 'city', 'phone']) {
    if (k in body) data[k] = body[k] || null
  }
  // Default pitch video theme for the Video Studio. Strict whitelist, only
  // machine or clean ever lands in the column; an empty value clears it back
  // to not set and anything unexpected leaves the saved choice untouched.
  if ('videoTheme' in body) {
    const v = String(body.videoTheme || '')
    if (v === 'machine' || v === 'clean') data.videoTheme = v
    else if (v === '') data.videoTheme = null
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
    // Same law as the reset flow: a password change kills every session
    // issued before it, so a stolen cookie cannot outlive the new password.
    data.sessionEpoch = { increment: 1 }
  }
  const user = await db.user.update({ where: { id: userId }, data })
  return NextResponse.json({ ok: true, user: { id: user.id, name: user.name } })
}
