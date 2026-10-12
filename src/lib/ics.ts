/** RFC 5545 ICS calendar export for appointments. */

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export type IcsEvent = {
  uid: string
  title: string
  description?: string | null
  location?: string | null
  startsAt: Date
  endsAt?: Date | null
}

export function buildICS(events: IcsEvent[]): string {
  const now = icsDate(new Date())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HustlePortal//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:HustlePortal Appointments',
  ]
  for (const e of events) {
    const end = e.endsAt || new Date(e.startsAt.getTime() + 60 * 60 * 1000)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@hustleportal`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(e.startsAt)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${escapeText(e.title)}`,
    )
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.filter(Boolean).join('\r\n')
}

/** One-click "Add to Google Calendar" template link (no auth required). */
export function gcalTemplateLink(e: IcsEvent): string {
  const end = e.endsAt || new Date(e.startsAt.getTime() + 60 * 60 * 1000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsDate(e.startsAt)}/${icsDate(end)}`,
    details: e.description || '',
    location: e.location || '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
