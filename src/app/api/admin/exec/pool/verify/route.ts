import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { tregVerifyEmail, tregBalanceMicro, tregEnabled } from '@/lib/tregverify'
import { scoreFor, parseChecksSource } from '@/lib/leadpool'
import { bumpRevealStats } from '@/lib/leadlookup'

export const maxDuration = 60

/**
 * POST /api/admin/exec/pool/verify  { cursor?, take? }
 *   DOOR 3C FOR THE POOL: sweep the verified lead pool's emails through the
 *   mailbox gate and write the verdicts where the pool already keeps its
 *   truth — verifyChecks { emailOk, emailCatchAll }, verifyScore, and
 *   emailDeadAt for the proved-dead. This is the pre-warm pump's twin: instead
 *   of feeding the memory, it feeds the quality promise, one row at a time.
 *
 *   Economics (measured on our own pool, 2026-10-31): $0.00178 per proved
 *   mailbox (R0.03); catch-all and unknown verdicts settle at $0. Verdicts
 *   are cached platform-wide by tregverify, so a re-sweep costs nothing until
 *   the cache TTLs out. The cursor makes the sweep resumable and the take cap
 *   keeps one invocation inside the function clock — run it repeatedly until
 *   nextCursor is null, like every other pump.
 *
 *   Honest accounting: every verdict bumps the REVEAL_STATS door counters
 *   (verify / verifyDead + verifyCostMicro), so the operator sees the gate's
 *   spend on the same lens as the reveals it protects.
 */

const BATCH_MAX = 50
const BATCH_DEFAULT = 25
/** Stop sweeping while the team balance still holds at least this much: the sweep must never be the call that runs the account dry. */
const BALANCE_FLOOR_MICRO = 5_000
/** A polite breath between paid calls; millionverifier is generous but we are a guest. */
const PACING_MS = 300

function saneEmail(v?: string | null): string | undefined {
  const s = (v || '').trim()
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined
  if (/example\.(com|org|net)|your(email)?\.|domain\.com/i.test(s)) return undefined
  return s
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  if (!tregEnabled) {
    return NextResponse.json(
      { error: 'TREG_TOKEN is not set on this deployment. Add it in Vercel (or the shell env) and sweep again.' },
      { status: 400 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const take = Math.min(Math.max(Number(body?.take) || BATCH_DEFAULT, 1), BATCH_MAX)
  const cursor = typeof body?.cursor === 'string' && body.cursor ? body.cursor : undefined

  const balanceBefore = await tregBalanceMicro()
  if (balanceBefore === null) {
    return NextResponse.json({ error: 'Could not read the treg balance (token or network trouble). Nothing was swept.' }, { status: 502 })
  }
  if (balanceBefore < BALANCE_FLOOR_MICRO) {
    return NextResponse.json({
      ok: true,
      swept: 0,
      message: `treg balance $${(balanceBefore / 1e6).toFixed(2)} is under the $0.05 sweep floor. Top up the team account first.`,
    })
  }

  const rows = await db.leadPool.findMany({
    where: { active: true, email: { not: null }, emailDeadAt: null },
    orderBy: { id: 'asc' },
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: { id: true, company: true, email: true, website: true, confirmCount: true, verifyChecks: true },
  })

  const now = new Date()
  let valid = 0
  let invalid = 0
  let catchAll = 0
  let unknown = 0
  let skipped = 0
  let costMicro = 0

  for (const row of rows) {
    const email = saneEmail(row.email)
    if (!email) {
      skipped++
      continue
    }
    const result = await tregVerifyEmail(email, { timeoutMs: 15_000 })
    costMicro += result.costMicro
    if (result.cached) skipped++

    const prev = parseChecksSource(row.verifyChecks)
    const checks = { ...prev, checkedAt: now.toISOString() }

    if (result.verdict === 'valid') {
      valid++
      await db.leadPool.update({
        where: { id: row.id },
        data: {
          lastVerifiedAt: now,
          verifyScore: scoreFor({ ...prev, emailOk: true }, row.confirmCount, Boolean(row.website)),
          verifyChecks: JSON.stringify({ ...checks, emailOk: true, emailCatchAll: false }),
        },
      })
    } else if (result.verdict === 'invalid') {
      invalid++
      // The provider PROVED the mailbox is gone: the same law as a provider
      // bounce webhook. The face keeps serving, just never with this email.
      await db.leadPool.update({
        where: { id: row.id },
        data: {
          emailDeadAt: now,
          verifyChecks: JSON.stringify({ ...checks, emailOk: false }),
        },
      })
    } else if (result.verdict === 'catch_all') {
      catchAll++
      // The domain accepts anything, so this verdict proves nothing either
      // way: record it, raise nothing, kill nothing.
      await db.leadPool.update({
        where: { id: row.id },
        data: { verifyChecks: JSON.stringify({ ...checks, emailCatchAll: true }) },
      })
    } else {
      // unknown: a non-answer. Never punished, never stored as fact.
      unknown++
    }

    await bumpRevealStats(result.verdict === 'invalid' ? 'verifyDead' : 'verify', result.costMicro)
    // Only an actual paid call needs the breath; cache hits were free anyway.
    if (!result.cached) await new Promise((r) => setTimeout(r, PACING_MS))
  }

  const balanceAfter = (await tregBalanceMicro()) ?? balanceBefore
  const nextCursor = rows.length === take ? rows[rows.length - 1].id : null

  return NextResponse.json({
    ok: true,
    swept: rows.length,
    valid,
    invalid,
    catchAll,
    unknown,
    skippedCachedOrJunk: skipped,
    costUsd: Number((costMicro / 1e6).toFixed(5)),
    balanceUsd: Number((balanceAfter / 1e6).toFixed(4)),
    nextCursor,
    message: nextCursor
      ? `Sweep batch done: ${valid} proven live, ${invalid} proved dead, ${catchAll} catch-all. Continue with the returned cursor.`
      : `Pool sweep complete: ${valid} proven live, ${invalid} proved dead, ${catchAll} catch-all. The whole active pool now wears its mailbox truth.`,
  })
}
