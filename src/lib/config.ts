import { db } from '@/lib/db'

export const CONFIG_KEYS = {
  EXPLEE_API_KEY: 'explee_api_key',
  LEAD_PRICE: 'lead_price_cents', // cost to reveal contact details
  FREE_LEADS: 'free_leads', // free reveals on signup
  TOPUP_PACKS: 'topup_packs', // JSON [{id,name,amountCents,creditCents,bonus}]
  MODE: 'mode', // DEMO | LIVE
  YOCO_WEBHOOK_SECRET: 'yoco_webhook_secret', // whsec_... from registering the checkout webhook
} as const

const DEFAULTS: Record<string, string> = {
  [CONFIG_KEYS.LEAD_PRICE]: '1500', // R15.00
  [CONFIG_KEYS.FREE_LEADS]: '3',
  [CONFIG_KEYS.TOPUP_PACKS]: JSON.stringify([
    { id: 'starter', name: 'Starter', amountCents: 50000, creditCents: 50000, bonus: 0 },
    { id: 'growth', name: 'Growth', amountCents: 150000, creditCents: 165000, bonus: 10 },
    { id: 'scale', name: 'Scale', amountCents: 500000, creditCents: 575000, bonus: 15 },
  ]),
  [CONFIG_KEYS.MODE]: 'DEMO',
}

export async function getConfig(key: string): Promise<string> {
  const row = await db.platformConfig.findUnique({ where: { key } })
  if (row) return row.value
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
