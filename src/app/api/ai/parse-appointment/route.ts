import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'

export const maxDuration = 60

// POST /api/ai/parse-appointment { transcript } → structured appointment fields
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const transcript = String(body.transcript || '').trim()
  if (!transcript) return NextResponse.json({ error: 'Say or type the appointment details first.' }, { status: 400 })

  const now = new Date()
  const result = await geminiGenerate(userId, {
    system:
      'You extract appointment details from natural speech for a South African small-business owner. ' +
      'Return ONLY a JSON object with keys: title (string), clientName (string or null), ' +
      'dateISO (ISO 8601 date-time with Africa/Johannesburg offset, resolved from phrases like "tomorrow 2pm" relative to now), ' +
      'durationMins (number, default 60), notes (string or null). No commentary.',
    prompt: `Current date & time: ${now.toISOString()} (SAST = UTC+2).\nTranscript: "${transcript}"`,
    json: true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const parsed = parseJsonLoose<{
    title?: string
    clientName?: string | null
    dateISO?: string
    durationMins?: number
    notes?: string | null
  }>(result.text)
  if (!parsed?.title || !parsed.dateISO) {
    return NextResponse.json({ error: 'Could not read a date & time from that — try mentioning when it happens.' }, { status: 400 })
  }
  const startsAt = new Date(parsed.dateISO)
  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: 'The date parsed was invalid — try again.' }, { status: 400 })
  }
  const durationMins = Number(parsed.durationMins) > 0 ? Number(parsed.durationMins) : 60
  return NextResponse.json({
    parsed: {
      title: parsed.title,
      clientName: parsed.clientName || null,
      notes: parsed.notes || null,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + durationMins * 60000).toISOString(),
      durationMins,
    },
  })
}
