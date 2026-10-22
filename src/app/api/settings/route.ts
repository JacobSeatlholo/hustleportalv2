import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { validateGeminiKey } from '@/lib/gemini'
import { validateDeepseekKey } from '@/lib/deepseek'
import { validateZaiKey } from '@/lib/zai'

const ALLOWED_KEYS = [
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ZAI_API_KEY',
  'EXPLEE_API_KEY',
  'GCAL_OAUTH_TOKEN',
  'WA_PHONE_NUMBER_ID',
  'WA_ACCESS_TOKEN',
  'WA_VERIFY_TOKEN',
  'WA_DISPLAY_NUMBER',
  'INVOICE_BANK',
  'NAV_ORDER', // JSON ViewKey[], the user's personal sidebar menu order
  'MODULES', // JSON string[], disabled module keys (the tailored workspace)
  'ICS_FEED_URL', // read-only calendar feed for the Calendar sync button
]

const SECRET_KEYS = new Set(['GMAIL_APP_PASSWORD', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'ZAI_API_KEY', 'EXPLEE_API_KEY', 'GCAL_OAUTH_TOKEN', 'WA_ACCESS_TOKEN', 'WA_VERIFY_TOKEN'])

function mask(v: string) {
  if (v.length <= 4) return '••••'
  return '••••' + v.slice(-4)
}

// GET /api/settings → integration settings (values masked if secret)
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await db.userSetting.findMany({ where: { userId } })
  const settings = rows.map((r) => ({
    key: r.key,
    value: SECRET_KEYS.has(r.key) ? mask(r.value) : r.value,
    configured: r.value.length > 0,
    updatedAt: r.updatedAt,
  }))
  return NextResponse.json({ settings })
}

// PUT /api/settings { key, value } → upsert one integration setting
// Saving an EMPTY value clears the setting entirely (no junk rows).
export async function PUT(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const key = String(body.key || '')
  // Trim on store: a pasted key with a trailing newline or space would otherwise
  // ride into every header and query param until someone re-saves it.
  const value = String(body.value ?? '').trim()
  if (!ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: 'Unknown setting key.' }, { status: 400 })
  }
  if (!value.trim()) {
    await db.userSetting.deleteMany({ where: { userId, key } })
    return NextResponse.json({
      setting: { key, value: '', configured: false },
      removed: true,
    })
  }
  const setting = await db.userSetting.upsert({
    where: { userId_key: { userId, key } },
    update: { value },
    create: { userId, key, value },
  })

  // A pasted Gemini key is probed against Google the moment it's saved, a
  // 403-blocked key is flagged HERE, not three screens later when a scan fails.
  // The key is still stored: the user may enable the API on Google's side and the
  // SAME key starts working, and the platform chain covers the gap meanwhile.
  let validation: { ok: boolean; message: string; status?: string; balanceUsd?: number | null } | null = null
  if (key === 'GEMINI_API_KEY') {
    validation = await validateGeminiKey(value)
  }
  // A pasted DeepSeek key is probed against DeepSeek the moment it is saved:
  // verdict plus the REAL credit balance from DeepSeek's own meter.
  if (key === 'DEEPSEEK_API_KEY') {
    validation = await validateDeepseekKey(value)
  }
  // A pasted z.ai key is probed with a real micro generation the moment it is
  // saved: a rejected key is flagged HERE, not three screens later when a scan fails.
  if (key === 'ZAI_API_KEY') {
    validation = await validateZaiKey(value)
  }

  return NextResponse.json({
    setting: {
      key: setting.key,
      value: SECRET_KEYS.has(key) ? mask(value) : value,
      configured: value.length > 0,
    },
    validation,
  })
}

// DELETE /api/settings?key= → clear a stored credential
export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = new URL(req.url).searchParams.get('key') || ''
  if (!ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: 'Unknown setting key.' }, { status: 400 })
  }
  await db.userSetting.deleteMany({ where: { userId, key } })
  return NextResponse.json({ ok: true })
}
