import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { replaySentHtml } from '@/lib/mailer'
import { unsubscribeUrl } from '@/lib/campaignqueue'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'
import { rateLimit, tooMany } from '@/lib/ratelimit'

// POST /api/emails/preview → what the recipient saw for a given look.
//
// Two jobs, one door:
//   1. The composer's "Preview" button posts the draft body plus the picked
//      look — the exact html the engine would build for it, checked BEFORE
//      the email exists. Nothing stored, nothing sent.
//   2. The sent-mail preview (mail log, campaign rows, lead activity, exec
//      archive) posts the logged body + theme + row context — replaySentHtml
//      rebuilds the html that actually went out. Campaign rows get their
//      signed unsubscribe link back, but never the open pixel: a preview
//      must not count as a read.
//
// 'plain' (and any unknown value) returns html: null — the honest answer that
// the plain look has no chrome, and the client says so in words.

const LOOKS: readonly string[] = ['boardroom', 'goldrush', 'nightshift', 'plain']

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Renders are cheap but this is still a door on the send path's house:
  // 30 looks a minute per account is far more than any composer needs.
  const gate = rateLimit(`mail-preview:${userId}`, 30, 60 * 1000)
  if (!gate.ok) return NextResponse.json(tooMany(gate.retryAfterSec), { status: 429 })
  const b = await req.json().catch(() => ({}))
  const bodyText = String(b?.body || '')
  if (!bodyText.trim()) {
    return NextResponse.json({ error: 'Nothing to preview yet — write the message first.' }, { status: 400 })
  }
  const theme = LOOKS.includes(b?.theme) ? (b.theme as string) : null
  const isCampaign = b?.campaign != null && b?.campaign !== false && b?.campaign !== ''

  // The signed unsubscribe link only comes back for rows the caller may see:
  // execs replay any campaign row, members only their own. The link itself is
  // inert in a preview frame (sandboxed, never navigated).
  let unsubUrl: string | null = null
  if (isCampaign && typeof b?.rowId === 'string' && b.rowId) {
    const execGate = await requireExec()
    if (execGate.ok) {
      unsubUrl = unsubscribeUrl(b.rowId)
    } else {
      const own = await db.emailLog.findFirst({ where: { id: b.rowId, userId }, select: { id: true } })
      if (own) unsubUrl = unsubscribeUrl(b.rowId)
    }
  }

  const html = replaySentHtml({
    body: bodyText,
    theme,
    provider: typeof b?.provider === 'string' ? b.provider : null,
    campaign: isCampaign ? (typeof b?.campaign === 'string' ? b.campaign : 'campaign') : null,
    unsubUrl,
  })
  return NextResponse.json({ html: html || null })
}
