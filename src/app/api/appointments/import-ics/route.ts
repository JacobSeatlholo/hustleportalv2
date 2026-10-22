import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { safeUrl } from '@/lib/ssrf'
import { ingestIcsForUser, ICS_FEED_SETTING_KEY } from '@/lib/icsSync'

/**
 * POST /api/appointments/import-ics, bring an existing calendar in without retyping it.
 * Body: { ics?: string, url?: string, saveFeed?: boolean }
 *  - ics: pasted or uploaded .ics file content (one-shot import)
 *  - url: a read-only calendar feed (Google Calendar "secret iCal address",
 *    Outlook, Apple Calendar…). Fetched server-side through the SSRF guard.
 *  - saveFeed: remember the URL so "Sync now" can re-pull it any time.
 */

const MAX_ICS_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 12_000

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const icsText = typeof body.ics === 'string' ? body.ics : ''
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  const saveFeed = Boolean(body.saveFeed)

  let text = icsText
  if (!text && rawUrl) {
    const verdict = await safeUrl(rawUrl)
    if (!verdict.ok || !verdict.url) {
      return NextResponse.json(
        { error: 'That address is not a reachable calendar link. Use the public https address of the feed.' },
        { status: 400 },
      )
    }
    try {
      const res = await fetch(verdict.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: 'text/calendar, text/plain, */*' },
      })
      if (!res.ok) {
        return NextResponse.json({ error: `The calendar feed answered ${res.status}. Check that the link is public and correct.` }, { status: 400 })
      }
      text = await res.text()
    } catch {
      return NextResponse.json({ error: 'Could not reach that calendar feed. Check the link and try again.' }, { status: 400 })
    }
  }

  if (!text || text.trim().length === 0) {
    return NextResponse.json({ error: 'Paste the calendar file content or give a feed link.' }, { status: 400 })
  }
  if (text.length > MAX_ICS_BYTES) {
    return NextResponse.json({ error: 'That calendar file is too large. Export a shorter date range and try again.' }, { status: 400 })
  }
  if (!/BEGIN:VCALENDAR/i.test(text) && !/BEGIN:VEVENT/i.test(text)) {
    return NextResponse.json({ error: 'This does not look like a calendar (.ics) file, no events found in it.' }, { status: 400 })
  }

  const result = await ingestIcsForUser(userId, text)

  let feedSaved: boolean | undefined
  if (rawUrl && saveFeed) {
    await db.userSetting.upsert({
      where: { userId_key: { userId, key: ICS_FEED_SETTING_KEY } },
      create: { userId, key: ICS_FEED_SETTING_KEY, value: rawUrl },
      update: { value: rawUrl },
    })
    feedSaved = true
  }

  if (result.imported === 0 && result.total > 0) {
    return NextResponse.json({
      ...result,
      feedSaved,
      message: 'Every event in that calendar is already here, nothing new to add.',
    })
  }
  return NextResponse.json({ ...result, feedSaved })
}
