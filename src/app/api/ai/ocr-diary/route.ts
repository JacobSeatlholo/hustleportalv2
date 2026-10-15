import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { consumeAiBudget, aiBudgetExceeded } from '@/lib/aiusage'
import { geminiVision, parseJsonLoose } from '@/lib/gemini'

/**
 * POST /api/ai/ocr-diary — "Snap my diary": upload a photo of the user's paper
 * diary / notebook / day-planner and AI reads to-dos and scheduled items out
 * of it, resolving relative dates ("tomorrow", "Friday", "next week Tue")
 * against TODAY in Africa/Johannesburg.
 *
 * Returns structured tasks + events ONLY — the client shows an editable
 * preview and commits through the existing POST /api/tasks and
 * POST /api/appointments endpoints.
 *
 * Body: { imageBase64: string, mimeType?: string }
 * Resp: { ok: true, tasks: [...], events: [...] } | { error }
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_ITEMS = 60

function saToday(): { iso: string; weekday: string } {
  // Africa/Johannesburg is UTC+2 year-round — no DST edge cases.
  const now = new Date(Date.now() + 2 * 3600_000)
  const iso = now.toISOString().slice(0, 10)
  const weekday = new Date(now).toLocaleDateString('en-ZA', { weekday: 'long', timeZone: 'Africa/Johannesburg' })
  return { iso, weekday }
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // AI cost guard: one daily allowance per account, checked BEFORE any
  // Gemini/DeepSeek spend. Generous for humans, a wall for scripts.
  const budget = await consumeAiBudget(userId)
  if (!budget.ok) {
    return NextResponse.json(aiBudgetExceeded(budget), { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg'
  if (!imageBase64) {
    return NextResponse.json({ error: 'Upload a photo of your diary first.' }, { status: 400 })
  }
  const b64 = imageBase64.replace(/^data:[^;]+;base64,/, '')
  if (b64.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'Image too large (max 8MB).' }, { status: 413 })
  }

  const today = saToday()
  const result = await geminiVision(userId, {
    imageBase64: b64,
    mimeType,
    json: true,
    system:
      'You are a precise data-capture assistant for a South African small-business owner. You photograph their paper diary/notebook and turn every entry into a task or an appointment. Transcribe handwriting faithfully — never invent entries. Times are South African (SAST, UTC+2).',
    prompt: `Today is ${today.iso} (${today.weekday}), Africa/Johannesburg (UTC+2).

Read this photo of a diary / notebook / planner page. Split every entry into:
- TASKS: things to do (with or without a time) → {"title", "notes", "dueDate", "priority"}
- EVENTS: things scheduled at a specific date & time (meetings, deliveries, fittings, calls) → {"title", "location", "startsAt", "endsAt", "notes", "clientName"}

Rules:
- title: short imperative or event name, max 80 chars.
- dueDate / startsAt / endsAt: ISO 8601 "YYYY-MM-DD" for tasks, "YYYY-MM-DDTHH:mm:00+02:00" for events. Resolve relative words against today: "tomorrow" = ${today.iso} + 1 day, weekday names = the NEXT occurrence (today is ${today.weekday}).
- If a time is written without a date, assume TODAY; if a date has no time, leave the time off.
- priority: LOW | MEDIUM | HIGH (HIGH for money-deadlines, deliveries, client commitments).
- clientName: only if a person/business is clearly attached to the entry.
- Handwriting you truly cannot read: skip silently. Empty page: return empty arrays.
- Transcribe in the language written (English, isiZulu, Sesotho, Afrikaans, etc).

Reply with ONLY this JSON:
{"tasks":[{"title":"...","notes":"...","dueDate":"YYYY-MM-DD","priority":"MEDIUM"}],
 "events":[{"title":"...","location":"...","startsAt":"YYYY-MM-DDTHH:mm:00+02:00","endsAt":"...","notes":"...","clientName":"..."}]}`,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error.startsWith('NO_KEY') ? 503 : 502 }
    )
  }

  const parsed = parseJsonLoose<{
    tasks?: { title?: string; notes?: string; dueDate?: string; priority?: string }[]
    events?: { title?: string; location?: string; startsAt?: string; endsAt?: string; notes?: string; clientName?: string }[]
  }>(result.text)

  const clean = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : null)
  const isIsoDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  const isIsoDateTime = (s: unknown) =>
    typeof s === 'string' && !Number.isNaN(new Date(s).getTime())

  const tasks = (Array.isArray(parsed?.tasks) ? parsed!.tasks! : [])
    .filter((t) => t && typeof t.title === 'string' && t.title.trim())
    .slice(0, MAX_ITEMS)
    .map((t) => ({
      title: String(t.title).trim().slice(0, 160),
      notes: clean(t.notes, 500),
      dueDate: isIsoDate(t.dueDate) ? t.dueDate! : null,
      priority: ['LOW', 'MEDIUM', 'HIGH'].includes(String(t.priority)) ? String(t.priority) : 'MEDIUM',
    }))

  const events = (Array.isArray(parsed?.events) ? parsed!.events! : [])
    .filter((e) => e && typeof e.title === 'string' && e.title.trim() && isIsoDateTime(e.startsAt))
    .slice(0, MAX_ITEMS)
    .map((e) => {
      const startsAt = new Date(String(e.startsAt))
      let endsAt: string | null = null
      if (isIsoDateTime(e.endsAt)) {
        const end = new Date(String(e.endsAt))
        if (end.getTime() > startsAt.getTime()) endsAt = end.toISOString()
      }
      return {
        title: String(e.title).trim().slice(0, 160),
        location: clean(e.location, 200),
        startsAt: startsAt.toISOString(),
        endsAt,
        notes: clean(e.notes, 500),
        clientName: clean(e.clientName, 120),
      }
    })

  return NextResponse.json({ ok: true, tasks, events, today: today.iso })
}
