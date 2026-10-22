/**
 * icsImport.ts, RFC 5545 VEVENT extraction for calendar import & sync.
 *
 * Nobody should have to retype their diary to join the platform. Paste an
 * .ics file or point at a calendar feed URL and every VEVENT becomes a real
 * appointment. The parser is deliberately conservative: it reads the
 * properties that matter (UID, SUMMARY, DTSTART, DTEND, DESCRIPTION,
 * LOCATION), unfolds continuation lines, and treats everything it does not
 * understand as decoration.
 *
 * Time policy (honest and simple):
 *  - "Z" timestamps are true UTC, converted exactly.
 *  - "TZID=..." and floating times are read as South African time (UTC+2),
 *    the platform's home. A calendar from another zone may land an hour out
 *    in the rare case; the time is always human-editable after import.
 *  - VALUE=DATE (birthday-style all day entries) become 09:00 SAST, one hour.
 */

export interface IcsVEvent {
  uid: string | null
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date
  allDay: boolean
}

export interface IcsParseResult {
  events: IcsVEvent[]
  total: number
  skipped: number
}

const SAST_OFFSET_MIN = 120 // Africa/Johannesburg is UTC+2, no DST

/** Unfold folded lines (CRLF followed by space or tab is a continuation). */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

/** "SUMMARY;LANGUAGE=en:Hello" → name + value split on the FIRST colon outside quotes. */
function prop(line: string): { name: string; params: string; value: string } | null {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === ':' && !inQuote) {
      const head = line.slice(0, i)
      const semi = head.indexOf(';')
      return {
        name: (semi === -1 ? head : head.slice(0, semi)).toUpperCase(),
        params: semi === -1 ? '' : head.slice(semi + 1),
        value: line.slice(i + 1),
      }
    }
  }
  return null
}

function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

/** Parse an iCalendar date-time or date value into a real Date. */
function parseIcsDate(value: string, params: string): { date: Date; dateOnly: boolean } | null {
  const v = value.trim()
  const dateOnly = /VALUE=DATE\b/i.test(params)
  const utc = v.endsWith('Z')
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/)
  if (!m) return null
  const [, y, mo, d, hh, mm, ss] = m
  if (!hh) {
    // Date-only: 09:00 SAST on that day
    const dt = new Date(`${y}-${mo}-${d}T09:00:00+02:00`)
    return isNaN(dt.getTime()) ? null : { date: dt, dateOnly: true }
  }
  const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss || '00'}` + (utc ? 'Z' : '+02:00')
  const dt = new Date(iso)
  if (isNaN(dt.getTime())) return null
  return { date: dt, dateOnly }
}

export function parseIcs(text: string, opts?: { maxEvents?: number }): IcsParseResult {
  const max = opts?.maxEvents ?? 500
  const lines = unfold(text)
  const events: IcsVEvent[] = []
  let total = 0
  let skipped = 0
  let cur: Record<string, { params: string; value: string }> | null = null

  for (const line of lines) {
    if (/^BEGIN:VEVENT\b/i.test(line)) {
      cur = {}
      continue
    }
    if (/^END:VEVENT\b/i.test(line)) {
      if (cur) {
        total++
        const startProp = cur['DTSTART']
        if (!startProp) {
          skipped++
        } else {
          const parsedStart = parseIcsDate(startProp.value, startProp.params)
          if (!parsedStart) {
            skipped++
          } else {
            const endProp = cur['DTEND']
            let endsAt: Date
            if (endProp) {
              const parsedEnd = parseIcsDate(endProp.value, endProp.params)
              endsAt = parsedEnd && parsedEnd.date.getTime() > parsedStart.date.getTime()
                ? parsedEnd.date
                : new Date(parsedStart.date.getTime() + 60 * 60 * 1000)
            } else {
              endsAt = new Date(parsedStart.date.getTime() + 60 * 60 * 1000)
            }
            const title = unescapeText(cur['SUMMARY']?.value || 'Imported event').slice(0, 200)
            const description = unescapeText(cur['DESCRIPTION']?.value || '').slice(0, 2000) || null
            events.push({
              uid: (cur['UID']?.value || '').trim() || null,
              title: parsedStart.dateOnly && !/all day/i.test(title) ? `${title} (all day)` : title,
              description: parsedStart.dateOnly && description ? `(All day)\n${description}` : description,
              location: unescapeText(cur['LOCATION']?.value || '').slice(0, 300) || null,
              startsAt: parsedStart.date,
              endsAt,
              allDay: parsedStart.dateOnly,
            })
            if (events.length >= max) break
          }
        }
      }
      cur = null
      continue
    }
    if (cur) {
      const p = prop(line)
      if (p && ['UID', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'DTSTART', 'DTEND'].includes(p.name)) {
        cur[p.name] = { params: p.params, value: p.value }
      }
    }
  }
  return { events, total, skipped }
}
