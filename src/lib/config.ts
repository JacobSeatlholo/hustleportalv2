import { db } from '@/lib/db'

export const CONFIG_KEYS = {
  EXPLEE_API_KEY: 'explee_api_key',
  LEAD_PRICE: 'lead_price_cents', // cost to reveal contact details
  FREE_LEADS: 'free_leads', // legacy — superseded by WELCOME_CREDIT_CENTS
  WELCOME_CREDIT_CENTS: 'welcome_credit_cents', // signup bonus in lead-credit cents
  TOPUP_PACKS: 'topup_packs', // JSON [{id,name,amountCents,creditCents,bonus}]
  MODE: 'mode', // DEMO | LIVE
  YOCO_WEBHOOK_SECRET: 'yoco_webhook_secret', // whsec_... from registering the checkout webhook
  YOCO_WEBHOOK_MODE: 'yoco_webhook_mode', // 'live' | 'test' — which key world the webhook was registered in
  CAMPAIGN_AUTO_CENTS: 'campaign_auto_cents', // top-ups at or above this auto run a client campaign
  LIFECYCLE_LAST_RUN: 'lifecycle_last_run', // hourly throttle for the lifecycle sweep (epoch ms)
} as const

const DEFAULTS: Record<string, string> = {
  [CONFIG_KEYS.LEAD_PRICE]: '1500', // R15.00
  [CONFIG_KEYS.FREE_LEADS]: '3',
  [CONFIG_KEYS.WELCOME_CREDIT_CENTS]: '9900', // R99 — enough real teaser reveals to taste the platform
  [CONFIG_KEYS.CAMPAIGN_AUTO_CENTS]: '50000', // R500 — the smallest credit pack; every real top-up earns a campaign
  [CONFIG_KEYS.TOPUP_PACKS]: JSON.stringify([
    { id: 'starter', name: 'Starter', amountCents: 50000, creditCents: 50000, bonus: 0 },
    { id: 'growth', name: 'Growth', amountCents: 150000, creditCents: 165000, bonus: 10 },
    { id: 'scale', name: 'Scale', amountCents: 500000, creditCents: 575000, bonus: 15 },
  ]),
  [CONFIG_KEYS.MODE]: 'DEMO',
}

// Platform secrets can live in two homes: the Exec Dashboard settings (DB
// row) and Vercel env vars. The DB row wins when present; the env var is the
// fallback so a key added on Vercel lights up campaigns without a database
// write. Secrets never render in full anywhere: the UI shows masks only.
const ENV_FALLBACKS: Record<string, string | undefined> = {
  [CONFIG_KEYS.EXPLEE_API_KEY]: process.env.EXPLEE_API_KEY,
}

export async function getConfig(key: string): Promise<string> {
  const row = await db.platformConfig.findUnique({ where: { key } })
  if (row) return row.value
  const fromEnv = ENV_FALLBACKS[key]?.trim()
  if (fromEnv) return fromEnv
  return DEFAULTS[key] ?? ''
}

export async function getConfigJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await getConfig(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function setConfig(key: string, value: string) {
  await db.platformConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

export async function hasExpleeKey() {
  const key = await getConfig(CONFIG_KEYS.EXPLEE_API_KEY)
  return Boolean(key && key.trim().length > 5)
}
