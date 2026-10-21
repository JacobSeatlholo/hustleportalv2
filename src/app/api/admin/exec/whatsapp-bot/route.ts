import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { ensureVerifyToken } from '@/lib/whatsapp-bot'

export const maxDuration = 30

/**
 * Hustle Bot credentials — the exec desk's window into the shared WhatsApp bot.
 *
 * GET  = readiness report: the webhook URL, the verify token (self-generated,
 *        paste it into the Meta app dashboard), what is configured, and only
 *        the TAIL of the access token. The full token never leaves the store.
 * POST = store credentials into PlatformConfig (same home as the VAPID keys).
 *        Additive upserts only: send a field only when you want it changed.
 *
 * GUARD: the standard exec gate. A regular member session hits the same 403
 * wall as every other exec surface.
 */

const SITE = 'https://www.hustleportal.online'

async function readConfig(): Promise<Record<string, string | undefined>> {
  const rows = await db.platformConfig.findMany({
    where: { key: { in: ['WA_BOT_TOKEN', 'WA_BOT_PHONE_ID', 'WA_BOT_APP_SECRET', 'WA_BOT_ENABLED', 'WA_BOT_VERIFY_TOKEN'] } },
  })
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  // The verify token self-generates here, so the exec report always shows the
  // value the Meta dashboard needs before a single webhook call has happened.
  const verifyToken = await ensureVerifyToken()
  const c = await readConfig()
  const token = c.WA_BOT_TOKEN || ''
  return NextResponse.json({
    webhookUrl: `${SITE}/api/whatsapp/bot`,
    verifyToken,
    enabled: c.WA_BOT_ENABLED !== '0',
    configured: {
      token: Boolean(token),
      phoneNumberId: Boolean(c.WA_BOT_PHONE_ID),
      appSecret: Boolean(c.WA_BOT_APP_SECRET),
    },
    tokenTail: token ? token.slice(-6) : null,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const upserts: { key: string; value: string }[] = []
  const fields: [string, string][] = [
    ['token', 'WA_BOT_TOKEN'],
    ['phoneNumberId', 'WA_BOT_PHONE_ID'],
    ['appSecret', 'WA_BOT_APP_SECRET'],
  ]
  for (const [field, key] of fields) {
    const v = typeof body[field] === 'string' ? (body[field] as string).trim() : ''
    if (v) upserts.push({ key, value: v })
  }
  if (typeof body.enabled === 'boolean') {
    upserts.push({ key: 'WA_BOT_ENABLED', value: body.enabled ? '1' : '0' })
  }

  if (!upserts.length) {
    return NextResponse.json(
      { error: 'Nothing to store. Send token, phoneNumberId, appSecret or enabled.' },
      { status: 400 }
    )
  }

  for (const u of upserts) {
    await db.platformConfig.upsert({
      where: { key: u.key },
      update: { value: u.value },
      create: { key: u.key, value: u.value },
    })
  }

  return NextResponse.json({ ok: true, stored: upserts.map((u) => u.key) })
}
