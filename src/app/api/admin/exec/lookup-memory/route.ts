import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { companyKeyFor, cacheGetContact, cachePutContact, REVEAL_STATS_KEY } from '@/lib/leadlookup'
import { emailReach } from '@/lib/reach'
import { isSuppressed } from '@/lib/suppression'
import { aiDay } from '@/lib/aiusage'

export const maxDuration = 60

/**
 * LEAD LOOKUP MEMORY — the exec lens + the backfill pumps.
 *
 * GET  /api/admin/exec/lookup-memory
 *   What did the reveal doors actually do per day (REVEAL_STATS, 30-day window),
 *   how many businesses sit in the shared memory right now, and the platform's
 *   total AI actions today (the pressure on the shared search pool the doors
 *   live under). ?probe=Company|City reads the memory for one business through
 *   the exact gates a reveal uses — the QA handle for "will this one open".
 *
 * POST /api/admin/exec/lookup-memory  { cursor? }
 *   Pre-warm the shared memory from the facts members ALREADY paid to verify:
 *   every unlocked lead with sane, reachable contact details becomes a cache row
 *   (only where the key is still empty — existing verified answers are never
 *   overwritten). The next member revealing the same business reads it at zero
 *   Google quota instead of paying the search again. Cursor-paged and
 *   idempotent: call it repeatedly until nextCursor is null.
 *   NO limits are touched: this REPLACES quota burn, it does not add any.
 *
 * POST { source: 'pool', cursor? }
 *   The same pre-warm from the VERIFIED LEAD POOL: every active pool row that
 *   carries a phone or a live email (scan-verified, outreach-confirmed public
 *   facts) becomes a memory row. This is the zero-quota lever: the pool is the
 *   same inventory every member's leads come from, so most reveals open on
 *   Door 1 (memory) before any engine is touched. Suppressed businesses are
 *   skipped: an opt-out never becomes a purchasable contact.
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
const POOL_BATCH = 250

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  // QA handle: read the memory for one business through the reveal's exact
  // gates (stem match included, sane shapes, mail reach). Read only, $0.
  const probeRaw = req.nextUrl.searchParams.get('probe')
  if (probeRaw) {
    const [company, city] = probeRaw.split('|')
    const hit = company ? await cacheGetContact(companyKeyFor(company, city || '', null)) : null
    if (!hit) return NextResponse.json({ ok: true, probe: probeRaw, hit: null })
    const email = hit.email ? await emailReach(hit.email) : null
    return NextResponse.json({
      ok: true,
      probe: probeRaw,
      hit: { email: hit.email || null, phone: hit.phone || null, contactName: hit.contactName || null, source: hit.source, cacheKey: hit.cacheKey },
      gates: { emailReach: email, phoneSane: hit.phone ? hit.phone.replace(/\D/g, '').length >= 9 : null },
    })
  }

  const day = aiDay()
  const sastStart = new Date(`${day}T00:00:00+02:00`)
  const [row, cacheRows, aiSum, aiUsers, scansToday] = await Promise.all([
    db.platformConfig.findUnique({ where: { key: REVEAL_STATS_KEY } }),
    db.leadLookupCache.count(),
    db.aiUsage.aggregate({ where: { day }, _sum: { count: true } }),
    db.aiUsage.count({ where: { day } }),
    db.scanRun.count({ where: { createdAt: { gte: sastStart } } }),
  ])
  let days: Record<string, Record<string, number>> = {}
  if (row?.value) {
    try { days = JSON.parse(row.value) } catch {}
  }
  return NextResponse.json({
    ok: true,
    cacheRows,
    days,
    aiToday: { total: aiSum._sum.count || 0, users: aiUsers, scans: scansToday, day },
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({}))
  const cursor = typeof body?.cursor === 'string' && body.cursor ? body.cursor : undefined

  // THE POOL PUMP: the verified lead pool is the same inventory every member's
  // leads come from. Pre-warming the memory from it means most reveals open on
  // Door 1 at zero quota — the structural answer to the drained-day reveal.
  if (body?.source === 'pool') {
    const rows = await db.leadPool.findMany({
      where: { active: true, emailDeadAt: null, OR: [{ phone: { not: null } }, { email: { not: null } }] },
      orderBy: { id: 'asc' },
      take: POOL_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, company: true, city: true, website: true, email: true, phone: true, contactName: true, source: true, poolTag: true },
    })

    let cached = 0
    let alreadyKnown = 0
    let deadStripped = 0
    let unusable = 0
    let optedOut = 0

    for (const p of rows) {
      const name = String(p.company || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      if (!name) { unusable++; continue }
      // An opt-out must never become a purchasable contact in any form.
      if (await isSuppressed({ company: p.company, city: p.city })) { optedOut++; continue }
      let email = saneEmail(p.email)
      if (email && (await emailReach(email)) === 'dead') {
        email = undefined
        deadStripped++
      }
      const phone = sanePhone(p.phone)
      if (!email && !phone) { unusable++; continue }

      const key = companyKeyFor(p.company, p.city, p.website)
      const existing = await db.leadLookupCache.findUnique({ where: { companyKey: key } })
      if (existing && (existing.email || existing.phone)) { alreadyKnown++; continue }

      await cachePutContact(key, {
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(p.contactName ? { contactName: p.contactName } : {}),
        source: `verified pool (${p.source}${p.poolTag ? ` · ${p.poolTag}` : ''})`,
      })
      cached++
    }

    const nextCursor = rows.length === POOL_BATCH ? rows[rows.length - 1].id : null
    return NextResponse.json({
      ok: true,
      source: 'pool',
      scanned: rows.length,
      cached,
      alreadyKnown,
      deadStripped,
      unusable,
      optedOut,
      nextCursor,
      message: nextCursor
        ? `Pool pre-warm batch: ${cached} businesses added to the shared memory, ${alreadyKnown} already known. Continue with the returned cursor.`
        : `Pool pre-warm complete: ${cached} businesses added to the shared memory, ${alreadyKnown} already known.`,
    })
  }

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
