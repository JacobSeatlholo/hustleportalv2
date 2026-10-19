import { NextRequest, NextResponse } from 'next/server'
import { isExecUser, requireExec } from '@/lib/admin'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

const CAPS: Record<string, number> = {
  name: 80,
  businessName: 80,
  industry: 60,
  city: 60,
  phone: 30,
}

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
}

/**
 * PATCH /api/admin/exec/client/[id]/profile — set the member identity fields
 * on a member account: name, businessName, industry, city, phone.
 *
 * This is the membership face correction: when a member self registers with
 * loose details (lowercase business name, missing industry) the exec can align
 * the account to the membership record without touching the login. Email,
 * role, account status and credentials are deliberately NOT settable here —
 * email moves live on the invite route, pause lives on the status PATCH, and
 * credentials belong to the member alone.
 *
 * Guard rails: exec gate, exec and admin accounts can never be reprofiled,
 * every field trimmed and length capped, empty optional fields clear the
 * value. Idempotent by nature.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const target = await db.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, businessName: true, industry: true,
      city: true, phone: true, role: true, platformAdmin: true,
    },
  })
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
  if (isExecUser(target)) {
    return NextResponse.json({ error: 'Admin and executive accounts cannot be reprofiled this way.' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const data: Record<string, string | null> = {}
  const changes: { field: string; from: string | null; to: string | null }[] = []

  for (const field of Object.keys(CAPS)) {
    if (!(field in (body || {}))) continue
    const raw = clean(body?.[field])
    if (field === 'name') {
      if (raw.length < 2) {
        return NextResponse.json({ error: 'Name needs at least 2 characters.' }, { status: 400 })
      }
    }
    const value = field === 'name' ? raw : raw === '' ? null : raw.slice(0, CAPS[field])
    const current = (target as unknown as Record<string, string | null>)[field] ?? null
    if (value !== current) {
      data[field] = value
      changes.push({ field, from: current, to: value })
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, changed: 0, message: 'Profile already matches — nothing to change.' })
  }

  const updated = await db.user.update({
    where: { id },
    data,
    select: { id: true, name: true, businessName: true, industry: true, city: true, phone: true },
  })

  return NextResponse.json({
    ok: true,
    changed: changes.length,
    changes,
    client: updated,
    message: `Identity updated: ${changes.map((c) => c.field).join(', ')}.`,
  })
}
