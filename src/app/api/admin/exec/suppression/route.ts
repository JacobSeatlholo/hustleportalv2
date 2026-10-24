import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'

// Exec suppression import: the legal ledger the campaign queue already obeys.
// Addresses that refused marketing in any of the boss's earlier books land
// here as MANUAL, and the queue's per send check (campaignqueue.ts) makes
// them untouchable by every future campaign, on any lane, forever. This is
// POPIA section 69 made structural: a refusal recorded once can never be
// accidentally ignored later.
//
// POST { rows: [{ email, reason?, note? }] }   upsert, max 500 per call
// GET                                          audit read back
//
// Reason law: BOUNCE | COMPLAINT | UNSUB | MANUAL, default MANUAL.
// Existing rows are never weakened: a BOUNCE or COMPLAINT stays what it is,
// an import only ever appends provenance to the note.

const REASONS = new Set(['BOUNCE', 'COMPLAINT', 'UNSUB', 'MANUAL'])
const MAX_ROWS = 500
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const [total, byReason, recent] = await Promise.all([
    db.suppression.count(),
    db.suppression.groupBy({ by: ['reason'], _count: { _all: true } }),
    db.suppression.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { email: true, reason: true, note: true, createdAt: true },
    }),
  ])
  return NextResponse.json({
    ok: true,
    total,
    byReason: byReason.map((r) => ({ reason: r.reason, count: r._count._all })),
    recent,
  })
}

export async function POST(req: Request) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let payload: { rows?: { email?: string; reason?: string; note?: string }[] }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rows = (payload.rows || []).slice(0, MAX_ROWS)
  if (rows.length === 0) {
    return NextResponse.json({ error: 'rows is required, for example [{ email, note }].' }, { status: 400 })
  }

  let added = 0
  let updated = 0
  let invalid = 0
  for (const r of rows) {
    const email = String(r.email || '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      invalid++
      continue
    }
    const reasonRaw = String(r.reason || '').toUpperCase()
    const reason = REASONS.has(reasonRaw) ? reasonRaw : 'MANUAL'
    const note = String(r.note || '').trim().slice(0, 160) || null
    try {
      const existing = await db.suppression.findUnique({ where: { email } })
      if (existing) {
        const merged = note && !(existing.note || '').includes(note)
          ? `${existing.note || ''}${existing.note ? ' | ' : ''}${note}`.slice(0, 160)
          : existing.note
        await db.suppression.update({ where: { email }, data: { note: merged } })
        updated++
      } else {
        await db.suppression.create({ data: { email, reason, note } })
        added++
      }
    } catch {
      invalid++
    }
  }
  return NextResponse.json({ ok: true, received: rows.length, added, updated, invalid })
}
