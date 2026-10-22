import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/whatsapp'
import { rateLimit } from '@/lib/ratelimit'

/**
 * Per-user WhatsApp Cloud API webhook: /api/whatsapp/webhook/{uid}
 * GET  = Meta subscription handshake (hub.challenge echo against the user's WA_VERIFY_TOKEN)
 * POST = inbound messages → auto-capture sender as a Client (source WHATSAPP_AUTO)
 *        + delivery-status updates for outbound sends. Always answers 200 so Meta
 *        does not retry-storm the endpoint.
 */

interface WaWebhookBody {
  entry?: {
    changes?: {
      value?: {
        contacts?: { profile?: { name?: string }; wa_id?: string }[]
        messages?: { from?: string; id?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[]
        statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[]
      }
    }[]
  }[]
}

async function findClientIdByPhone(userId: string, e164: string): Promise<string | null> {
  const clients = await db.client.findMany({ where: { userId }, select: { id: true, phone: true } })
  for (const c of clients) {
    const n = c.phone ? normalizePhone(c.phone) : null
    if (n?.e164 && n.e164 === e164) return c.id
  }
  return null
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ uid: string }> }) {
  const { uid } = await ctx.params
  const sp = req.nextUrl.searchParams
  const mode = sp.get('hub.mode')
  const token = sp.get('hub.verify_token')
  const challenge = sp.get('hub.challenge') || ''

  const user = await db.user.findUnique({ where: { id: uid } })
  if (!user) return new NextResponse('Unknown webhook', { status: 404 })

  const setting = await db.userSetting.findUnique({ where: { userId_key: { userId: uid, key: 'WA_VERIFY_TOKEN' } } })
  if (mode === 'subscribe' && token && setting?.value && token === setting.value) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse('Verification token mismatch', { status: 403 })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ uid: string }> }) {
  const { uid } = await ctx.params
  try {
    const user = await db.user.findUnique({ where: { id: uid } })
    if (!user) return NextResponse.json({ ok: true }) // swallow, wrong endpoint, don't leak

    // Hardening: the webhook is unauthenticated by design (Meta signs with the
    // app secret, which per-user setups do not carry), so it gets two doors:
    //  1. A per-user rate ceiling, a forged message storm cannot flood the
    //     client list or the push surface.
    //  2. Inbound messages only capture for users who actually connected
    //     WhatsApp (an access token on file). Everyone else: polite 200, zero writes.
    const gate = rateLimit(`wa:webhook:${uid}`, 60, 60 * 1000)
    if (!gate.ok) return NextResponse.json({ ok: true, throttled: true })

    const connected = await db.userSetting.findUnique({ where: { userId_key: { userId: uid, key: 'WA_ACCESS_TOKEN' } } })
    const body = (await req.json().catch(() => ({}))) as WaWebhookBody

    if (!connected?.value) {
      // Delivery-status posts for a number that was never connected: acknowledge
      // and drop. No client rows can be planted through an unused webhook.
      return NextResponse.json({ ok: true })
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value
        if (!value) continue

        const nameByWaId = new Map<string, string>()
        for (const c of value.contacts || []) {
          if (c.wa_id && c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name)
        }

        // inbound messages → auto-capture + log
        for (const msg of value.messages || []) {
          const from = (msg.from || '').replace(/\D/g, '')
          if (!from) continue
          const bodyText =
            msg.text?.body ||
            msg.button?.text ||
            msg.interactive?.button_reply?.title ||
            msg.interactive?.list_reply?.title ||
            (msg.type && msg.type !== 'text' ? `[${msg.type} message]` : '') ||
            ''

          const e164 = normalizePhone(from).e164 || from
          const profileName = nameByWaId.get(from)
          let clientId = await findClientIdByPhone(uid, e164)
          if (!clientId) {
            const norm = normalizePhone(from)
            const created = await db.client.create({
              data: {
                userId: uid,
                name: profileName || norm.display || `WhatsApp ${from.slice(-4)}`,
                phone: norm.valid ? norm.display : from,
                source: 'WHATSAPP_AUTO',
                notes: 'Auto-captured, messaged your WhatsApp Business number',
              },
            })
            clientId = created.id
          }

          // dedupe on Meta message id (Meta retries webhooks)
          const existing = msg.id
            ? await db.waMessage.findFirst({ where: { userId: uid, waMessageId: msg.id } })
            : null
          if (!existing) {
            await db.waMessage.create({
              data: {
                userId: uid,
                clientId,
                phone: from,
                direction: 'IN',
                body: bodyText,
                status: 'RECEIVED',
                waMessageId: msg.id || null,
              },
            })
          }
        }

        // delivery statuses for outbound sends
        for (const st of value.statuses || []) {
          if (!st.id || !st.status) continue
          const row = await db.waMessage.findFirst({ where: { userId: uid, waMessageId: st.id, direction: 'OUT' } })
          if (row) {
            const failed = st.status === 'failed'
            await db.waMessage.update({
              where: { id: row.id },
              data: { status: failed ? 'FAILED' : st.status.toUpperCase(), error: failed ? st.errors?.[0]?.message || st.errors?.[0]?.title || 'failed' : null },
            })
          }
        }
      }
    }
    return NextResponse.json({ ok: true })
  } catch {
    // never fail Meta, retries would duplicate work
    return NextResponse.json({ ok: true })
  }
}
