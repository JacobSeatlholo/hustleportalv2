import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pingWebsite, hostOf, scoreFor, parseChecksSource } from '@/lib/leadpool'

export const maxDuration = 60

/**
 * Daily lead pool refresh — Vercel Cron hits this once a day (off peak).
 *
 * The freshness contract of the Verified Lead Pool lives here:
 *  1. DEMOTE: any business unseen on a scan for 60 days is marked stale and
 *     never surfaces in a fresh pool serve again. Dead listings do not come back.
 *  2. RE-CHECK: the stalest website bearing records get their site pinged
 *     again. A live site upgrades the record to "active"; a dead one drops the
 *     website badge honestly. No AI quota is spent — plain HTTP checks only.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return true // no secret configured — rely on the endpoint being harmless
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1) Demote the long unseen: 60 days without a scan re confirming it.
  const staleCut = new Date(Date.now() - 60 * 86_400_000)
  const demoted = await db.leadPool.updateMany({
    where: { active: true, verifyState: { not: 'stale' }, lastSeenAt: { lt: staleCut } },
    data: { verifyState: 'stale' },
  })

  // 2) Re-check the stalest website bearing records (skip anything verified in
  //    the last 2 days so the batch always works on the oldest first).
  const freshCut = new Date(Date.now() - 2 * 86_400_000)
  const batch = await db.leadPool.findMany({
    where: {
      active: true,
      verifyState: { not: 'stale' },
      website: { not: null },
      OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: freshCut } }],
    },
    orderBy: [{ lastVerifiedAt: { sort: 'asc', nulls: 'first' } }, { lastSeenAt: 'desc' }],
    take: 60,
  })

  let live = 0
  let dead = 0
  for (let i = 0; i < batch.length; i += 8) {
    await Promise.all(
      batch.slice(i, i + 8).map(async (r) => {
        const host = hostOf(r.website || '')
        if (!host) return
        const ok = await pingWebsite(host)
        const prev = parseChecksSource(r.verifyChecks)
        const checks = { phoneOk: prev.phoneOk, websiteOk: ok, checkedAt: new Date().toISOString() }
        const score = scoreFor(checks, r.confirmCount, true)
        await db.leadPool.update({
          where: { id: r.id },
          data: {
            verifyChecks: JSON.stringify(checks),
            lastVerifiedAt: new Date(),
            verifyScore: score,
            verifyState: ok ? 'active' : r.verifyState === 'active' ? 'listed' : r.verifyState,
          },
        })
        if (ok) live++
        else dead++
      })
    )
  }

  // 3) PRUNE: scan logs older than 45 days leave. The cooldown, the daily
  //    allowance and the warm window all live within a single day, so old rows
  //    are pure ballast — without this the table grows one row per scan,
  //    forever, on a platform whose promise is scans every day at scale.
  const pruned = await db.scanRun.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 45 * 86_400_000) } },
  })

  return NextResponse.json({ ok: true, demoted: demoted.count, rechecked: batch.length, live, dead, prunedScans: pruned.count })
}
