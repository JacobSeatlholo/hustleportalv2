import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

const ALLOWED_KEYS = [
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'GEMINI_API_KEY',
  'EXPLEE_API_KEY',
  'GCAL_OAUTH_TOKEN',
]

const SECRET_KEYS = new Set(['GMAIL_APP_PASSWORD', 'GEMINI_API_KEY', 'EXPLEE_API_KEY', 'GCAL_OAUTH_TOKEN'])

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
export async function PUT(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const key = String(body.key || '')
  const value = String(body.value ?? '')
  if (!ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: 'Unknown setting key.' }, { status: 400 })
  }
  const setting = await db.userSetting.upsert({
    where: { userId_key: { userId, key } },
    update: { value },
    create: { userId, key, value },
  })
  return NextResponse.json({
    setting: {
      key: setting.key,
      value: SECRET_KEYS.has(key) ? mask(value) : value,
      configured: value.length > 0,
    },
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
