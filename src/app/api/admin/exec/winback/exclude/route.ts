import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { addWinbackExclusion, removeWinbackExclusion, readWinbackExclusions } from '@/lib/winback'

// One-click removal from the win-back list, exec seat only.
//
// POST   { email }     → that address sits THIS campaign out (restorable).
// DELETE { email }     → restore, the address is quiet-list material again.
// GET                  → the current exclusions.
//
// Deliberately NOT the Suppression list: suppression is the permanent law for
// everything leaving the platform (bounces, complaints, unsubscribes). An
// exclusion is the boss's lighter hand — "not this one, not this round" — and
// it applies only to the win-back campaign until he undoes it.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, excluded: await readWinbackExclusions() })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const email = String(b?.email || '').toLowerCase().trim()
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'That does not read as an email address.' }, { status: 400 })
  }
  await addWinbackExclusion(email)
  return NextResponse.json({ ok: true, excluded: await readWinbackExclusions() })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const email = String(new URL(req.url).searchParams.get('email') || '').toLowerCase().trim()
  if (!email) {
    return NextResponse.json({ error: 'email query parameter is required.' }, { status: 400 })
  }
  await removeWinbackExclusion(email)
  return NextResponse.json({ ok: true, excluded: await readWinbackExclusions() })
}
