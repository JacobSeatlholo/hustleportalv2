import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { companyKeyFor, cachePutContact, REVEAL_STATS_KEY } from '@/lib/leadlookup'
import { emailReach } from '@/lib/reach'

export const maxDuration = 60

/**
 * LEAD LOOKUP MEMORY — the exec lens + the backfill pump.
 *
 * GET  /api/admin/exec/lookup-memory
 *   What did the reveal doors actually do per day (REVEAL_STATS, 30-day window)
 *   and how many businesses sit in the shared memory right now.
 *
 * POST /api/admin/exec/lookup-memory
 *   Pre-warm the shared memory from the facts members ALREADY paid to verify:
 *   every unlocked lead with sane, reachable contact details becomes a cache row
 *   (only where the key is still empty — existing verified answers are never
 *   overwritten). The next member revealing the same business reads it at zero
 *   Google quota instead of paying the search again. Cursor-paged and
 *   idempotent: call it repeatedly until nextCursor is null.
 *   NO limits are touched: this REPLACES quota burn, it does not add any.
 */

function saneEmail(v?: string | null): string | undefined {
  const s = (v || '').trim()
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined
  if (/example\.(com|org|net)|your(email)?\.|domain\.com/i.test(s)) return undefined
  return s
}

function sanePhone(v?: string | null): string | undefined {
  const s = (v || '').trim()
  if (!s) return undefined
  if (s.replace(/\D/g, '').length < 9) return undefined
  return s
}

const BATCH = 400

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const [row, cacheRows] = await Promise.all([
    db.platformConfig.findUnique({ where: { key: REVEAL_STATS_KEY } }),
    db.leadLookupCache.count(),
  ])
  let days: Record<string, Record<string, number>> = {}
  if (row?.value) {
    try { days = JSON.parse(row.value) } catch {}
  }
  return NextResponse.json({ ok: true, cacheRows, days })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({}))
  const cursor = typeof body?.cursor === 'string' && body.cursor ? body.cursor : undefined

  const rows = await db.lead.findMany({
    where: { unlocked: true, OR: [{ email: { not: null } }, { phone: { not: null } }] },
    orderBy: { id: 'asc' },
    take: BATCH,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: { id: true, company: true, city: true, website: true, email: true, phone: true, contactName: true },
  })

  let cached = 0
  let alreadyKnown = 0
  let deadStripped = 0
  let unusable = 0

  for (const l of rows) {
    const name = String(l.company || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!name) { unusable++; continue }
    let email = saneEmail(l.email)
    if (email && (await emailReach(email)) === 'dead') {
      email = undefined
      deadStripped++
    }
    const phone = sanePhone(l.phone)
    if (!email && !phone) { unusable++; continue }

    const key = companyKeyFor(l.company, l.city, l.website)
    const existing = await db.leadLookupCache.findUnique({ where: { companyKey: key } })
    if (existing && (existing.email || existing.phone)) { alreadyKnown++; continue }

    await cachePutContact(key, {
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(l.contactName ? { contactName: l.contactName } : {}),
      source: 'verified by a member reveal',
    })
    cached++
  }

  const nextCursor = rows.length === BATCH ? rows[rows.length - 1].id : null
  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    cached,
    alreadyKnown,
    deadStripped,
    unusable,
    nextCursor,
    message: nextCursor
      ? `Backfill batch: ${cached} businesses added to the shared memory, ${alreadyKnown} already known. Continue with the returned cursor.`
      : `Backfill complete: ${cached} businesses added to the shared memory, ${alreadyKnown} already known.`,
  })
}
