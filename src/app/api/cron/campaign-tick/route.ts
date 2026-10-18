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
  if (!secret) return false // no secret configured — session gate only
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!bearerOk(req)) {
    const gate = await requireExec()
    if (!gate.ok) return gate.res
  }
  const r = await tickCampaigns(30)
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const lifecycle = await runLifecycleSweep(dry)
  return NextResponse.json({ ok: true, ...r, lifecycle })
}
