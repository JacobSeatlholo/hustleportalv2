/**
 * Google Calendar sync for appointments.
 * Two tiers:
 *  1. Zero-cred: gcalTemplateLink (see ics.ts) — one-click "Add to Google Calendar".
 *  2. Token-based: if the user stored a GCAL_OAUTH_TOKEN in Integrations (from OAuth
 *     Playground or their own flow), we insert events via the Calendar API directly.
 */
import { db } from '@/lib/db'

export async function getGcalToken(userId: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: 'GCAL_OAUTH_TOKEN' } },
  })
  return row?.value || null
}

export type GcalEventInput = {
  title: string
  description?: string | null
  location?: string | null
  startsAt: Date
  endsAt?: Date | null
}

export async function gcalInsert(
  userId: string,
  e: GcalEventInput,
): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> {
  const token = await getGcalToken(userId)
  if (!token) return { ok: false, error: 'NO_TOKEN: connect Google Calendar in Integrations.' }
  try {
    const end = e.endsAt || new Date(e.startsAt.getTime() + 60 * 60 * 1000)
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: e.title,
          description: e.description || undefined,
          location: e.location || undefined,
          start: { dateTime: e.startsAt.toISOString() },
          end: { dateTime: end.toISOString() },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Google Calendar ${res.status}: ${body.slice(0, 160)}` }
    }
    const data = (await res.json()) as { id?: string }
    if (!data.id) return { ok: false, error: 'Google Calendar returned no event id.' }
    return { ok: true, eventId: data.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Google Calendar request failed' }
  }
}
