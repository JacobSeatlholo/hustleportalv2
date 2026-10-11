import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'
import { parseContactList, normalizePhone, MAX_IMPORT_BATCH } from '@/lib/whatsapp'

/**
 * POST /api/whatsapp/import — 1-click bulk import of a WhatsApp contact list.
 * Body: { text: string } (pasted list, group-participant copy, vCard or CSV —
 * auto-detected) → normalized SA numbers, batch- and CRM-deduped, imported as
 * Clients with source=WHATSAPP/VCF.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) {
    return NextResponse.json({ error: 'Paste your contact list or upload a file first.' }, { status: 400 })
  }

  const parsed = parseContactList(text)
  if (parsed.length === 0) {
    return NextResponse.json(
      { error: 'No phone numbers found. Copy the list with the numbers included, or upload a .vcf / .csv file.' },
      { status: 400 }
    )
  }

  // Normalize + bucket
  const ok: { name: string; phone: string; email: string | null; e164: string }[] = []
  const invalid: { raw: string; reason: string }[] = []
  for (const c of parsed) {
    if (ok.length >= MAX_IMPORT_BATCH) break
    const norm = normalizePhone(c.phone)
    if (!norm.valid) {
      invalid.push({ raw: c.raw.slice(0, 80), reason: norm.invalidReason || 'invalid number' })
      continue
    }
    ok.push({
      name: c.name?.trim() || norm.display,
      phone: norm.display,
      email: c.email?.trim() || null,
      e164: norm.e164!,
    })
  }

  // Dedupe against existing CRM (phones stored in any format)
  const existing = await db.client.findMany({ where: { userId }, select: { phone: true } })
  const existingSet = new Set<string>()
  for (const e of existing) {
    const n = e.phone ? normalizePhone(e.phone) : null
    if (n?.e164) existingSet.add(n.e164)
  }

  const toCreate = ok.filter((c) => {
    if (existingSet.has(c.e164)) return false
    existingSet.add(c.e164) // also dedupes inside the batch
    return true
  })

  const source = body.source === 'VCF' || /BEGIN:VCARD/i.test(text) ? 'VCF' : 'WHATSAPP'
  if (toCreate.length > 0) {
    await db.client.createMany({
      data: toCreate.map((c) => ({
        userId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        source,
        notes: source === 'WHATSAPP' ? 'Imported from WhatsApp contact list' : 'Imported from vCard',
      })),
    })
    await bumpChallenge(userId, 'add_client')
  }

  return NextResponse.json({
    imported: toCreate.length,
    duplicates: ok.length - toCreate.length,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, 15),
    detected: parsed.length,
  })
}
