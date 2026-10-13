import { db } from '@/lib/db'

/**
 * z.ai GLM engine — pay as you go chat completions with REAL web search grounding.
 * OpenAI-compatible API at https://api.z.ai/api/paas/v4 (Bearer key).
 *
 * WHY THIS ENGINE EXISTS: Google slashed the Gemini free tier (Flash caps cut hard
 * since December 2025, some projects sit at zero), so lead discovery needs an engine
 * that does not depend on Google's mood. GLM's Web Search in Chat tool grounds the
 * model in live web results the same way Gemini's google_search does — real
 * businesses in, fabricated names never out.
 *
 * Cost honesty: Web Search costs $0.01 per use and GLM-4.6 tokens are pennies
 * ($0.60 per million input, $2.20 per million output), so one grounded lead scan
 * costs roughly two cents. Ten dollars of credits is hundreds of scans.
 *
 * Key resolution: the user's own key first (their credits, their control), then the
 * platform key from the environment. A failing user key is never silently swapped
 * for the platform key — spending someone else's paid credits without asking is not
 * what a careful product does.
 *
 * The platform env var is canonically ZAI_API_KEY, but the operator is human:
 * friendly names like GLM_key are accepted too, so a key saved under a different
 * name still powers the engine instead of sitting invisible in the environment.
 */

const BASE = 'https://api.z.ai/api/paas/v4'

/**
 * Walk list, cheap first. GLM-4.6 is the price/performance workhorse; newer
 * generations follow for when a model id is ever retired. A model error walks to
 * the next entry; quota and money errors do NOT walk (a paid engine is not to be
 * hammered while it is pacing or out of credits).
 */
const MODEL_PREFERENCE = ['glm-4.6', 'glm-4.7', 'glm-5.3-flash'] as const

export const ZAI_PROBE_MODEL = 'glm-4.6'

export type ZaiErrorReason = 'NO_KEY' | 'KEY_INVALID' | 'BALANCE' | 'RATE' | 'BUSY' | 'EMPTY' | 'OTHER'

export type ZaiResult =
  | { ok: true; text: string; keySource: 'user' | 'platform'; model: string }
  | { ok: false; error: string; reason: ZaiErrorReason }

export async function getUserZaiKey(userId: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: 'ZAI_API_KEY' } },
  })
  return row?.value || null
}

/**
 * Platform key from the environment (set once on the server by the operator).
 * Canonical name first, then the friendly aliases operators actually use.
 */
const PLATFORM_ZAI_ENV_NAMES = ['ZAI_API_KEY', 'GLM_key', 'GLM_API_KEY', 'GLM_KEY', 'ZAI_KEY'] as const

export function getPlatformZaiKey(): string | null {
  for (const name of PLATFORM_ZAI_ENV_NAMES) {
    const v = process.env[name]?.trim()
    if (v) return v
  }
  return null
}

/** Resolution order: the user's own key (their credits) → platform key → none. */
export async function resolveZaiKey(
  userId: string
): Promise<{ key: string | null; source: 'user' | 'platform' | 'none' }> {
  const userKey = await getUserZaiKey(userId)
  if (userKey) return { key: userKey, source: 'user' }
  const platformKey = getPlatformZaiKey()
  if (platformKey) return { key: platformKey, source: 'platform' }
  return { key: null, source: 'none' }
}

/** Brand voice error lines, honest about who fixes what. No dashes anywhere. */
function friendly(status: number): { error: string; reason: ZaiErrorReason } {
  if (status === 401)
    return {
      error: 'That z.ai key was not accepted. Check the key saved under Integrations, or paste a fresh one from the z.ai API keys page.',
      reason: 'KEY_INVALID',
    }
  if (status === 402)
    return {
      error: 'z.ai credits are used up. Top up on the z.ai billing page and the engine picks up exactly where it stopped.',
      reason: 'BALANCE',
    }
  if (status === 429)
    return {
      error: 'z.ai is pacing requests or the credits need a top up on the z.ai billing page. Give it a moment and run the scan again.',
      reason: 'RATE',
    }
  if (status >= 500)
    return {
      error: 'z.ai is busy right now. One more try usually lands.',
      reason: 'BUSY',
    }
  return {
    error: `z.ai answered with status ${status}. One more try usually lands.`,
    reason: 'OTHER',
  }
}

export async function zaiGenerate(
  userId: string,
  opts: { system?: string; prompt: string; json?: boolean; search?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number }
): Promise<ZaiResult> {
  const { key, source } = await resolveZaiKey(userId)
  if (!key) {
    return { ok: false, error: 'No z.ai key is configured.', reason: 'NO_KEY' }
  }
  // JSON mime mode rides along only on plain calls: with the web search tool active
  // we ask for raw JSON in the prompt instead and parse loosely, exactly like the
  // Gemini path handles search plus JSON.
  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: opts.prompt },
  ]
  let lastStatus = 0
  let lastReason: ZaiErrorReason = 'OTHER'
  let lastError = 'z.ai request failed'
  for (const model of MODEL_PREFERENCE) {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature ?? (opts.json ? 0.3 : 0.7),
      max_tokens: opts.maxTokens ?? 1200,
      stream: false,
      ...(opts.json && !opts.search ? { response_format: { type: 'json_object' } } : {}),
      // Real world grounding: the model sees live web results (real businesses).
      ...(opts.search
        ? {
            tools: [
              {
                type: 'web_search',
                web_search: {
                  enable: true,
                  search_engine: 'search-prime',
                  search_result: true,
                  count: 10,
                  content_size: 'medium',
                },
              },
            ],
          }
        : {}),
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
        lastStatus = res.status
        lastReason = f.reason
        lastError = f.error
        // A retired or unavailable model id walks to the next preference entry.
        // Everything else (money, pacing, auth) is engine wide: stop walking.
        if ((res.status === 400 || res.status === 404) && model !== MODEL_PREFERENCE[MODEL_PREFERENCE.length - 1]) {
          continue
        }
        return { ok: false, error: f.error, reason: f.reason }
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
        model?: string
      }
      const text = data.choices?.[0]?.message?.content?.trim() || ''
      if (!text) {
        return { ok: false, error: 'z.ai returned an empty answer.', reason: 'EMPTY' }
      }
      return { ok: true, text, keySource: source === 'user' ? 'user' : 'platform', model: data.model || model }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'request failed'
      if (/abort|timeout|timed out/i.test(msg)) {
        return { ok: false, error: 'z.ai took too long to answer. One more try is usually quicker.', reason: 'BUSY' }
      }
      lastError = `Could not reach z.ai just now. It retries on the next scan.`
      lastReason = 'OTHER'
      void lastStatus
    }
  }
  return { ok: false, error: lastError, reason: lastReason }
}

export interface ZaiKeyValidation {
  ok: boolean
  message: string
}

/**
 * Save time validation: a light shape check, then a REAL micro generation on the
 * exact model the engine uses. The verdict IS the toast, the same minute the key
 * is pasted. The probe costs a fraction of a cent, same honest pattern as the
 * Gemini status probe.
 */
export async function validateZaiKey(key: string): Promise<ZaiKeyValidation> {
  const trimmed = key.trim()
  if (trimmed.length < 20 || /\s/.test(trimmed)) {
    return {
      ok: false,
      message: 'That does not look like a z.ai API key. Copy the full key from the API keys page on the z.ai open platform.',
    }
  }
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${trimmed}` },
      body: JSON.stringify({
        model: ZAI_PROBE_MODEL,
        messages: [{ role: 'user', content: 'Reply: OK' }],
        max_tokens: 8,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      return {
        ok: true,
        message: 'Key verified with z.ai. Lead discovery now runs on your own pay as you go credits, with live web search grounding and no Google quota.',
      }
    }
    if (res.status === 401) {
      return {
        ok: false,
        message: 'z.ai rejected that key. Generate a fresh one on the z.ai open platform API keys page and paste it again.',
      }
    }
    if (res.status === 402 || res.status === 429) {
      return {
        ok: true,
        message: 'The key works, but z.ai is pacing requests or the credits need a top up on the z.ai billing page. It will start working the moment credits land.',
      }
    }
    return { ok: false, message: `z.ai answered with status ${res.status}. The key is saved and the next scan will try it.` }
  } catch {
    return { ok: false, message: 'Could not reach z.ai just now. The key is saved, and the next scan will use it.' }
  }
}
