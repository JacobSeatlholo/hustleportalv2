import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

const GRAPH = 'https://graph.facebook.com/v21.0'
const WA_KEYS = ['WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN', 'WA_VERIFY_TOKEN', 'WA_DISPLAY_NUMBER', 'WA_WABA_ID'] as const

async function getSetting(userId: string, key: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({ where: { userId_key: { userId, key } } })
  return row?.value ?? null
}

async function setSetting(userId: string, key: string, value: string) {
  await db.userSetting.upsert({
    where: { userId_key: { userId, key } },
    update: { value },
    create: { userId, key, value },
  })
}

function mask(v: string | null | undefined): string | null {
  if (!v) return null
  if (v.length <= 6) return '••••'
  return v.slice(0, 3) + '••••' + v.slice(-4)
}

/** GET /api/whatsapp/connect, connection status for the current user. */
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [phoneNumberId, accessToken, verifyToken, displayNumber] = await Promise.all([
    getSetting(userId, 'WA_PHONE_NUMBER_ID'),
    getSetting(userId, 'WA_ACCESS_TOKEN'),
    getSetting(userId, 'WA_VERIFY_TOKEN'),
    getSetting(userId, 'WA_DISPLAY_NUMBER'),
  ])
  return NextResponse.json({
    connected: Boolean(phoneNumberId && accessToken),
    phoneNumberId: mask(phoneNumberId),
    displayNumber: displayNumber || null,
    verifyToken: verifyToken || null,
    webhookPath: `/api/whatsapp/webhook/${userId}`,
  })
}

/**
 * POST /api/whatsapp/connect { phoneNumberId, accessToken }
 * Saves credentials, then live-verifies against Meta Graph API before marking
 * the connection as good. Auto-generates the webhook verify token on first use.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const phoneNumberId = String(body.phoneNumberId || '').trim()
  const accessToken = String(body.accessToken || '').trim()

  if (!/^\d{5,}$/.test(phoneNumberId)) {
    return NextResponse.json({ error: 'Phone Number ID looks wrong, it is a long numeric ID from your Meta app dashboard.' }, { status: 400 })
  }
  if (accessToken.length < 15) {
    return NextResponse.json({ error: 'Access token looks too short, paste the full System User token from Meta.' }, { status: 400 })
  }

  let verifyToken = await getSetting(userId, 'WA_VERIFY_TOKEN')
  if (!verifyToken) {
    verifyToken = 'hpwa_' + randomBytes(12).toString('hex')
    await setSetting(userId, 'WA_VERIFY_TOKEN', verifyToken)
  }

  // Live verification against Meta, never mark connected on a guess.
  let displayNumber: string | null = null
  try {
    const res = await fetch(`${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name&access_token=${encodeURIComponent(accessToken)}`, {
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.error) {
      const msg = data?.error?.message || `Meta rejected the credentials (HTTP ${res.status}).`
      return NextResponse.json({ error: `Verification failed: ${msg}` }, { status: 400 })
    }
    displayNumber = data.display_phone_number || null
  } catch {
    return NextResponse.json({ error: 'Could not reach Meta Graph API to verify, check your network and try again.' }, { status: 502 })
  }

  await setSetting(userId, 'WA_PHONE_NUMBER_ID', phoneNumberId)
  await setSetting(userId, 'WA_ACCESS_TOKEN', accessToken)
  if (displayNumber) await setSetting(userId, 'WA_DISPLAY_NUMBER', displayNumber)

  return NextResponse.json({
    connected: true,
    displayNumber,
    verifyToken,
    webhookPath: `/api/whatsapp/webhook/${userId}`,
  })
}

/** DELETE /api/whatsapp/connect, disconnect WhatsApp Business. */
export async function DELETE() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await db.userSetting.deleteMany({ where: { userId, key: { in: [...WA_KEYS] } } })
  return NextResponse.json({ ok: true })
}
