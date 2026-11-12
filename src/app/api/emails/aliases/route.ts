import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

// ============ CONNECTED SENDING ADDRESSES (EmailAlias) ============
//
// The addresses an account sends from outside the portal — the legacy ceo@
// box, an info@ team box — attached here so the CC/BCC capture resolves the
// From line to this account, and the manual log can honestly wear them.
// An address belongs to exactly ONE account platform-wide: whoever owns the
// address owns that mail. (First verified sign-in mail rules stay with the
// login email; aliases are additions, never replacements.)

function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim())
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const aliases = await db.emailAlias.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, address: true, label: true, createdAt: true },
  })
  return NextResponse.json({ aliases })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const address = String(body.address || '').trim().toLowerCase()
  const label = String(body.label || '').trim() || null
  if (!validEmail(address)) {
    return NextResponse.json({ error: 'That does not look like an email address.' }, { status: 400 })
  }

  const me = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (address === me.email.toLowerCase()) {
    return NextResponse.json({ error: 'That is already your login email — CC capture from it works without an alias.' }, { status: 400 })
  }

  // Ten connected mailboxes is a company, not a person — that is the ceiling
  // and it keeps the From-line identity space tidy.
  const count = await db.emailAlias.count({ where: { userId } })
  if (count >= 10) {
    return NextResponse.json({ error: 'Ten connected addresses is the ceiling. Remove one first.' }, { status: 400 })
  }

  const existing = await db.emailAlias.findUnique({ where: { address }, select: { userId: true } })
  if (existing) {
    if (existing.userId === userId) {
      return NextResponse.json({ ok: true, alias: { address }, already: true })
    }
    return NextResponse.json({ error: 'That address is already connected to another account. An address can belong to exactly one account.' }, { status: 409 })
  }

  const alias = await db.emailAlias.create({ data: { address, userId, label }, select: { id: true, address: true, label: true } })
  return NextResponse.json({ ok: true, alias })
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const address = new URL(req.url).searchParams.get('address')
  if (!address) return NextResponse.json({ error: 'Missing address.' }, { status: 400 })
  const deleted = await db.emailAlias.deleteMany({ where: { address: address.toLowerCase(), userId } })
  if (!deleted.count) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
