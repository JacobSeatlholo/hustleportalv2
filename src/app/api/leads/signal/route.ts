import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { recordLeadSignal } from '@/lib/leadsignal'

export const maxDuration = 15

/**
 * POST /api/leads/signal, the learning loop's intake.
 *
 * The Lead Finder cards carry two new verbs: the save flow fires a SAVE
 * signal when a lead lands in the pipeline, and a dismiss button opens one
 * tap reasons and fires DISMISS. Both land here, the trade is resolved on
 * the server, and the seller's taste profile grows one row at a time.
 * A failed signal must never break the save or the dismiss itself.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const ok = await recordLeadSignal(userId, {
    signal: String(b.signal || ''),
    reason: b.reason as string | null | undefined,
    company: String(b.company || ''),
    industry: b.industry as string | null | undefined,
    city: b.city as string | null | undefined,
    source: b.source as string | null | undefined,
  })
  if (!ok) return NextResponse.json({ error: 'Could not record that signal.' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
