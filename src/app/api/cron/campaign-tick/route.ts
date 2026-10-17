import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { tickCampaigns } from '@/lib/campaignqueue'

export const maxDuration = 60

/**
 * The heartbeat of the campaign queue. Anyone trusted may tap it:
 *   - Vercel Cron / cron-job.org with the bearer secret
 *   - an open Campaigns screen (exec session) keeping the line moving
 * Pacing is counted from the database, so extra ticks never speed it up.
 *
 * Wire a free 5 minute cron (cron-job.org -> GET this URL with the
 * Authorization: Bearer <CRON_SECRET> header) to pace queues all day while
 * the tab is closed. The UI ticks on its own while Mail is open.
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
  return NextResponse.json({ ok: true, ...r })
}
