import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { setConfig, getConfig, CONFIG_KEYS } from '@/lib/config'
import { getYocoSecretKey, registerYocoWebhook, getYocoWebhookSecret, getYocoSecretKeyStatus, YocoError } from '@/lib/yoco'

/** GET /api/webhooks/yoco/register — webhook config status (admin). */
export async function GET() {
  const me = await getUserId()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await db.user.findUnique({ where: { id: me }, select: { role: true } })
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const secret = await getYocoWebhookSecret()
  const webhookMode = await getConfig(CONFIG_KEYS.YOCO_WEBHOOK_MODE)
  return NextResponse.json({
    ok: true,
    configured: Boolean(secret),
    source: process.env.YOCO_WEBHOOK_SECRET ? 'env' : secret ? 'config' : 'none',
    webhookMode: webhookMode || null,
    secretKeySet: Boolean(getYocoSecretKey()),
  })
}

/**
 * POST /api/webhooks/yoco/register — register this app's webhook endpoint with Yoco
 * and auto-store the returned signing secret (shown only once by Yoco).
 * Body: { url?: string } — defaults to this deployment's /api/webhooks/yoco.
 */
export async function POST(req: NextRequest) {
  const me = await getUserId()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await db.user.findUnique({ where: { id: me }, select: { role: true } })
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = getYocoSecretKeyStatus()
  const secretKey = getYocoSecretKey()
  if (!secretKey) {
    return NextResponse.json(
      { error: status.present
          ? 'YOCO_SECRET_KEY holds a webhook signing secret (whsec_...). That one verifies Yoco messages; the checkout gateway needs the secret key from the Yoco Portal instead.'
          : 'YOCO_SECRET_KEY is not set. Add the secret key from the Yoco Portal in Vercel → Settings → Environment Variables first, then redeploy.' },
      { status: 400 },
    )
  }

  const { url } = await req.json().catch(() => ({ url: undefined }))
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  const webhookUrl = (url as string)?.trim() || `${proto}://${host}/api/webhooks/yoco`

  try {
    const webhook = await registerYocoWebhook(secretKey, webhookUrl)
    await setConfig(CONFIG_KEYS.YOCO_WEBHOOK_SECRET, webhook.secret)
    // Remember which key world this webhook speaks for: a test era webhook
    // never confirms live payments, so the dashboard compares modes honestly.
    await setConfig(CONFIG_KEYS.YOCO_WEBHOOK_MODE, webhook.mode === 'live' ? 'live' : 'test')
    return NextResponse.json({
      ok: true,
      webhook: { id: webhook.id, mode: webhook.mode, name: webhook.name, url: webhook.url },
      secretStored: true,
    })
  } catch (e) {
    const status = e instanceof YocoError ? e.status : 500
    const msg = e instanceof Error ? e.message : 'Webhook registration failed'
    return NextResponse.json({ error: msg }, { status })
  }
}
