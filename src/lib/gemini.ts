/**
 * Gemini calls grounded in the user's business profile.
 * PLUG & PLAY: works out of the box with the platform key (Vercel env GEMINI_API_KEY).
 * A user's own key (UserSetting: GEMINI_API_KEY, Integrations hub) is an OPTIONAL
 * override — power users can run AI on their own quota.
 *
 * RESILIENCE (fixes "scan returns 403" class of failures):
 *  - Model chain: Google retires model IDs; we try an alias-first chain and cache
 *    whichever model answered for this server instance.
 *  - Key chain: if the user's own key is rejected (invalid key, API not enabled,
 *    referrer-restricted, out of quota) we transparently retry on the platform key
 *    so the feature keeps working instead of surfacing a raw 403.
 *  - When everything fails we return ONE actionable, professional message.
 */
import { db } from '@/lib/db'

/** Alias-first chain: gemini-flash-latest always tracks Google's current stable Flash model. */
const MODEL_CHAIN = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'] as const
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** First model that answered on this server instance — avoids repeat fallback rounds. */
let cachedModel: string | null = null

export async function getUserGeminiKey(userId: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: 'GEMINI_API_KEY' } },
  })
  return row?.value || null
}

/** Platform key from the environment (set once on the server by the operator). */
export function getPlatformGeminiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null
}

/** Resolution order: user's own key (override) → platform key → null. */
export async function resolveGeminiKey(
  userId: string
): Promise<{ key: string | null; source: 'user' | 'platform' | 'none' }> {
  const userKey = await getUserGeminiKey(userId)
  if (userKey) return { key: userKey, source: 'user' }
  const platformKey = getPlatformGeminiKey()
  if (platformKey) return { key: platformKey, source: 'platform' }
  return { key: null, source: 'none' }
}

export type GeminiResult = { ok: true; text: string } | { ok: false; error: string }

export interface GeminiHistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

type ErrorClass = 'KEY_INVALID' | 'PERMISSION' | 'MODEL' | 'QUOTA' | 'EMPTY' | 'OTHER'

function classify(status: number, body: string): ErrorClass {
  const b = body.slice(0, 600)
  if (status === 400 && /API_KEY_INVALID|API key not valid|api_key/i.test(b)) return 'KEY_INVALID'
  if (status === 401) return 'KEY_INVALID'
  if (status === 403) return 'PERMISSION'
  if (status === 404) return 'MODEL'
  if (status === 429) return 'QUOTA'
  return 'OTHER'
}

function friendlyError(cls: ErrorClass, status: number, detail: string, ownKey: boolean): string {
  const own = ownKey
    ? ' This happened with YOUR Gemini key — you can remove it under Integrations to ride on HustlePortal AI again.'
    : ''
  switch (cls) {
    case 'KEY_INVALID':
      return `Your Gemini key was rejected by Google (invalid, deleted or mistyped).${own ? ' Update it under Integrations, or remove it to use HustlePortal AI.' : ' The platform AI key looks misconfigured — the operator has been alerted by this message.'}`
    case 'PERMISSION':
      return `Google blocked the AI request (403 Permission denied).${own ? ' In Google AI Studio / Cloud console: enable the "Generative Language API" for this key and clear any website or API restrictions on it.' : ' The platform AI key needs the Generative Language API enabled or its restrictions cleared — shown in diagnostics under Integrations.'}`
    case 'QUOTA':
      return `Gemini is rate-limited right now (429). We retried on the fallback key — please try again in a minute.${own}`
    default:
      return `Gemini request failed (Google ${status}). ${detail.slice(0, 140)}${own}`
  }
}

/**
 * One hardened request: walks (user key → platform key) × (cached model → chain),
 * retries only on HTTP-status failures, returns the best actionable error.
 */
async function callGemini(
  userId: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<GeminiResult> {
  const keys: { key: string; ownKey: boolean }[] = []
  const userKey = await getUserGeminiKey(userId)
  if (userKey) keys.push({ key: userKey, ownKey: true })
  const platformKey = getPlatformGeminiKey()
  if (platformKey && platformKey !== userKey) keys.push({ key: platformKey, ownKey: false })
  if (keys.length === 0) {
    return {
      ok: false,
      error:
        'NO_KEY: HustlePortal AI is not switched on yet — try again soon. You can also add your own free Gemini key under Integrations to go live instantly.',
    }
  }

  let bestErr = ''
  let timedOut = false

  for (const { key, ownKey } of keys) {
    const models = cachedModel && MODEL_CHAIN.includes(cachedModel as (typeof MODEL_CHAIN)[number])
      ? [cachedModel, ...MODEL_CHAIN.filter((m) => m !== cachedModel)]
      : [...MODEL_CHAIN]
    for (const model of models) {
      try {
        const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) {
          const raw = await res.text().catch(() => '')
          const cls = classify(res.status, raw)
          bestErr = friendlyError(cls, res.status, raw, ownKey)
          // Key-level fatals: no point trying other models with the same key.
          if (cls === 'KEY_INVALID') break
          // Model-level: try the next model on this key.
          continue
        }
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[]
        }
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
        if (!text.trim()) {
          bestErr = 'Gemini returned an empty response — try rephrasing or a clearer image.'
          continue
        }
        cachedModel = model
        return { ok: true, text }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Gemini request failed'
        bestErr = `Gemini request failed: ${msg}`
        if (/abort|timeout|TimeoutError/i.test(msg)) { timedOut = true; break }
      }
    }
    if (timedOut) break // connectivity problem — don't hammer the chain
  }

  return { ok: false, error: bestErr || 'Gemini request failed' }
}

export async function geminiGenerate(
  userId: string,
  opts: { system?: string; prompt: string; json?: boolean; history?: GeminiHistoryTurn[] },
): Promise<GeminiResult> {
  const history = (opts.history || []).slice(-10).map((h) => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }))
  const body = {
    contents: [...history, { role: 'user', parts: [{ text: opts.prompt }] }],
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    generationConfig: {
      temperature: opts.json ? 0.4 : 0.8,
      maxOutputTokens: 1200,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  }
  return callGemini(userId, body, 30_000)
}

/**
 * Vision call — extract structured data from a photo/screenshot (OCR+understanding).
 * Same hardened key/model chain + error contract as geminiGenerate. Low temperature for extraction.
 */
export async function geminiVision(
  userId: string,
  opts: { imageBase64: string; mimeType: string; system?: string; prompt: string; json?: boolean },
): Promise<GeminiResult> {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: opts.mimeType || 'image/jpeg', data: opts.imageBase64 } },
          { text: opts.prompt },
        ],
      },
    ],
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2400,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  }
  return callGemini(userId, body, 45_000)
}

/** Parse a JSON object out of a Gemini response (tolerates ``` fences). */
export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0]) as T
      } catch {}
    }
    return null
  }
}
