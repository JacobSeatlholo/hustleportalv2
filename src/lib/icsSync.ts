import { db } from '@/lib/db'
import { parseIcs } from '@/lib/icsImport'
import { resolveProject } from '@/lib/workspace'

/**
 * icsSync.ts, the shared ingest for one-shot ICS imports and feed syncs.
 * Dedupe law: an event with a UID never lands twice (uid is the calendar
 * world's identity); UID-less events are matched on title + start time
 * (±90 seconds, because feeds love to shave seconds).
 */

export interface IngestResult {
  imported: number
  duplicates: number
  total: number
  skipped: number
}

export async function ingestIcsForUser(
  userId: string,
  icsText: string,
  opts?: { maxEvents?: number }
): Promise<IngestResult> {
  const { events, total, skipped } = parseIcs(icsText, { maxEvents: opts?.maxEvents ?? 500 })
  if (events.length === 0) return { imported: 0, duplicates: 0, total, skipped }

  const project = await resolveProject(userId, null)
  const existing = await db.appointment.findMany({
    where: { userId, source: 'ICS' },
    select: { externalId: true, title: true, startsAt: true },
    take: 2000,
  })
  const seenUids = new Set<string>()
  for (const a of existing) if (a.externalId) seenUids.add(a.externalId)

  const fuzzyMatch = (title: string, startsAt: Date) =>
    existing.some(
      (a) =>
        a.title === title &&
        Math.abs(a.startsAt.getTime() - startsAt.getTime()) <= 90 * 1000
    )

  let imported = 0
  let duplicates = 0
  const batchUids = new Set<string>()

  for (const ev of events) {
    const uid = ev.uid ? `${ev.uid}`.slice(0, 250) : null
    if (uid) {
      if (seenUids.has(uid) || batchUids.has(uid)) {
        duplicates++
        continue
      }
    } else if (fuzzyMatch(ev.title, ev.startsAt)) {
      duplicates++
      continue
    }
    await db.appointment.create({
      data: {
        userId,
        projectId: project.id,
        title: ev.title,
        notes: ev.description,
        // External events keep their own location; no Jitsi link is invented.
        meetLink: null,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        source: 'ICS',
        externalId: uid,
        icsFeed: true,
      },
    })
    if (uid) batchUids.add(uid)
    existing.push({ externalId: uid, title: ev.title, startsAt: ev.startsAt })
    imported++
  }
  return { imported, duplicates, total, skipped }
}

export const ICS_FEED_SETTING_KEY = 'ICS_FEED_URL'
