import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { replaySentHtml } from '@/lib/mailer'
import { unsubscribeUrl, readCampaignStates, effectiveCampaignBrand, campaignStandardCharacter } from '@/lib/campaignqueue'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { sanitizeBrand } from '@/lib/mailthemes'

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
// THE BRAND LAW (same on the send path and here, so a preview never lies):
//   a campaign's chrome comes from its queue state — the sender's brand when
//   the queue carries one, else the sending identity's name for member-owned
//   queues — and member-owned or branded queues ride the standard character
//   (blank-shirt badger, neutral HP chip). The BH-vested chrome replays only
//   for HustlePortal's own unbranded exec mail. A member can never pull
//   another member's brand: the state is resolved from the ROW's campaign
//   tag, and non-exec callers only ever reach their own rows.
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
  let theme = LOOKS.includes(b?.theme) ? (b.theme as string) : null
  const isCampaign = b?.campaign != null && b?.campaign !== false && b?.campaign !== ''

  // Exec sees every row; a member only their own. The row is the permission
  // gate AND the ground truth for which campaign's chrome replays.
  const execGate = await requireExec()
  const rowId = typeof b?.rowId === 'string' && b.rowId ? b.rowId : null
  const row = rowId
    ? (execGate.ok
        ? await db.emailLog.findUnique({ where: { id: rowId }, select: { userId: true, campaign: true } })
        : await db.emailLog.findFirst({ where: { id: rowId, userId }, select: { userId: true, campaign: true } }))
    : null

  // The signed unsubscribe link only comes back for rows the caller may see.
  // The link itself is inert in a preview frame (sandboxed, never navigated).
  const unsubUrl = row ? unsubscribeUrl(rowId as string) : null

  // The chrome law. Campaign context (a row, or an exec caller naming a tag)
  // resolves the queue state — the same brand + standard-character decision
  // the send engine makes at send time. Without context, the requester's own
  // law applies: members see the standard chrome, exec the BH one.
  let brand = execGate.ok ? undefined : sanitizeBrand(b?.brand) || undefined
  let standardCharacter = !execGate.ok
  const stateTag = row?.campaign || (execGate.ok && isCampaign && typeof b?.campaign === 'string' ? b.campaign : null)
  if (stateTag) {
    const states = await readCampaignStates()
    const state = states[stateTag]
    if (state) {
      brand = effectiveCampaignBrand(state)
      standardCharacter = campaignStandardCharacter(state)
      // The look rides the state (Edit draft re-skins a queue without
      // touching rows), so the replay reads it from there, not the client.
      if (state.theme && LOOKS.includes(state.theme)) theme = state.theme
    }
  }

  const html = replaySentHtml({
    body: bodyText,
    theme,
    provider: typeof b?.provider === 'string' ? b.provider : null,
    campaign: isCampaign ? (typeof b?.campaign === 'string' ? b.campaign : 'campaign') : null,
    unsubUrl,
    brand,
    standardCharacter,
  })
  return NextResponse.json({ html: html || null })
}
