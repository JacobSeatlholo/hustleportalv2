/**
 * Booking slot engine — the pure brain behind /book/<slug> pages.
 *
 * The owner publishes weekly availability as wall-clock times (SAST, +02:00,
 * no DST — the one timezone the platform's home market lives in). A guest
 * opens the page and this engine turns that availability into concrete,
 * actually-free slots for the next N days: inside a published window, clear
 * of everything already on the owner's calendar (appointments, bookings,
 * imported ICS events), with a lead time so a doctor is never surprised by
 * a booking that starts in ten minutes.
 *
 * Pure functions, no db, no env — same unit-testable convention as
 * campaignhtml.ts and mailthemes.ts.
 */

export const SAST_OFFSET_MIN = 120 // South Africa Standard Time, no DST

export interface AvailWindow {
  s: string // "09:00" wall time, SAST
  e: string // "13:00"
}

export type WeeklyAvail = Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', AvailWindow[]>>

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Whatever is stored in BookingLink.avail, turn it into a safe weekly map.
 * Junk in, honest empty availability out — a broken avail string must never
 * break the public page, it just shows nothing bookable.
 */
export function parseAvail(raw: unknown): WeeklyAvail {
  let data: unknown
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return {}
    }
  } else {
    data = raw
  }
  if (!data || typeof data !== 'object') return {}
  const out: WeeklyAvail = {}
  for (let d = 0; d <= 6; d++) {
    const windows = (data as Record<string, unknown>)[String(d)]
    if (!Array.isArray(windows)) continue
    const clean: AvailWindow[] = []
    for (const w of windows.slice(0, 4)) {
      const s = String((w as AvailWindow)?.s || '')
      const e = String((w as AvailWindow)?.e || '')
      if (TIME_RE.test(s) && TIME_RE.test(e) && s < e) clean.push({ s, e })
    }
    if (clean.length > 0) out[String(d) as keyof WeeklyAvail] = clean
  }
  return out
}

/** The SAST wall clock of a moment, as { y, m, d, hh, mm, dow } (dow 0=Sun). */
export function sastParts(t: Date): { y: number; m: number; d: number; hh: number; mm: number; dow: number } {
  const s = new Date(t.getTime() + SAST_OFFSET_MIN * 60_000)
  return {
    y: s.getUTCFullYear(),
    m: s.getUTCMonth() + 1,
    d: s.getUTCDate(),
    hh: s.getUTCHours(),
    mm: s.getUTCMinutes(),
    dow: s.getUTCDay(),
  }
}

/** YYYY-MM-DD of a moment's SAST calendar day. */
export function sastDateKey(t: Date): string {
  const p = sastParts(t)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** A SAST wall time on a calendar day, as the real UTC moment it stands for. */
function wallToUtc(dateKey: string, hhmm: string): Date {
  return new Date(`${dateKey}T${hhmm}:00+02:00`)
}

function overlaps(aS: Date, aE: Date, bS: Date, bE: Date): boolean {
  return aS < bE && aE > bS
}

export interface BusyBlock {
  start: Date
  end: Date
}

export interface SlotOption {
  start: string // ISO
  end: string // ISO
  label: string // "09:30" SAST wall time
}

export interface SlotDay {
  date: string // YYYY-MM-DD (SAST calendar day)
  label: string // "Mon 11 Nov" for the day chip
  slots: SlotOption[]
}

/**
 * The free slots for the next `days` days. Everything already on the owner's
 * calendar (busy) blocks the slot; `bufferMin` pads both sides of every slot
 * so back-to-back is a choice, never an accident.
 */
export function computeSlots(opts: {
  avail: WeeklyAvail
  durationMin: number
  bufferMin?: number
  busy?: BusyBlock[]
  from?: Date
  days?: number
  stepMin?: number
  leadMin?: number
}): SlotDay[] {
  const days = Math.max(1, Math.min(opts.days ?? 14, 31))
  const stepMin = Math.max(5, opts.stepMin ?? 30)
  const leadMin = Math.max(0, opts.leadMin ?? 120)
  const bufferMin = Math.max(0, opts.bufferMin ?? 0)
  const from = opts.from ?? new Date()
  const earliest = new Date(from.getTime() + leadMin * 60_000)
  const busy = (opts.busy ?? []).map((b) => ({
    start: new Date(b.start.getTime() - bufferMin * 60_000),
    end: new Date(b.end.getTime() + bufferMin * 60_000),
  }))

  const out: SlotDay[] = []
  for (let i = 0; i < days; i++) {
    const dayT = new Date(from.getTime() + i * 86_400_000)
    const dateKey = sastDateKey(dayT)
    const dow = sastParts(dayT).dow
    const windows = opts.avail[String(dow)] || []
    const slots: SlotOption[] = []
    for (const w of windows) {
      const winS = wallToUtc(dateKey, w.s)
      const winE = wallToUtc(dateKey, w.e)
      // Align the first candidate onto the step grid (00/30 by default).
      const first = new Date(Math.ceil(winS.getTime() / (stepMin * 60_000)) * stepMin * 60_000)
      for (let t = first; t < winE; t = new Date(t.getTime() + stepMin * 60_000)) {
        const end = new Date(t.getTime() + opts.durationMin * 60_000)
        if (end > winE) break
        if (t < earliest) continue
        const hit = busy.some((b) => overlaps(t, end, b.start, b.end))
        if (hit) continue
        const p = sastParts(t)
        slots.push({
          start: t.toISOString(),
          end: end.toISOString(),
          label: `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`,
        })
      }
    }
    out.push({
      date: dateKey,
      label: new Intl.DateTimeFormat('en-ZA', {
        timeZone: 'Africa/Johannesburg',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(dayT),
      slots,
    })
  }
  return out
}

/** Human day+time for confirmations: "Mon 11 Nov, 09:30". */
export function humanSlot(startIso: string): string {
  const t = new Date(startIso)
  const day = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(t)
  const p = sastParts(t)
  return `${day}, ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`
}
