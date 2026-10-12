/**
 * Gemini calls grounded in the user's business profile.
 * PLUG & PLAY: works out of the box with the platform key (Vercel env GEMINI_API_KEY).
 * A user's own key (UserSetting: GEMINI_API_KEY, Integrations hub) is an OPTIONAL
 * override — power users can run AI on their own quota.
 *
 * RESILIENCE (fixes the "models/gemini-2.0-flash is no longer available" class of failures):
 *  - Dynamic model discovery: Google retires model IDs over time (2.0-flash retired, 3.x shipped).
 *    Before the first call on an instance we ask ListModels what THIS key can actually see and pick
 *    the best flash-tier model from our preference list — so a Google-side retirement self-heals
 *    instead of hard-failing. Re-verified every 30 minutes; a cached winner that starts returning
 *    404 mid-flight is evicted immediately.
 *  - Key chain: the user's own key is tried first; if it is rejected (invalid key, restrictions,
 *    quota, suspended project) we transparently retry on the platform key.
 *  - Error prioritisation: when everything fails we surface the MOST actionable cause
 *    (a bad user key beats a platform problem; "model retired" is never blamed on the user's key).
 */
import { db } from '@/lib/db'

/**
 * Preference order — alias first (tracks Google's current stable Flash), then numbered
 * generations as fallbacks. Only entries the key can actually SEE get called (discovery),
 * so stale names here are harmless.
 */
const MODEL_PREFERENCE = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash',
] as const
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Winner cache — verified against ListModels, refreshed on this TTL. */
let cachedModel: string | null = null
let cachedModelAt = 0
const MODEL_TTL_MS = 30 * 60 * 1000

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
  const b = body.slice(0, 800)
  if (status === 400 && /API_KEY_INVALID|API_KEY_EXPIRED|API_KEY_SERVICE_BLOCKED|API key not valid|API key blocked|api key expired/i.test(b))
    return 'KEY_INVALID'
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
      return `Google blocked the AI request (403 Permission denied).${own ? ' In Google AI Studio / Cloud console: enable the "Generative Language API" for this key and clear any website or API restrictions on it — or simply remove it under Integrations to ride HustlePortal AI.' : ' The platform AI key\'s Google project is currently restricted or suspended — the operator must issue a fresh project key. You can add your own free Gemini key under Integrations to go live instantly.'}`
    case 'QUOTA':
      return `Gemini is rate-limited right now (429). We tried the fallback key too — please try again in a minute.${own}`
    case 'MODEL':
      // A retired model is NEVER the user's key's fault — no "YOUR key" suffix here.
      return 'Google is rotating its AI models (one was retired mid-flight, 404) and our fallbacks were momentarily unavailable. HustlePortal updates its model list automatically — please try again in a minute.'
    case 'EMPTY':
      return 'Gemini returned an empty response — try rephrasing, or attach a clearer image.'
    default:
      return `Gemini request failed (Google ${status}). ${detail.slice(0, 140)}${own}`
  }
}

interface Failure {
  cls: ErrorClass
  ownKey: boolean
  status: number
  detail: string
}

/**
 * Surface the failure the user can actually DO something about — and, when BOTH
 * keys failed for different reasons, name each cause so the escape hatch is
 * obvious (mirrors the mail engine's combined-error contract).
 */
function bestError(failures: Failure[]): string {
  if (failures.length === 0) return 'Gemini request failed'
  const rank = (f: Failure): number => {
    switch (f.cls) {
      case 'KEY_INVALID': return f.ownKey ? 10 : 6
      case 'PERMISSION': return f.ownKey ? 9 : 7
      case 'QUOTA': return f.ownKey ? 8 : 5
      case 'EMPTY': return 4
      case 'MODEL': return 3
      default: return f.ownKey ? 4 : 2
    }
  }
  const best = failures.reduce((a, b) => (rank(b) > rank(a) ? b : a))
  let msg = friendlyError(best.cls, best.status, best.detail, best.ownKey)
  const other = failures.find((f) => f.ownKey !== best.ownKey && f.cls !== best.cls)
  if (other) {
    const clause = shortOtherCause(other)
    if (clause) msg += ` ${clause}`
  }
  return msg
}

/** One compact line about what the OTHER key did, so both causes are visible at once. */
function shortOtherCause(f: Failure): string {
  const who = f.ownKey ? 'Your own key' : 'HustlePortal AI'
  switch (f.cls) {
    case 'KEY_INVALID': return `(${who} was also rejected as invalid.)`
    case 'PERMISSION': return `(${who} was also blocked by Google — 403.)`
    case 'QUOTA': return `(${who} is rate-limited this minute — retrying in a minute usually clears it.)`
    case 'MODEL': return `(Google is also mid-rotation on its models right now.)`
    default: return ''
  }
}

/**
 * What can THIS key actually call right now? ListModels once per TTL, pick the best
 * preference entry the key can see. Discovery is best-effort — any failure falls back
 * to the static preference chain.
 */
async function resolveModels(key: string): Promise<string[]> {
  const now = Date.now()
  if (cachedModel && now - cachedModelAt < MODEL_TTL_MS) {
    return [cachedModel, ...MODEL_PREFERENCE.filter((m) => m !== cachedModel)]
  }
  try {
    const res = await fetch(
      `${BASE}/models?key=${encodeURIComponent(key)}&pageSize=1000`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (res.ok) {
      const data = (await res.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[]
      }
      const usable = new Set(
        (data.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => (m.name || '').replace(/^models\//, ''))
      )
      const pick = MODEL_PREFERENCE.find((m) => usable.has(m))
      if (pick) {
        cachedModel = pick
        cachedModelAt = now
        return [pick, ...MODEL_PREFERENCE.filter((m) => m !== pick)]
      }
      // None of our preferred names are visible — ride the newest flash-tier model Google offers.
      const anyFlash = (data.models || [])
        .map((m) => (m.name || '').replace(/^models\//, ''))
        .filter(
          (n) =>
            /flash/i.test(n) &&
            !/tts|image|embed|transcribe|robotics|computer|omni|banana|lyria|preview|customtools/i.test(n)
        )
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
      if (anyFlash) {
        cachedModel = anyFlash
        cachedModelAt = now
        return [anyFlash, ...MODEL_PREFERENCE.filter((m) => m !== anyFlash)]
      }
    }
  } catch {
    // discovery is best-effort — fall through to the static chain
  }
  return [...MODEL_PREFERENCE]
}

/**
 * One hardened request: walks (user key → platform key) × (discovered model chain),
 * retries only on HTTP-status failures, returns the most actionable error.
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

  const failures: Failure[] = []
  let timedOut = false
  // Hard deadline for the WHOLE chain: per-attempt timeouts shrink as the clock
  // runs down, so (keys × models) can never stack past the caller's budget —
  // the single biggest cause of Vercel 504s on slow paths.
  const deadline = Date.now() + timeoutMs

  for (const { key, ownKey } of keys) {
    if (Date.now() >= deadline) break
    const models = await resolveModels(key)
    for (const model of models) {
      const remaining = deadline - Date.now()
      if (remaining <= 2_000) break
      try {
        const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(remaining),
        })
        if (!res.ok) {
          const raw = await res.text().catch(() => '')
          const cls = classify(res.status, raw)
          failures.push({ cls, ownKey, status: res.status, detail: raw })
          // A cached winner that Google just retired — evict so the next request re-discovers.
          if (cls === 'MODEL' && model === cachedModel) {
            cachedModel = null
            cachedModelAt = 0
          }
          // Key-level fatals: no point trying other models with the same key.
          if (cls === 'KEY_INVALID') break
          // Model-level / permission-level: try the next model on this key.
          continue
        }
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[]
        }
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
        if (!text.trim()) {
          failures.push({ cls: 'EMPTY', ownKey, status: res.status, detail: '' })
          continue
        }
        cachedModel = model
        cachedModelAt = Date.now()
        return { ok: true, text }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Gemini request failed'
        failures.push({ cls: 'OTHER', ownKey, status: 0, detail: msg })
        if (/abort|timeout|TimeoutError/i.test(msg)) { timedOut = true; break }
      }
    }
    if (timedOut) break // connectivity problem — don't hammer the chain
  }

  return { ok: false, error: bestError(failures) }
}

export async function geminiGenerate(
  userId: string,
  opts: { system?: string; prompt: string; json?: boolean; search?: boolean; history?: GeminiHistoryTurn[]; timeoutMs?: number },
): Promise<GeminiResult> {
  const history = (opts.history || []).slice(-10).map((h) => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }))
  const body: Record<string, unknown> = {
    contents: [...history, { role: 'user', parts: [{ text: opts.prompt }] }],
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    generationConfig: {
      temperature: opts.json ? 0.4 : 0.8,
      maxOutputTokens: opts.search ? 2000 : 1200,
      // NOTE: JSON mime mode is incompatible with search grounding on many model
      // versions — when searching, we ask for raw JSON in the prompt and parse loosely.
      ...(opts.json && !opts.search ? { responseMimeType: 'application/json' } : {}),
    },
    // Real-world grounding: Google Search results the model actually saw (real businesses).
    ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
  }
  return callGemini(userId, body, opts.timeoutMs ?? (opts.search ? 55_000 : 30_000))
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
