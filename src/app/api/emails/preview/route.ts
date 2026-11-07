import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { memberThemedHtml, memberFooter } from '@/lib/mailer'
import type { MailThemeId } from '@/lib/mailthemes'
import { rateLimit, tooMany } from '@/lib/ratelimit'

// POST /api/emails/preview → what the recipient sees for a given look.
//
// The composer's "Preview" button posts the draft body plus the picked look;
// this renders the exact html the platform engine would build for it (the
// member's words framed by the theme, the quiet delivery line as the closing
// block). Nothing is stored, nothing is sent — a pure look-and-feel render,
// so the sender checks the frame BEFORE the email exists.
//
// 'plain' (and any unknown value) returns html: null — the honest answer that
// the plain look has no chrome, and the client says so in words.

const LOOKS: readonly MailThemeId[] = ['boardroom', 'goldrush', 'nightshift', 'plain']

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
  const theme: MailThemeId = LOOKS.includes(b?.theme) ? b.theme : 'plain'
  // The engine lane's exact output: member's words + the delivery line, framed.
  const html = memberThemedHtml(bodyText + memberFooter(), theme)
  return NextResponse.json({ themed: !!html, html: html || null })
}
