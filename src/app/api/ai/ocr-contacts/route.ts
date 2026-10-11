import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { geminiVision, parseJsonLoose } from '@/lib/gemini'

/**
 * POST /api/ai/ocr-contacts — "Scan my WhatsApp": upload a screenshot of the
 * user's WhatsApp chats list / contact info pages / phone contact book and AI
 * reads the contacts out of it.
 *
 * Returns structured contacts ONLY — the client feeds them into the existing
 * 1-click import preview (/api/whatsapp/import commit path), so the user
 * reviews everything before anything touches the CRM.
 *
 * Body: { imageBase64: string, mimeType?: string }
 * Resp: { ok: true, contacts: [{ name, phone, email?, note? }] } | { error }
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8MB — generous for phone screenshots
const MAX_CONTACTS = 200

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg'
  if (!imageBase64) {
    return NextResponse.json({ error: 'Upload a screenshot first.' }, { status: 400 })
  }
  const b64 = imageBase64.replace(/^data:[^;]+;base64,/, '')
  if (b64.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: 'Image too large (max 8MB). Tip: screenshot only the relevant part of the list.' },
      { status: 413 }
    )
  }

  const result = await geminiVision(userId, {
    imageBase64: b64,
    mimeType,
    json: true,
    system:
      'You are a precise data-capture assistant for a South African small-business owner. You read phone screenshots and extract contact entries EXACTLY as shown — never invent names or numbers. South African numbers look like 0821234567, +27 82 123 4567 or 27821234567.',
    prompt: `Read this screenshot (WhatsApp chat list, contact info page, call log or address book). Extract every visible contact entry that has a phone number.

Rules:
- name: the contact/business name as displayed (use the phone number as name if no name is shown).
- phone: the number EXACTLY as displayed, digits and + only.
- email: only if clearly shown, else omit.
- note: only if there is a business category, status/about or caption worth keeping (max 60 chars), else omit.
- Skip entries with no phone number (e.g. "My status", Settings rows).
- Do not merge or guess. If the image is not readable as a contact list, return {"contacts":[]}.

Reply with ONLY this JSON: {"contacts":[{"name":"...","phone":"...","email":"...","note":"..."}]}`,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error.startsWith('NO_KEY') ? 503 : 502 }
    )
  }

  const parsed = parseJsonLoose<{ contacts?: { name?: string; phone?: string; email?: string; note?: string }[] }>(
    result.text
  )
  const raw = Array.isArray(parsed?.contacts) ? parsed!.contacts! : []
  const contacts = raw
    .filter((c) => c && typeof c.phone === 'string' && /[0-9]{7,}/.test(c.phone.replace(/[^0-9+]/g, '')))
    .slice(0, MAX_CONTACTS)
    .map((c) => ({
      name: String(c.name || '').trim().slice(0, 120),
      phone: String(c.phone).replace(/[^0-9+]/g, ''),
      email: typeof c.email === 'string' && c.email.includes('@') ? c.email.trim().slice(0, 160) : null,
      note: typeof c.note === 'string' ? c.note.trim().slice(0, 120) : null,
    }))

  return NextResponse.json({ ok: true, contacts })
}
