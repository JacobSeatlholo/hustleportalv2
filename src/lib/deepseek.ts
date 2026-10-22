import { db } from '@/lib/db'

/**
 * DeepSeek engine, pay-per-use chat completions, no daily quota walls.
 * OpenAI-compatible API at https://api.deepseek.com (Bearer key).
 *
 * DeepSeek CANNOT browse the web. It never discovers businesses on its own:
 * callers hand it REAL source records (OpenStreetMap directory entries, the
 * seller's own website text) and it matches, scores and explains them. Every
 * caller must re-validate that contact details in the answer exist verbatim in
 * the source data, the engine is never trusted to produce contact facts.
 *
 * Key resolution: the user's own key (their credits, their control) first, then
 * the platform key from the environment. A failing user key is never silently
 * swapped for the platform key: spending someone else's paid credits without
 * asking is not what a careful product does.
 */

const BASE = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-chat'

export type DeepseekErrorReason = 'NO_KEY' | 'KEY_INVALID' | 'BALANCE' | 'RATE' | 'BUSY' | 'EMPTY' | 'OTHER'

export type DeepseekResult =
  | { ok: true; text: string; keySource: 'user' | 'platform' }
  | { ok: false; error: string; reason: DeepseekErrorReason }

export async function getUserDeepseekKey(userId: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: 'DEEPSEEK_API_KEY' } },
  })
  return row?.value || null
}

/** Platform key from the environment (set once on the server by the operator). */
export function getPlatformDeepseekKey(): string | null {
  return process.env.DEEPSEEK_API_KEY?.trim() || null
}

/** Resolution order: the user's own key (their credits) → platform key → none. */
export async function resolveDeepseekKey(
  userId: string
): Promise<{ key: string | null; source: 'user' | 'platform' | 'none' }> {
  const userKey = await getUserDeepseekKey(userId)
  if (userKey) return { key: userKey, source: 'user' }
  const platformKey = getPlatformDeepseekKey()
  if (platformKey) return { key: platformKey, source: 'platform' }
  return { key: null, source: 'none' }
}

/** Brand-voice error lines, honest about who fixes what. No dashes. */
function friendly(status: number): { error: string; reason: DeepseekErrorReason } {
  if (status === 401)
    return {
      error: 'That DeepSeek key was not accepted. Check the key saved under Integrations, or paste a fresh one from platform.deepseek.com/api_keys.',
      reason: 'KEY_INVALID',
    }
  if (status === 402)
    return {
      error: 'DeepSeek credits are used up. Top up at platform.deepseek.com and the engine picks up exactly where it stopped.',
      reason: 'BALANCE',
    }
  if (status === 429)
    return {
      error: 'DeepSeek is pacing requests this second. Give it a moment and run the scan again.',
      reason: 'RATE',
    }
  if (status >= 500)
    return {
      error: 'DeepSeek is busy right now. One more try usually lands.',
      reason: 'BUSY',
    }
  return {
    error: `DeepSeek answered with status ${status}. One more try usually lands.`,
    reason: 'OTHER',
  }
}

export async function deepseekGenerate(
  userId: string,
  opts: { system?: string; prompt: string; json?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number }
): Promise<DeepseekResult> {
  const { key, source } = await resolveDeepseekKey(userId)
  if (!key) {
    return { ok: false, error: 'No DeepSeek key is configured.', reason: 'NO_KEY' }
  }
  const body: Record<string, unknown> = {
    model: DEEPSEEK_MODEL,
    messages: [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      { role: 'user', content: opts.prompt },
    ],
    temperature: opts.temperature ?? (opts.json ? 0.3 : 0.7),
    max_tokens: opts.maxTokens ?? 1200,
    stream: false,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  }
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    })
    if (!res.ok) {
      const f = friendly(res.status)
      return { ok: false, ...f }
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content?.trim() || ''
    if (!text) return { ok: false, error: 'DeepSeek returned an empty answer.', reason: 'EMPTY' }
    return { ok: true, text, keySource: source === 'user' ? 'user' : 'platform' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'request failed'
    if (/abort|timeout|timed out/i.test(msg))
      return { ok: false, error: 'DeepSeek took too long to answer. One more try is usually quicker.', reason: 'BUSY' }
    return { ok: false, error: `Could not reach DeepSeek just now (${msg}). It retries on the next scan.`, reason: 'OTHER' }
  }
}

export interface DeepseekBalance {
  available: boolean
  totalUsd: number | null
  grantedUsd: number | null
}

/** Real credit balance from DeepSeek's own meter (GET /user/balance). */
export async function deepseekBalance(key: string, timeoutMs = 8_000): Promise<DeepseekBalance | null> {
  try {
    const res = await fetch(`${BASE}/user/balance`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      is_available?: boolean
      balance_infos?: { currency?: string; total_balance?: string; granted_balance?: string }[]
    }
    const usd = (data.balance_infos || []).find((b) => (b.currency || '').toUpperCase() === 'USD')
    return {
      available: data.is_available !== false,
      totalUsd: usd?.total_balance !== undefined ? Number(usd.total_balance) : null,
      grantedUsd: usd?.granted_balance !== undefined ? Number(usd.granted_balance) : null,
    }
  } catch {
    return null
  }
}

export interface DeepseekKeyValidation {
  ok: boolean
  message: string
  balanceUsd?: number | null
}

/**
 * Save-time validation: shape check, a real /models probe, then the real credit
 * balance. The verdict IS the toast, the same minute the key is pasted.
 */
export async function validateDeepseekKey(key: string): Promise<DeepseekKeyValidation> {
  const trimmed = key.trim()
  if (!/^sk-[A-Za-z0-9]{16,}$/.test(trimmed)) {
    return {
      ok: false,
      message: 'That does not look like a DeepSeek API key. Keys start with sk- and come from platform.deepseek.com/api_keys.',
    }
  }
  try {
    const probe = await fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${trimmed}` },
      signal: AbortSignal.timeout(12_000),
    })
    if (probe.status === 401) {
      return { ok: false, message: 'DeepSeek rejected that key. Generate a fresh one at platform.deepseek.com/api_keys and paste it again.' }
    }
    if (!probe.ok) {
      const bal = await deepseekBalance(trimmed)
      if (bal) return { ok: bal.available, message: bal.available ? 'Key accepted by DeepSeek.' : 'Key accepted, but the DeepSeek account is flagged unavailable. Check platform.deepseek.com.', balanceUsd: bal.totalUsd }
      return { ok: false, message: `DeepSeek answered with status ${probe.status}. One more try usually lands.` }
    }
    const bal = await deepseekBalance(trimmed)
    if (bal && bal.totalUsd !== null) {
      if (!bal.available) {
        return { ok: false, message: 'The key works, but DeepSeek flags the account unavailable. Check platform.deepseek.com for the hold.', balanceUsd: bal.totalUsd }
      }
      const balLine = `$${bal.totalUsd.toFixed(2)} of credits available`
      if (bal.totalUsd <= 0) {
        return { ok: true, message: `Key verified. ${balLine}. Top up at platform.deepseek.com to put the engine to work.`, balanceUsd: bal.totalUsd }
      }
      return { ok: true, message: `Key verified. ${balLine}. Lead ranking now runs on your own credits, with no daily quota wall.`, balanceUsd: bal.totalUsd }
    }
    return { ok: true, message: 'Key verified with DeepSeek. Lead ranking now runs on your own credits.' }
  } catch {
    return { ok: false, message: 'Could not reach DeepSeek just now. The key is saved, and the next scan will use it.' }
  }
}
