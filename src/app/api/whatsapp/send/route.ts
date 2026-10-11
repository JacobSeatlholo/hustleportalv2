import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { normalizePhone } from '@/lib/whatsapp'

const GRAPH = 'https://graph.facebook.com/v21.0'
const MAX_RECIPIENTS = 100

/**
 * POST /api/whatsapp/send { clientIds: string[], message: string }
 * Sends a WhatsApp text via the user's connected Cloud API number and logs
 * every attempt (WaMessage). Surfaces Meta's 24-hour window rule honestly.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const clientIds: string[] = Array.isArray(body.clientIds) ? body.clientIds.slice(0, MAX_RECIPIENTS) : []
  const message = String(body.message || '').trim()
  if (!message) return NextResponse.json({ error: 'Write the message you want to send.' }, { status: 400 })
  if (clientIds.length === 0) return NextResponse.json({ error: 'Select at least one client.' }, { status: 400 })

  const [phoneNumberId, accessToken] = await Promise.all([
    db.userSetting.findUnique({ where: { userId_key: { userId, key: 'WA_PHONE_NUMBER_ID' } } }),
    db.userSetting.findUnique({ where: { userId_key: { userId, key: 'WA_ACCESS_TOKEN' } } }),
  ])
  if (!phoneNumberId?.value || !accessToken?.value) {
    return NextResponse.json(
      { error: 'Connect your WhatsApp Business number in Integrations first — then you can send from HustlePortal.' },
      { status: 400 }
    )
  }

  const clients = await db.client.findMany({ where: { userId, id: { in: clientIds } } })
  let sent = 0
  const failed: { name: string; reason: string }[] = []

  for (const client of clients) {
    const norm = client.phone ? normalizePhone(client.phone) : null
    if (!norm?.e164) {
      failed.push({ name: client.name, reason: 'No valid WhatsApp number on the profile' })
      continue
    }
    try {
      const res = await fetch(`${GRAPH}/${phoneNumberId.value}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken.value}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: norm.e164,
          type: 'text',
          text: { preview_url: true, body: message },
        }),
        signal: AbortSignal.timeout(20000),
      })
      const data = await res.json().catch(() => ({}))
      const wamid = data?.messages?.[0]?.id || null
      if (!res.ok || data?.error) {
        const raw = data?.error?.message || `HTTP ${res.status}`
        const reason = /131047|131026|re-engagement/i.test(raw)
          ? 'WhatsApp only allows business-initiated chats within 24h of the customer messaging you (or via an approved template).'
          : raw
        failed.push({ name: client.name, reason })
        await db.waMessage.create({
          data: { userId, clientId: client.id, phone: norm.e164, direction: 'OUT', body: message, status: 'FAILED', error: raw.slice(0, 500) },
        })
        continue
      }
      sent++
      await db.waMessage.create({
        data: { userId, clientId: client.id, phone: norm.e164, direction: 'OUT', body: message, status: 'SENT', waMessageId: wamid },
      })
    } catch {
      failed.push({ name: client.name, reason: 'Could not reach Meta — try again' })
      await db.waMessage.create({
        data: { userId, clientId: client.id, phone: norm.e164, direction: 'OUT', body: message, status: 'FAILED', error: 'network' },
      })
    }
  }

  return NextResponse.json({ sent, failedCount: failed.length, failed: failed.slice(0, 15) })
}
