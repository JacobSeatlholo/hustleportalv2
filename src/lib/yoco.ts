import crypto from 'crypto'
import { getConfig, CONFIG_KEYS } from '@/lib/config'

/**
 * Yoco Checkout API integration.
 * Docs: https://developer.yoco.com/docs/checkout-api
 *
 * Auth model (one key does everything):
 *  - YOCO_SECRET_KEY (sk_test_... / sk_live_...)  -> server-side checkout creation + webhook registration
 *  - YOCO_WEBHOOK_SECRET (whsec_...)              -> verifies inbound webhook signatures (from registering the webhook)
 *
 * The webhook secret is returned once when the webhook is registered. We store it
 * automatically in PlatformConfig; the env var takes precedence if set.
 */

const CHECKOUT_API = 'https://payments.yoco.com/api'

/**
 * The secret key from Vercel. Yoco itself is the validator: whatever the owner
 * pasted is sent as the Bearer key and Yoco accepts or rejects it. We only
 * filter out values that are clearly the wrong secret (the webhook signing
 * secret starts with whsec_ and would never authenticate a checkout).
 */
export function getYocoSecretKey(): string | null {
  const key = process.env.YOCO_SECRET_KEY
  if (!key) return null
  const trimmed = key.trim()
  if (!trimmed || trimmed.startsWith('whsec_')) return null
  return trimmed
}

/** Distinguish "env var missing" from "env var set but the wrong secret". */
export function getYocoSecretKeyStatus(): { present: boolean; validFormat: boolean } {
  const raw = process.env.YOCO_SECRET_KEY?.trim()
  return { present: Boolean(raw), validFormat: Boolean(raw && !raw.startsWith('whsec_')) }
}

/**
 * Which Yoco world a key belongs to, from its own text: live keys carry
 * "live", test keys carry "test". Yoco is the final word (the webhook
 * registration response names the mode), but this gives the dashboard an
 * instant read before that call ever happens.
 */
export function yocoModeFromKey(key: string): 'live' | 'test' | null {
  if (/_live/i.test(key)) return 'live'
  if (/_test/i.test(key)) return 'test'
  return null
}

/**
 * Which Yoco world money moves in: 'live' (real cards, real rands) or 'test'.
 * Null means no usable key is configured (or the mode is undetectable from
 * the key text; the stored webhook mode fills that gap at the call sites).
 */
export function getYocoKeyMode(): 'live' | 'test' | null {
  const key = getYocoSecretKey()
  if (!key) return null
  return yocoModeFromKey(key)
}

/** Webhook secret: env var wins, otherwise the one stored by the register endpoint. */
export async function getYocoWebhookSecret(): Promise<string | null> {
  const env = process.env.YOCO_WEBHOOK_SECRET?.trim()
  if (env) return env
  const stored = (await getConfig(CONFIG_KEYS.YOCO_WEBHOOK_SECRET)).trim()
  return stored || null
}

export interface YocoCheckout {
  id: string
  status: string
  amount: number
  currency: string
  redirectUrl: string
  paymentId: string | null
  mode: 'live' | 'test'
}

export class YocoError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Create a hosted checkout session. Amount in cents, ZAR only. Min R2.00. */
export async function createYocoCheckout(opts: {
  secretKey: string
  amountCents: number
  successUrl: string
  cancelUrl: string
  failureUrl: string
  metadata: Record<string, string>
  clientReferenceId: string
  idempotencyKey: string
  name: string
}): Promise<YocoCheckout> {
  let res: Response
  try {
    res = await fetch(`${CHECKOUT_API}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.secretKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': opts.idempotencyKey,
      },
      body: JSON.stringify({
        amount: opts.amountCents,
        currency: 'ZAR',
        successUrl: opts.successUrl,
        cancelUrl: opts.cancelUrl,
        failureUrl: opts.failureUrl,
        metadata: opts.metadata,
        clientReferenceId: opts.clientReferenceId,
        lineItems: [
          {
            displayName: opts.name,
            quantity: 1,
            pricingDetails: { price: opts.amountCents },
          },
        ],
      }),
    })
  } catch (e) {
    throw new YocoError(`Could not reach Yoco: ${e instanceof Error ? e.message : 'network error'}`, 504)
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const msg =
      (body as { message?: string; detail?: string }).message ||
      (body as { detail?: string }).detail ||
      `Yoco checkout failed (${res.status})`
    throw new YocoError(msg, res.status === 401 || res.status === 403 ? 502 : 502)
  }
  if (!body.redirectUrl) throw new YocoError('Yoco did not return a payment URL', 502)
  return body as unknown as YocoCheckout
}

/** Register our webhook endpoint with Yoco. Returns the signing secret (shown once). */
export async function registerYocoWebhook(secretKey: string, url: string) {
  const res = await fetch(`${CHECKOUT_API}/webhooks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'hustleportal-wallet', url }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new YocoError(
      (body as { message?: string }).message || `Yoco webhook registration failed (${res.status})`,
      502,
    )
  }
  return body as { id: string; mode: string; name: string; secret: string; url: string }
}

/**
 * Verify a Yoco webhook delivery (Standard Webhooks scheme).
 * signedContent = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 * signature     = base64(HMAC-SHA256(base64decode(secret sans 'whsec_'), signedContent))
 * Headers may carry multiple `v1,<sig>` entries.
 */
export function verifyYocoWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
): { ok: true } | { ok: false; status: number; error: string } {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')
  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, status: 400, error: 'Missing webhook signature headers' }
  }

  // Replay protection: reject deliveries older than 5 minutes.
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { ok: false, status: 400, error: 'Invalid webhook timestamp' }
  const skewSec = Math.abs(Math.floor(Date.now() / 1000) - ts)
  if (skewSec > 300) return { ok: false, status: 401, error: 'Webhook timestamp expired' }

  const secretB64 = secret.replace(/^whsec_/, '')
  let key: Buffer
  try {
    key = Buffer.from(secretB64, 'base64')
  } catch {
    return { ok: false, status: 500, error: 'Invalid webhook secret encoding' }
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64')

  const candidates = signatureHeader
    .split(/\s+/)
    .map((s) => (s.startsWith('v1,') ? s.slice(3) : s))
    .filter(Boolean)

  const match = candidates.some((c) => {
    const a = Buffer.from(c)
    const b = Buffer.from(expected)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  })
  if (!match) return { ok: false, status: 401, error: 'Invalid webhook signature' }
  return { ok: true }
}

export interface YocoWebhookEvent {
  createdDate?: string
  id?: string
  type: string // 'payment.succeeded' | 'payment.failed'
  payload?: {
    amount?: number
    currency?: string
    id?: string // payment id
    mode?: 'live' | 'test'
    status?: string
    metadata?: Record<string, string>
    paymentMethodDetails?: { type?: string }
  }
}
