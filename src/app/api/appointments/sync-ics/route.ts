import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { safeUrl } from '@/lib/ssrf'
import { ingestIcsForUser, ICS_FEED_SETTING_KEY } from '@/lib/icsSync'

/**
 * POST /api/appointments/sync-ics — re-pull the saved calendar feed and add
 * anything new. The saved URL lives in UserSetting 'ICS_FEED_URL' (written by
 * import-ics when saveFeed was set). New events are added; events already
 * imported (matched by UID or title+time) are never duplicated.
 */

const FETCH_TIMEOUT_MS = 12_000

export async function POST() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const setting = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: ICS_FEED_SETTING_KEY } },
  })
  if (!setting?.value) {
    return NextResponse.json({ error: 'No calendar feed is saved yet. Import once with the feed link ticked, then Sync works from here.' }, { status: 400 })
  }

  const verdict = await safeUrl(setting.value)
  if (!verdict.ok || !verdict.url) {
    return NextResponse.json({ error: 'The saved feed address is no longer reachable. Remove it and paste the feed link again.' }, { status: 400 })
  }
  try {
    const res = await fetch(verdict.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/calendar, text/plain, */*' },
    })
    if (!res.ok) {
      return NextResponse.json({ error: `The calendar feed answered ${res.status}. Try again shortly.` }, { status: 400 })
    }
    const text = await res.text()
    if (!/BEGIN:VCALENDAR/i.test(text) && !/BEGIN:VEVENT/i.test(text)) {
      return NextResponse.json({ error: 'The feed no longer returns a calendar. Check it in your calendar app.' }, { status: 400 })
    }
    const result = await ingestIcsForUser(userId, text)
    if (result.imported === 0) {
      return NextResponse.json({ ...result, message: 'Already up to date — nothing new on the feed.' })
    }
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Could not reach the calendar feed just now. Try again shortly.' }, { status: 400 })
  }
}

export async function GET() {
  // Feed status for the Calendar UI: is a feed connected?
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const setting = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: ICS_FEED_SETTING_KEY } },
  })
  return NextResponse.json({ connected: Boolean(setting?.value), url: setting?.value || null })
}

export async function DELETE() {
  // Disconnect the feed — imported events stay; sync simply stops.
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await db.userSetting.deleteMany({ where: { userId, key: ICS_FEED_SETTING_KEY } })
  return NextResponse.json({ ok: true })
}
