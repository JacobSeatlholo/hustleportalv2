import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { ensureWallet } from '@/lib/wallet'

export const dynamic = 'force-dynamic'

type ImportRow = {
  name?: string
  businessName?: string
  email?: string
  phone?: string
  industry?: string
  city?: string
}

// POST /api/admin/exec/clients/import — exec only, idempotent bulk client
// import for owner-owned lead sources (e.g. the kloofstreet.online directory).
// Creates a MEMBER account per row (random unguessable password — the member
// chooses their own later; wallet created, NO welcome credit until the member
// actually engages). Rows whose email already exists are returned as "exists"
// with their current account id, so reruns never duplicate anyone.
//
// Emails that are not a real published address (reserved slots on the owner's
// own domain, e.g. arnolds@kloofstreet.online) are accepted as-is: they sit on
// a domain the owner controls, and the roster row carries the phone number for
// WhatsApp-first contact until a personal email is collected.
export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({}))
  const rows: ImportRow[] = Array.isArray(body.clients) ? body.clients : []
  if (!rows.length) {
    return NextResponse.json({ error: 'clients[] is required.' }, { status: 400 })
  }
  if (rows.length > 200) {
    return NextResponse.json({ error: 'Import at most 200 clients per call.' }, { status: 400 })
  }

  const results: Array<Record<string, unknown>> = []
  let created = 0
  let exists = 0
  let invalid = 0

  for (const row of rows) {
    const email = normalizeEmail(row.email)
    const name = String(row.name || '').trim()
    const businessName = String(row.businessName || '').trim() || null
    if (!email.includes('@') || email.length < 6 || (!name && !businessName)) {
      invalid += 1
      results.push({ email, ok: false, reason: 'invalid row' })
      continue
    }

    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true, name: true, businessName: true },
    })
    if (existing) {
      exists += 1
      results.push({ email, ok: true, reason: 'exists', userId: existing.id, name: existing.name, businessName: existing.businessName })
      continue
    }

    const tempPassword = crypto.randomBytes(24).toString('base64url')
    const user = await db.user.create({
      data: {
        email,
        passwordHash: await hashPassword(tempPassword),
        name: name || businessName || email.split('@')[0],
        businessName,
        industry: String(row.industry || '').trim() || null,
        city: String(row.city || '').trim() || null,
        phone: String(row.phone || '').trim() || null,
        role: 'MEMBER',
      },
      select: { id: true, email: true, name: true, businessName: true },
    })
    await ensureWallet(user.id)
    created += 1
    results.push({ email, ok: true, reason: 'created', userId: user.id, name: user.name, businessName: user.businessName })
  }

  return NextResponse.json({ ok: true, created, exists, invalid, results }, { status: 200 })
}

function normalizeEmail(v: unknown): string {
  return String(v || '').toLowerCase().trim()
}
