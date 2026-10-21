import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { getBotConfig, verifySignature, handleBotMessage, type BotIncoming } from '@/lib/whatsapp-bot'

export const maxDuration = 60

/**
 * Hustle Bot webhook — the ONE shared WhatsApp number for the whole platform.
 *   GET  = Meta subscription handshake (hub.challenge against WA_BOT_VERIFY_TOKEN,
 *          which self-generates in PlatformConfig on first use, like the VAPID keys)
 *   POST = inbound messages + delivery statuses, processed AFTER the 200 so Meta
 *          never retry-storms the endpoint. Always answers 200.
 *
 * Config lives in PlatformConfig (WA_BOT_TOKEN, WA_BOT_PHONE_ID, WA_BOT_APP_SECRET,
 * WA_BOT_ENABLED) — set through /api/admin/exec/whatsapp-bot. While the token is
 * absent the webhook answers politely and acts on nothing.
 */

interface WaWebhookBody {
  entry?: {
    changes?: {
      value?: {
        contacts?: { profile?: { name?: string }; wa_id?: string }[]
        messages?: {
          from?: string
          id?: string
          type?: string
          text?: { body?: string }
          button?: { text?: string }
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
        }[]
        statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[]
      }
    }[]
  }[]
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const mode = sp.get('hub.mode')
  const token = sp.get('hub.verify_token')
  const challenge = sp.get('hub.challenge') || ''
  const conf = await getBotConfig()
  if (mode === 'subscribe' && token && token === conf.verifyToken) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse('Verification token mismatch', { status: 403 })
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    const conf = await getBotConfig()

    // Meta signs the raw body with the app secret. Enforced the moment a
    // secret is on file; before that the handshake token is the gatekeeper.
    if (conf.appSecret) {
      const sig = req.headers.get('x-hub-signature-256')
      if (!sig || !verifySignature(raw, sig, conf.appSecret)) {
        return new NextResponse('Bad signature', { status: 403 })
      }
    }

    // Soft endpoint-wide ceiling: a forged flood cannot burn Graph quota.
    const epGate = rateLimit('wa:bot:endpoint', 240, 60_000)
    if (!epGate.ok) return NextResponse.json({ ok: true, throttled: true })

    const body = JSON.parse(raw || '{}') as WaWebhookBody
    const inbound: BotIncoming[] = []
    const statuses: { id: string; status: string; error?: string }[] = []

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value
        if (!value) continue
        const nameByWaId = new Map<string, string>()
        for (const c of value.contacts || []) {
          if (c.wa_id && c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name)
        }
        for (const m of value.messages || []) {
          const text =
            m.text?.body ||
            m.button?.text ||
            m.interactive?.button_reply?.title ||
            m.interactive?.list_reply?.title ||
            (m.type && m.type !== 'text' ? `[${m.type} message]` : '') ||
            ''
          inbound.push({
            from: (m.from || '').replace(/\D/g, ''),
            msgId: m.id,
            text,
            profileName: nameByWaId.get(m.from || ''),
          })
        }
        for (const st of value.statuses || []) {
          if (st.id && st.status) {
            statuses.push({ id: st.id, status: st.status, error: st.errors?.[0]?.message || st.errors?.[0]?.title })
          }
        }
      }
    }

    if (inbound.length || statuses.length) {
      after(async () => {
        for (const st of statuses) {
          try {
            const row = await db.waMessage.findFirst({ where: { waMessageId: st.id, direction: 'OUT' } })
            if (row) {
              const failed = st.status === 'failed'
              await db.waMessage.update({
                where: { id: row.id },
                data: {
                  status: failed ? 'FAILED' : st.status.toUpperCase(),
                  error: failed ? st.error || 'failed' : null,
                },
              })
            }
          } catch {
            // never break the loop on a status bookkeeping miss
          }
        }
        for (const m of inbound) {
          try {
            await handleBotMessage(m)
          } catch (e) {
            console.error('[wa-bot] message failed', e)
          }
        }
      })
    }

    return NextResponse.json({ ok: true })
  } catch {
    // never fail Meta — retries would duplicate work
    return NextResponse.json({ ok: true })
  }
}
