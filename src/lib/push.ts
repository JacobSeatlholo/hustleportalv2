/**
 * Web Push, zero-config VAPID.
 *
 * VAPID keys are generated ONCE and stored in PlatformConfig (no env access needed
 * on Vercel). Every installed PWA can subscribe; the subscription row survives until
 * the push service reports it dead (404/410 → pruned).
 *
 * Public surface:
 *   getVapidPublicKey(), client asks via /api/push (GET) before subscribing.
 *   sendPushToUser(userId, payload), fire-and-forget to every device of the user.
 */
import { db } from '@/lib/db'

const PUB_KEY = 'PUSH_VAPID_PUBLIC'
const PRIV_KEY = 'PUSH_VAPID_PRIVATE'

let cached: { publicKey: string; privateKey: string } | null = null

async function ensureVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (cached) return cached
  const rows = await db.platformConfig.findMany({
    where: { key: { in: [PUB_KEY, PRIV_KEY] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  if (map[PUB_KEY] && map[PRIV_KEY]) {
    cached = { publicKey: map[PUB_KEY], privateKey: map[PRIV_KEY] }
    return cached
  }
  const webpush = (await import('web-push')).default
  const keys = webpush.generateVAPIDKeys()
  // Two upserts (PlatformConfig has no multi-key API), one write wins the race, the
  // other is idempotent on the same values. If a concurrent generation happened
  // between reads and writes, re-read once so both servers converge on ONE pair.
  await db.platformConfig.upsert({
    where: { key: PUB_KEY },
    create: { key: PUB_KEY, value: keys.publicKey },
    update: { value: keys.publicKey },
  })
  await db.platformConfig.upsert({
    where: { key: PRIV_KEY },
    create: { key: PRIV_KEY, value: keys.privateKey },
    update: { value: keys.privateKey },
  })
  cached = { publicKey: keys.publicKey, privateKey: keys.privateKey }
  return cached
}

export async function getVapidPublicKey(): Promise<string> {
  const k = await ensureVapidKeys()
  return k.publicKey
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

export interface PushSendReport {
  subscriptions: number
  sent: number
  pruned: number
  /** One line per dead or failing device, endpoint tail only, enough to
   *  diagnose "notifications are broken" without ever storing a full endpoint
   *  in a response. A 403 is the VAPID key mismatch signature: the stored
   *  subscription can never receive again, so it gets pruned like 404/410. */
  errors: { status: number; tail: string }[]
}

/** Send to every device of a user. Prunes dead subscriptions. Never throws. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushSendReport> {
  let sent = 0
  let pruned = 0
  let deviceCount = 0
  const errors: { status: number; tail: string }[] = []
  try {
    const [keys, subs] = await Promise.all([
      ensureVapidKeys(),
      db.pushSubscription.findMany({ where: { userId } }),
    ])
    deviceCount = subs.length
    if (subs.length === 0) return { subscriptions: 0, sent, pruned, errors }
    const webpush = (await import('web-push')).default
    webpush.setVapidDetails('mailto:team@businesshustle.co.za', keys.publicKey, keys.privateKey)
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 24 * 3 } // 3 days, a stale nudge is worse than none
          )
          sent++
        } catch (e) {
          const err = e as { statusCode?: number }
          const status = err.statusCode || 0
          // 404/410: the push service retired the endpoint. 403: the VAPID
          // keys no longer match (key rotation or a pre-migration row), that
          // device can never receive again either. All three prune. 0 means
          // the request died before a status (network), keep the row and
          // record it so the test action can tell the truth.
          if (status === 404 || status === 410 || status === 403) {
            await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
            pruned++
          }
          errors.push({ status, tail: sub.endpoint.slice(-14) })
        }
      })
    )
  } catch {
    // push is best-effort, never break a request over it
  }
  return { subscriptions: deviceCount, sent, pruned, errors }
}
