import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { tickCampaigns } from '@/lib/campaignqueue'
import { runLifecycleSweep } from '@/lib/lifecycle'

export const maxDuration = 60

/**
 * The heartbeat of the campaign queue. Anyone trusted may tap it:
 *   - Vercel Cron / cron-job.org with the bearer secret
 *   - an open Campaigns screen (exec session) keeping the line moving
 * Pacing is counted from the database, so extra ticks never speed it up.
 *
 * The same heartbeat drives the lifecycle machine: once an hour it sweeps for
 * humans who joined and never started, and unfinished checkouts at the till.
 * ?dry=1 (still bearer gated) reports who WOULD hear from us without sending.
 */
function bearerOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false // no secret configured, session gate only
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
}

// Instance-level tick guard (2026-11-19): every tick touches the DB, and on
// Neon's free plan a DB touch costs ~6 minutes of awake compute (5-min
// suspend grace). The campaign interval lives in cron-job.org, so a stray
// second job or an over-eager pinger would silently multiply the awake time
// and burn the monthly CU-hour allowance again. 25 minutes of guard keeps
// ONE 30-minute cron fully effective while collapsing duplicates to no-ops;
// real sends stay governed by the database pacing law either way.
const TICK_GUARD_MS = 25 * 60 * 1000
let lastTickAt = 0

export async function GET(req: NextRequest) {
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  if (!bearerOk(req)) {
    const gate = await requireExec()
    if (!gate.ok) return gate.res
  }
  // The guard applies only to the automated bearer tick (the 24/7 waker).
  // A human tap — an open Campaigns screen keeping the line moving, or a
  // ?dry=1 QA probe — always goes through, it is rare and intentional.
  const now = Date.now()
  if (!dry && now - lastTickAt < TICK_GUARD_MS) {
    return NextResponse.json({ ok: true, skipped: 'tick-guard', retryAfterSec: Math.ceil((TICK_GUARD_MS - (now - lastTickAt)) / 1000) })
  }
  lastTickAt = now
  const r = await tickCampaigns(30)
  const lifecycle = await runLifecycleSweep(dry)
  return NextResponse.json({ ok: true, ...r, lifecycle })
}
