import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import {
  tregVerifyEmail,
  tregBalanceMicro,
  tregEnabled,
  tregExecSnapshot,
  tregSweepSpendMicro,
  TREG_ENDPOINT_CONTACTOUT,
} from '@/lib/tregverify'
import { scoreFor, parseChecksSource } from '@/lib/leadpool'
import { bumpRevealStats } from '@/lib/leadlookup'
import { emailReach } from '@/lib/reach'

export const maxDuration = 300

/**
 * POST /api/admin/exec/pool/verify — DOOR 3C FOR THE POOL, on a budget.
 *
 * THE CAP (2026-10-31, raised from $0.30 after the owner topped up): paid
 * sweeps may spend at most SWEEP_BUDGET_USD ($2.00) EVER, measured off the
 * call ledger — not per run, in total. The cap survives restarts and operator
 * memory; the lens shows what remains.
 *  1. FREE KILLS FIRST: before a paid call, the row's domain goes through the
 *     platform's own DNS reach gate (reach.ts, $0). A domain that provably
 *     cannot accept mail is stamped dead without spending a cent of budget —
 *     the exact verdict millionverifier would have charged $0.00178 to say.
 *  2. HEAD FIRST: mode "head" (the default) sweeps the same rows the owner's
 *     picker shows — highest verifyScore first — so the budget lands on the
 *     contacts members actually get handed, not the tail of the pool.
 *  3. THE FREE DRIP: provider "contactout" runs the same sweep on the catalog
 *     tool that charges $0 per call. It is heavily rate-limited, so a drip
 *     takes at most 2 rows with 18s pacing — run it when idle, it costs
 *     nothing, and unknowns (throttles) are never stored, just retried later.
 *  4. THE TILL PAYS ITS OWN WAY: Door 3c at the reveal (via=reveal) is
 *     revenue-backed — $0.00178 against a R15 sale — and does not touch the
 *     sweep budget. A dry balance never breaks a reveal: fail-open unknown.
 *
 * Verdicts land in the same places as ever: verifyChecks { emailOk,
 * emailCatchAll }, verifyScore, emailDeadAt on proof of death, REVEAL_STATS
 * doors, and every real call leaves its call-id receipt on the ledger.
 */

const BATCH_MAX = 50
const BATCH_DEFAULT = 25
/** Stop sweeping while the team balance still holds at least this much: the sweep must never be the call that runs the account dry. */
const BALANCE_FLOOR_MICRO = 5_000
/** A polite breath between paid calls; millionverifier is generous but we are a guest. */
const PACING_MS = 300
/** The free drip: at most these rows per invocation, paced for the provider's rate limit. */
const DRIP_TAKE = 2
const DRIP_PACING_MS = 18_000
/** The whole point of this file today: the pool sweep's lifetime spend cap, in USD.
 *  History: $0.30 while the owner chose not to top up (the treg minimum is $10).
 *  Raised to $2.00 on 2026-10-31 after the owner loaded the balance (~$10.87) —
 *  enough to clear the whole ~900-row pending backlog (~$1.61 at $0.00178/call,
 *  DNS-dead rows killed free first) with the floor and the guards unchanged. */
const SWEEP_BUDGET_USD = 2.0
/** Never START a call when less than this much of the function clock remains — a call started at T-15s with a 15s timeout lands exactly on the kill line, never past it. */
const CLOCK_GUARD_MS = 15_000
/** The function clock this route may use (matches maxDuration above; raised
 *  2026-10-31 from 60s so one sweep run clears ~5× the rows — the backlog
 *  pass was spending more wall time on cold starts than on calls). */
const CLOCK_BUDGET_MS = 285_000
/** Head mode sweeps the picker's world: this many top rows, best first. */
const HEAD_SIZE = 300

function saneEmail(v?: string | null): string | undefined {
  const s = (v || '').trim()
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined
  if (/example\.(com|org|net)|your(email)?\.|domain\.com/i.test(s)) return undefined
  return s
}

const usd = (micro: number) => Number((micro / 1e6).toFixed(4))

/**
 * GET /api/admin/exec/pool/verify — the mailbox gate's lens on the exec
 * dashboard. One read of the whole truth: is the gate lit (token present),
 * what the team balance stands at, how much of the active pool wears proved
 * mailbox truth (verified / catch-all / pending / proved-dead), what the
 * verdict store remembers, the last real provider receipts with their call
 * ids and charges, and the REVEAL_STATS gate doors. Everything best-effort;
 * a dead part reads zero, never a broken dashboard.
 */
export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const snap = await tregExecSnapshot({ ledgerTake: 25 })
  const sweepSpent = (snap.ledger.via.sweep?.spendMicro || 0) + (snap.ledger.via.drip?.spendMicro || 0)
  const budgetMicro = Math.round(SWEEP_BUDGET_USD * 1e6)

  return NextResponse.json({
    ok: true,
    treg: {
      enabled: snap.enabled,
      tokenSource: snap.tokenSource,
      balanceUsd: snap.balanceMicro === null ? null : usd(snap.balanceMicro),
      ...(snap.enabled
        ? {}
        : {
            fix: 'TREG_TOKEN is not set on this deployment. Add it in Vercel (Settings → Environment Variables, name TREG_TOKEN, the treg team token) and redeploy — the gate stays a no-op until then.',
          }),
    },
    pool: snap.pool,
    store: { ...snap.store, spendUsd: usd(snap.store.spendMicro) },
    ledger: { ...snap.ledger, spendUsd: usd(snap.ledger.spendMicro) },
    stats: {
      today: { ...snap.stats.today, costUsd: usd(snap.stats.today.costMicro) },
      days30: { ...snap.stats.days30, costUsd: usd(snap.stats.days30.costMicro) },
    },
    // The $0.30 plan, visible: the cap, what the pool sweeps have spent of it,
    // what remains, and the two doors that spend it (paid head sweep + free drip).
    budget: {
      capUsd: SWEEP_BUDGET_USD,
      spentUsd: usd(sweepSpent),
      remainingUsd: usd(Math.max(0, budgetMicro - sweepSpent)),
      via: snap.ledger.via,
      paidSweep: {
        how: 'POST { "take": 25 } — head rows first, DNS-dead domains killed free, stops itself at the cap or the clock.',
      },
      freeDrip: {
        how: 'POST { "provider": "contactout", "take": 2 } whenever idle — $0 per call, pace built in, throttles just retry later.',
      },
    },
    sweep: {
      floorUsd: 0.05,
      how: 'POST here with { "take": 25 } (and "cursor" from the previous run) until nextCursor comes back null. Cached verdicts re-sweep free.',
    },
  })
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
  const freeDrip = body?.provider === 'contactout'
  const mode = body?.mode === 'all' ? 'all' : 'head'
  const take = freeDrip
    ? Math.min(Math.max(Number(body?.take) || DRIP_TAKE, 1), DRIP_TAKE)
    : Math.min(Math.max(Number(body?.take) || BATCH_DEFAULT, 1), BATCH_MAX)
  const cursor = typeof body?.cursor === 'string' && body.cursor ? body.cursor : undefined
  const budgetMicro = Math.round(SWEEP_BUDGET_USD * 1e6)

  // The cumulative budget, read before a cent is spent. The free drip is
  // welcome even when the paid cap is exhausted — that is the whole design.
  const budgetSpentBefore = await tregSweepSpendMicro()
  if (!freeDrip && budgetSpentBefore >= budgetMicro) {
    return NextResponse.json({
      ok: true,
      budgetReached: true,
      capUsd: SWEEP_BUDGET_USD,
      spentUsd: usd(budgetSpentBefore),
      swept: 0,
      message:
        `The pool sweep has spent its $${SWEEP_BUDGET_USD.toFixed(2)} budget ($${usd(budgetSpentBefore)} so far). ` +
        'Nothing was spent now. Run the free contactout drip for more coverage, or raise SWEEP_BUDGET_USD deliberately in code.',
    })
  }

  // The drip rides the free tool: no balance floor, no budget — but the token
  // still has to be live, and the till's provider stays millionverifier.
  if (!freeDrip) {
    const balanceBefore = await tregBalanceMicro()
    if (balanceBefore === null) {
      return NextResponse.json({ error: 'Could not read the treg balance (token or network trouble). Nothing was swept.' }, { status: 502 })
    }
    if (balanceBefore < BALANCE_FLOOR_MICRO) {
      return NextResponse.json({
        ok: true,
        swept: 0,
        message: `treg balance $${(balanceBefore / 1e6).toFixed(2)} is under the $0.05 sweep floor. The free contactout drip still works: { "provider": "contactout", "take": 2 }.`,
      })
    }
  }

  // HEAD FIRST: the picker's world — the rows the owner actually sees and
  // hands out, best score first, already-answered rows skipped (their cached
  // verdicts were already applied). The long tail waits for mode "all".
  let rows: Array<{ id: string; company: string; email: string | null; website: string | null; confirmCount: number; verifyChecks: string | null }>
  let headPendingTotal = 0
  if (mode === 'head' || freeDrip) {
    const head = await db.leadPool.findMany({
      where: { active: true, verifyState: { not: 'stale' } },
      orderBy: [{ verifyScore: 'desc' }, { lastSeenAt: 'desc' }],
      take: HEAD_SIZE,
      select: { id: true, company: true, email: true, website: true, confirmCount: true, verifyChecks: true, emailDeadAt: true },
    })
    const pending = head.filter((r) => {
      if (!r.email || r.emailDeadAt) return false
      const c = parseChecksSource(r.verifyChecks)
      return c.emailOk !== true && c.emailCatchAll !== true
    })
    headPendingTotal = pending.length
    rows = freeDrip ? pending.slice(0, take) : pending.slice(0, take)
  } else {
    rows = await db.leadPool.findMany({
      where: { active: true, email: { not: null }, emailDeadAt: null },
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, company: true, email: true, website: true, confirmCount: true, verifyChecks: true },
    })
  }

  const now = new Date()
  const t0 = Date.now()
  let valid = 0
  let invalid = 0
  let catchAll = 0
  let unknown = 0
  let skipped = 0
  let dnsDead = 0
  let costMicro = 0
  let budgetHit = false
  let clockHit = false
  let lastRowId: string | null = null

  for (const row of rows) {
    lastRowId = row.id
    const email = saneEmail(row.email)
    if (!email) {
      skipped++
      continue
    }

    // FREE KILL FIRST: the platform's own DNS gate. A domain that provably
    // cannot accept mail is stamped dead here for $0 — the exact verdict the
    // paid provider would have charged to deliver.
    if ((await emailReach(email)) === 'dead') {
      dnsDead++
      const prev = parseChecksSource(row.verifyChecks)
      await db.leadPool.update({
        where: { id: row.id },
        data: {
          emailDeadAt: now,
          verifyChecks: JSON.stringify({
            ...prev,
            checkedAt: now.toISOString(),
            emailOk: false,
            emailCatchAll: false,
          }),
        },
      })
      await bumpRevealStats('verifyDead', 0)
      continue
    }

    // CLOCK GUARD: millionverifier can take 10s on a slow domain; never start
    // a call the function clock cannot finish. The next run picks the rest up.
    if (Date.now() - t0 > CLOCK_BUDGET_MS - CLOCK_GUARD_MS) {
      clockHit = true
      break
    }

    const result = await tregVerifyEmail(email, {
      // 30s: greylisting/slow SMTP probes routinely take >15s, and a timeout
      // fail-opens to unknown that is never durably cached — the row then
      // retries every sweep forever. 30s (the probe door's default) resolves
      // them; the clock guard below still keeps the function inside budget.
      timeoutMs: 30_000,
      via: freeDrip ? 'drip' : 'sweep',
      ...(freeDrip ? { endpoint: TREG_ENDPOINT_CONTACTOUT, timeoutMs: 14_000 } : {}),
    })
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
      // way: record it, kill nothing — but it DOES strip a stale verified
      // bonus. A catch-all answer is not a proof of life, so a row that a
      // previous sweep proved live loses the mailbox bonus until a provider
      // proves the mailbox itself again. Reachable, unverified — never the
      // verified badge.
      await db.leadPool.update({
        where: { id: row.id },
        data: {
          verifyChecks: JSON.stringify({ ...checks, emailOk: false, emailCatchAll: true }),
          verifyScore: scoreFor({ ...prev, emailOk: false }, row.confirmCount, Boolean(row.website)),
        },
      })
    } else {
      // unknown: a non-answer. Never punished, never stored as fact — the
      // drip's throttles land here and simply retry on a later run.
      unknown++
    }

    await bumpRevealStats(result.verdict === 'invalid' ? 'verifyDead' : 'verify', result.costMicro)

    // BUDGET GUARD: stop the moment the pool's lifetime spend touches the cap.
    if (!freeDrip && budgetSpentBefore + costMicro >= budgetMicro) {
      budgetHit = true
      break
    }
    // The drip's only wait is the provider's rate limit; the paid sweep's is
    // plain politeness. Cache hits were free either way — no breath needed.
    if (!result.cached) await new Promise((r) => setTimeout(r, freeDrip ? DRIP_PACING_MS : PACING_MS))
  }

  const processed = valid + invalid + catchAll + unknown + skipped + dnsDead
  const budgetSpentAfter = budgetSpentBefore + costMicro

  if (freeDrip) {
    return NextResponse.json({
      ok: true,
      drip: true,
      provider: 'contactout',
      swept: rows.length,
      valid,
      invalid,
      catchAll,
      unknown,
      throttled: unknown,
      skippedCachedOrJunk: skipped,
      dnsDead,
      costUsd: Number((costMicro / 1e6).toFixed(5)),
      headPendingRemaining: Math.max(0, headPendingTotal - processed),
      message: `Free drip: ${valid} proven live, ${invalid} proved dead, ${catchAll} catch-all at $${(costMicro / 1e6).toFixed(5)}. Run it again whenever idle — it never costs anything.`,
    })
  }

  const balanceAfter = (await tregBalanceMicro({ fresh: true })) ?? 0
  // The walk's bookmark: a completed full window hands back its last row, and
  // a clock-cut run hands back the last row it actually answered — without
  // this, every clock-cut restarts the walk from id 1 and re-walks answered
  // rows (free on the verdict cache, but it eats the window and the clock).
  // NOTE: derived from the loop's own bookmark, NOT the counters — a cached
  // row bumps both `skipped` and its verdict bucket, so `processed` can
  // overshoot rows.length and an index off the counters crashes (seen live).
  const nextCursor =
    mode === 'all' && lastRowId && (budgetHit || clockHit || rows.length === take)
      ? lastRowId
      : null

  return NextResponse.json({
    ok: true,
    mode,
    swept: rows.length,
    processed,
    valid,
    invalid,
    catchAll,
    unknown,
    dnsDead,
    skippedCachedOrJunk: skipped,
    costUsd: Number((costMicro / 1e6).toFixed(5)),
    budget: {
      capUsd: SWEEP_BUDGET_USD,
      spentUsd: usd(budgetSpentAfter),
      remainingUsd: usd(Math.max(0, budgetMicro - budgetSpentAfter)),
      reached: budgetHit || budgetSpentAfter >= budgetMicro,
    },
    clockHit,
    balanceUsd: Number((balanceAfter / 1e6).toFixed(4)),
    nextCursor,
    headPendingRemaining: mode === 'head' ? Math.max(0, headPendingTotal - processed) : undefined,
    message: budgetHit
      ? `Budget guard: this run spent $${(costMicro / 1e6).toFixed(5)} and touched the $${SWEEP_BUDGET_USD.toFixed(2)} lifetime cap. ${valid} proven live, ${invalid} proved dead, ${dnsDead} killed free by DNS.`
      : clockHit
        ? `Clock guard: ${processed} rows processed, ${valid} proven live, ${invalid} proved dead, ${dnsDead} killed free by DNS. Run again to continue.`
        : `Sweep batch done: ${valid} proven live, ${invalid} proved dead, ${catchAll} catch-all, ${dnsDead} killed free by DNS.` +
          (mode === 'head' && headPendingTotal - processed > 0 ? ` ${headPendingTotal - processed} head rows still pending.` : ''),
  })
}
