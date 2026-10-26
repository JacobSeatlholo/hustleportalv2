/**
 * Gemini calls grounded in the user's business profile.
 * PLUG & PLAY: works out of the box with the platform key (Vercel env GEMINI_API_KEY).
 * A user's own key (UserSetting: GEMINI_API_KEY, Integrations hub) is an OPTIONAL
 * override, power users can run AI on their own quota.
 *
 * RESILIENCE (fixes the "models/gemini-2.0-flash is no longer available" class of failures):
 *  - Dynamic model discovery: Google retires model IDs over time (2.0-flash retired, 3.x shipped).
 *    Before the first call on an instance we ask ListModels what THIS key can actually see and pick
 *    the best flash-tier model from our preference list, so a Google-side retirement self-heals
 *    instead of hard-failing. Re-verified every 30 minutes; a cached winner that starts returning
 *    404 mid-flight is evicted immediately.
 *  - Key chain: the user's own key is tried first; if it is rejected (invalid key, restrictions,
 *    quota, suspended project) we transparently retry on the platform key.
 *  - Error prioritisation: when everything fails we surface the MOST actionable cause
 *    (a bad user key beats a platform problem; "model retired" is never blamed on the user's key).
 */
import { db } from '@/lib/db'
import { openrouterFromGeminiBody } from '@/lib/openrouter'

/**
 * Preference order, alias first (tracks Google's current stable Flash), then numbered
 * generations as fallbacks. Only entries the key can actually SEE get called (discovery),
 * so stale names here are harmless.
 */
const MODEL_PREFERENCE = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
] as const
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Google now mints TWO key generations: classic AIza… keys and the newer AI Studio
 * "auth keys" that start with AQ., both are valid Gemini API keys. They hit the exact
 * same endpoints; what differs is the carrier. Classic keys ride the ?key= query param;
 * AQ auth keys ride the documented x-goog-api-key header. Choosing by prefix keeps both
 * generations on one code path with zero guesswork.
 */
export function geminiFetchTarget(
  key: string,
  pathAndQuery: string
): { url: string; headers: Record<string, string> } {
  const k = key.trim()
  if (/^AIza/.test(k)) {
    const sep = pathAndQuery.includes('?') ? '&' : '?'
    return { url: `${BASE}${pathAndQuery}${sep}key=${encodeURIComponent(k)}`, headers: {} }
  }
  return { url: `${BASE}${pathAndQuery}`, headers: { 'x-goog-api-key': k } }
}

/** Pool cache, PER KEY (a user key and the platform key can see different model
 * lists), verified against ListModels, refreshed on this TTL. The pool is the FULL
 * ranked list of usable flash models, not one winner: Google's free-tier quota is
 * PER MODEL (GenerateRequestsPerDayPerProjectPerModel), so spreading the day's
 * calls across N models multiplies daily capacity N times over. */
const MODEL_TTL_MS = 30 * 60 * 1000
const modelCache = new Map<string, { models: string[]; at: number }>()
function keyTag(key: string): string {
  return `${key.slice(0, 8)}:${key.slice(-4)}`
}

/** Round-robin cursor per key, consecutive calls start on different models so
 * bursts land on separate RPM buckets and the day spreads across separate RPD buckets. */
const poolCursor = new Map<string, number>()

/** Latency discipline for the search path: Google's current full flash alias is a
 * thinking model whose quiet minutes don't fit a 22s scan budget. Lite models skip
 * extended thinking by design, so when speed matters they lead the pool and the
 * round-robin spreads the day across the fast buckets first. */
function liteFirst(models: string[]): string[] {
  const lite = models.filter((m) => /lite/i.test(m))
  return [...lite, ...models.filter((m) => !/lite/i.test(m))]
}

/**
 * Per-model thinking control, named generations only (aliases stay untouched,
 * their generation is unknown). 2.5 models accept thinkingBudget 0 = thinking off;
 * 3.x models take thinkingLevel low. Returns null when the model should run stock.
 */
export function thinkingConfigFor(model: string): Record<string, unknown> | null {
  if (/^gemini-2\.5/.test(model)) return { thinkingBudget: 0 }
  if (/^gemini-3\./.test(model)) return { thinkingLevel: 'low' }
  return null
}

/**
 * Drained or blocked keys must not tax every request: after a key-level failure
 * (invalid, 403) or a per-day quota wall, the key sits out a cooldown on the bench
 * while the other key answers. Without this, one drained key under Integrations
 * made EVERY AI call pay its 429s before the platform key got a turn. In-memory
 * per serverless instance; a fresh instance retries the bench key at worst once.
 */
const KEY_COOLDOWN_MS = 10 * 60_000
const keyCooldown = new Map<string, number>()
function keyBenched(key: string): boolean {
  const until = keyCooldown.get(keyTag(key))
  if (!until) return false
  if (Date.now() >= until) {
    keyCooldown.delete(keyTag(key))
    return false
  }
  return true
}
function benchKey(key: string): void {
  keyCooldown.set(keyTag(key), Date.now() + KEY_COOLDOWN_MS)
}

/**
 * Per-(key,model) quota bench: a 429 that names a DAY bucket, or a ZERO free-tier
 * limit for this model on this project, will not clear inside this request, nor
 * within a minute. Without this bench the drained model sits at the head of every
 * later walk: pure latency tax plus pointless request volume. A day bucket rides
 * the bench 30 minutes; a zero limit (needs billing or a different project, it
 * never self-heals) six hours. A PER MINUTE wall rides a short 65 second bench:
 * it clears itself in about a minute, and benching stops repeated scans from
 * re paying the same 429 storm while the window refills. In-memory per serverless
 * instance, same as keyCooldown.
 */
const MODEL_QUOTA_COOLDOWN_MS = 30 * 60_000
const MODEL_QUOTA_COOLDOWN_ZERO_MS = 6 * 60 * 60_000
const MODEL_RATE_COOLDOWN_MS = 65_000
const modelQuotaCooldown = new Map<string, number>()
function modelQuotaTag(key: string, model: string): string {
  return `${keyTag(key)}|${model}`
}
function modelDrained(key: string, model: string): boolean {
  const until = modelQuotaCooldown.get(modelQuotaTag(key, model))
  if (!until) return false
  if (Date.now() >= until) {
    modelQuotaCooldown.delete(modelQuotaTag(key, model))
    return false
  }
  return true
}
function benchModelQuota(key: string, model: string, kind: 'day' | 'zero' | 'minute'): void {
  const ms =
    kind === 'zero'
      ? MODEL_QUOTA_COOLDOWN_ZERO_MS
      : kind === 'minute'
        ? MODEL_RATE_COOLDOWN_MS
        : MODEL_QUOTA_COOLDOWN_MS
  modelQuotaCooldown.set(modelQuotaTag(key, model), Date.now() + ms)
}
/** Google names the exhausted bucket with a numeric limit, 0 means no free tier for this model here. */
function quotaZeroLimit(raw: string): boolean {
  return /"limit":\s*"?0"?|limit:\s*0\b/i.test(raw)
}

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

export type GeminiResult =
  | { ok: true; text: string; /** Set when the user's own key failed and the platform key saved the answer. */ notice?: string }
  | { ok: false; error: string; notice?: string }

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
    ? ' This happened with your saved Gemini key. You can remove it under Integrations to use HustlePortal AI instead.'
    : ''
  switch (cls) {
    case 'KEY_INVALID':
      return `Your Gemini key was rejected by Google (invalid, deleted or mistyped).${own ? ' Update it under Integrations, or remove it to use HustlePortal AI.' : ' The platform AI key looks misconfigured. The operator has been alerted by this message.'}`
    case 'PERMISSION':
      return `Google blocked the AI request (403 Permission denied).${own ? ' Fastest fix: create a brand new key at aistudio.google.com/apikey and save it under Integrations. Or clear the key\'s API and website restrictions in Google Cloud console. HustlePortal AI covers you meanwhile.' : ' The platform AI key\'s Google project is currently restricted. A fresh project key is needed. You can add your own free Gemini key under Integrations to go live instantly.'}`
    case 'QUOTA':
      // Google names the drained bucket in the 429 body: a PER MINUTE wall
      // recovers in about a minute, everything else (a per DAY drain or a bare
      // project level wall) waits for the daily reset at midnight Pacific,
      // around 09:00 South African time. Saying "try again in a minute" to a
      // drained day sent the seller retrying against a wall for hours.
      if (/PerMinute/i.test(detail)) {
        return own
          ? 'Your saved Gemini key is pacing its free requests this minute. It refills on its own in about a minute, so one more try usually lands.'
          : 'The AI engine is pacing its free requests this minute. One more try usually lands.'
      }
      return own
        ? 'Your saved Gemini key has used its free daily search allowance for today. Google refills it around 09:00 South African time. Need more now? A brand new key in a brand new project at aistudio.google.com/apikey starts a fresh allowance right away.'
        : 'The free AI search allowance is used up for today. It refills around 09:00 South African time. Two faster options: add your own free Gemini key under Integrations for an instant fresh allowance, or try again after the reset.'
    case 'MODEL':
      // A retired model is NEVER the user's key's fault, no "YOUR key" suffix here.
      return 'Google is rotating its AI models right now and our fallbacks were momentarily unavailable. HustlePortal updates its model list automatically. Please try again in a minute.'
    case 'EMPTY':
      return 'Gemini returned an empty response. Try rephrasing, or attach a clearer image.'
    default:
      if (status === 503 || status === 500) {
        return 'Google is shedding free-tier traffic this minute (high demand). The engine rotates models on its own, so give it a moment and try again.'
      }
      return `The AI request failed unexpectedly (Google ${status}). Please try again in a minute.${own}`
  }
}

interface Failure {
  cls: ErrorClass
  ownKey: boolean
  status: number
  detail: string
}

/**
 * Surface the failure the user can actually DO something about, and, when BOTH
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

/** One compact line about what the OTHER key did, so both causes are visible at once. Never empty on a real second failure. */
function shortOtherCause(f: Failure): string {
  const who = f.ownKey ? 'Your own key' : 'HustlePortal AI'
  switch (f.cls) {
    case 'KEY_INVALID': return `(${who} was also rejected as invalid.)`
    case 'PERMISSION': return f.ownKey
      ? `(${who} was also blocked by Google. Enable the "Generative Language API" for the key, or create a fresh one at aistudio.google.com/apikey.)`
      : `(HustlePortal AI was also blocked by Google. A fresh key at aistudio.google.com/apikey is the fastest fix.)`
    case 'QUOTA': return `(${who} is also rate limited this minute. Waiting a minute usually clears it.)`
    case 'MODEL': return `(Google is also rotating its models right now.)`
    case 'EMPTY': return `(${who} also returned an empty answer.)`
    case 'OTHER':
      return /abort|timeout|TimeoutError/i.test(f.detail)
        ? `(${who} also ran out of time on that request. Retrying usually lands it.)`
        : `(${who} also failed. Try again in a minute.)`
    default: return ''
  }
}

/**
 * What can THIS key actually call right now? ListModels once per TTL, build the FULL
 * pool: every preference entry the key can see (alias-first, newest numbered flash
 * after), then any other flash-tier Gemini models visible, newest first. Discovery
 * is best-effort, any failure falls back to the static preference chain.
 */
async function resolveModels(key: string): Promise<string[]> {
  const now = Date.now()
  const hit = modelCache.get(keyTag(key))
  if (hit && now - hit.at < MODEL_TTL_MS) return hit.models
  try {
    const target = geminiFetchTarget(key, '/models?pageSize=1000')
    const res = await fetch(target.url, {
      headers: target.headers,
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const data = (await res.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[]
      }
      const usable = new Set(
        (data.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => (m.name || '').replace(/^models\//, ''))
      )
      const pool = [
        ...MODEL_PREFERENCE.filter((m) => usable.has(m)),
        // Any other flash-tier Gemini model the key can see, newest first, extra
        // daily buckets Google offers on this project. Gemma/Pro excluded (no search
        // grounding / too slow for the deadline); excluded families are hard no's.
        ...[...usable]
          .filter(
            (n) =>
              n.startsWith('gemini-') &&
              /flash/i.test(n) &&
              !/tts|image|embed|transcribe|robotics|computer|omni|banana|lyria|antigravity|customtools/i.test(n)
          )
          .filter((n) => !(MODEL_PREFERENCE as readonly string[]).includes(n))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
      ]
      if (pool.length > 0) {
        modelCache.set(keyTag(key), { models: pool, at: now })
        return pool
      }
    }
  } catch {
    // discovery is best-effort, fall through to the static chain
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
  timeoutMs: number,
  speed = false,
  trace?: string[]
): Promise<GeminiResult> {
  const keys: { key: string; ownKey: boolean }[] = []
  const userKey = await getUserGeminiKey(userId)
  if (userKey) keys.push({ key: userKey, ownKey: true })
  const platformKey = getPlatformGeminiKey()
  if (platformKey && platformKey !== userKey) keys.push({ key: platformKey, ownKey: false })
  if (keys.length === 0) {
    // No Gemini key anywhere does NOT mean no AI: the $0 backup rung may still
    // carry a plain text call (platform OpenRouter key or the seller's own).
    const or = await openrouterFromGeminiBody(userId, body, Math.min(timeoutMs, 16_000), trace)
    if (or && or.ok) {
      return { ok: true, text: or.text, notice: 'Heads up: the usual AI engine is not switched on for this account yet, so the free backup engine answered. Everything else works the same.' }
    }
    return {
      ok: false,
      error:
        'HustlePortal AI is not switched on yet. Try again soon, or add your own free Gemini key under Integrations to go live instantly.',
    }
  }

  // A benched (drained/blocked) key rides the BACK of the line, the healthy key
  // answers first and the notice still tells the truth about whose quota was used.
  const benchedCount = keys.filter((k) => keyBenched(k.key)).length
  const orderedKeys =
    benchedCount > 0 && benchedCount < keys.length
      ? [...keys.filter((k) => !keyBenched(k.key)), ...keys.filter((k) => keyBenched(k.key))]
      : keys

  const failures: Failure[] = []
  let userKeyFailure: Failure | null = null // remember WHY the user's key was bypassed → honest notice on fallback success
  let timedOut = false
  // Hard deadline for the WHOLE chain: per-attempt timeouts shrink as the clock
  // runs down, so (keys × models) can never stack past the caller's budget,
  // the single biggest cause of Vercel 504s on slow paths.
  const deadline = Date.now() + timeoutMs

  for (const { key, ownKey } of orderedKeys) {
    if (Date.now() >= deadline) break
    const discovered = await resolveModels(key)
    const pool = speed ? liteFirst(discovered) : discovered
    const usable = pool.filter((m) => !modelDrained(key, m))
    if (usable.length === 0) {
      // Every model on this key is inside a quota bench, say so honestly and
      // move to the next key without paying Google a single 429 for it.
      const f: Failure = { cls: 'QUOTA', ownKey, status: 429, detail: 'all models on this key are inside a quota cooldown' }
      failures.push(f)
      if (ownKey && !userKeyFailure) userKeyFailure = f
      continue
    }
    // Round-robin over the pool: consecutive calls start on a different model, so a
    // burst of scans lands on separate per-model RPM buckets and the whole day's
    // volume spreads across separate per-model DAY buckets. Capacity scales with
    // pool size instead of dying with one model's daily cap.
    const start = poolCursor.get(keyTag(key)) || 0
    poolCursor.set(keyTag(key), start + 1)
    const models = usable.map((_, i) => usable[(start + i) % usable.length])
    for (const model of models) {
      const remaining = deadline - Date.now()
      if (remaining <= 2_000) break
      const speedCfg = speed ? thinkingConfigFor(model) : null
      const genConfig = speedCfg
        ? { ...(body.generationConfig as Record<string, unknown>), thinkingConfig: speedCfg }
        : body.generationConfig
      const tModel = Date.now()
      try {
        const target = geminiFetchTarget(key, `/models/${model}:generateContent`)
        const res = await fetch(target.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...target.headers },
          body: JSON.stringify({ ...body, generationConfig: genConfig }),
          signal: AbortSignal.timeout(remaining),
        })
        if (!res.ok) {
          const raw = await res.text().catch(() => '')
          // Head plus the quota fields that name the EXHAUSTED bucket (daily vs
          // monthly, per model vs per project), that distinction decides the fix.
          const flat = raw.replace(/\s+/g, ' ')
          const quotaBits = [
            flat.match(/quotaId"\s*:\s*"[^"]+/)?.[0],
            flat.match(/quotaMetric"\s*:\s*"[^"]+/)?.[0],
            flat.match(/"limit"\s*:\s*"?[\d.]+/)?.[0],
            flat.match(/retryDelay"\s*:\s*"[^"]+/)?.[0],
          ].filter(Boolean).join(' | ')
          trace?.push(`gemini/${model} → ${res.status} (${Date.now() - tModel}ms) ${flat.slice(0, 1600)}${quotaBits ? ' || ' + quotaBits : ''}`)
          const cls = classify(res.status, raw)
          const failure: Failure = { cls, ownKey, status: res.status, detail: raw }
          failures.push(failure)
          if (ownKey && !userKeyFailure) userKeyFailure = failure
          // A cached pool that Google just changed, evict so the next request re-discovers.
          if (cls === 'MODEL') modelCache.delete(keyTag(key))
          // Key-level fatals bench the key: a 403/invalid key rejects EVERY model.
          // A PerDay 429 does NOT bench the key any more, the per-model bench below
          // retires exactly the drained model and its pool siblings keep answering.
          if (cls === 'KEY_INVALID' || cls === 'PERMISSION') {
            benchKey(key)
            break
          }
          if (cls === 'QUOTA') {
            // Bench the drained bucket so later walks skip straight to models
            // with headroom: a DAY wall (or a zero free tier limit) rides the
            // long bench, a MINUTE wall rides the short one so repeated scans
            // stop re paying the same 429 storm while the window refills.
            const zero = quotaZeroLimit(raw)
            if (/PerDay/i.test(raw) || zero) benchModelQuota(key, model, zero ? 'zero' : 'day')
            else if (/PerMinute/i.test(raw)) benchModelQuota(key, model, 'minute')
            // A 429 with NO named bucket (bare RESOURCE_EXHAUSTED, no quotaId in the
            // body) is a PROJECT-level wall, every sibling model shares it, so
            // walking the pool would just hammer Google. Break the walk WITHOUT
            // benching the key: ungrounded calls (mail, OCR) share the project but
            // not this bucket, and they are still healthy.
            if (!/quotaId|QuotaFailure|PerDay|PerMinute/i.test(raw)) {
              break
            }
            // 429 is a PER-MODEL quota bucket on free tier, not key-wide: the next
            // Flash model usually still has headroom, so rotate instead of giving
            // up. (The old park and retry after Google's named delay is retired:
            // benching plus rotation keeps the same recovery odds without parking
            // a scan for up to 8 seconds per drained model.)
            continue // next model, separate quota bucket
          }
          // Model-level problems (404 etc.): try the next model on this key.
          continue
        }
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[]
        }
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
        if (!text.trim()) {
          trace?.push(`gemini/${model} → ${res.status} (${Date.now() - tModel}ms) empty response`)
          const failure: Failure = { cls: 'EMPTY', ownKey, status: res.status, detail: '' }
          failures.push(failure)
          if (ownKey && !userKeyFailure) userKeyFailure = failure
          continue
        }
        trace?.push(`gemini/${model} → ${res.status} (${Date.now() - tModel}ms) ok`)
        // Pool freshness is owned by the TTL cache, nothing to rewrite on success.
        // The user's own key was bypassed but the platform saved the answer, say so,
        // once, gently: the app stayed seamless AND the user learns their key needs care.
        const notice =
          userKeyFailure && !ownKey
            ? `Heads up: your own Gemini key was ${userKeyFailure.cls === 'PERMISSION' ? 'blocked by Google' : userKeyFailure.cls === 'KEY_INVALID' ? 'rejected as invalid' : userKeyFailure.cls === 'QUOTA' ? 'rate limited' : 'unavailable'}. This answer came from HustlePortal AI. You can fix or remove your key under Integrations.`
            : undefined
        return { ok: true, text, ...(notice ? { notice } : {}) }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Gemini request failed'
        trace?.push(`gemini/${model} → network (${Date.now() - tModel}ms) ${msg.slice(0, 120)}`)
        const failure: Failure = { cls: 'OTHER', ownKey, status: 0, detail: msg }
        failures.push(failure)
        if (ownKey && !userKeyFailure) userKeyFailure = failure
        if (/abort|timeout|TimeoutError/i.test(msg)) { timedOut = true; break }
      }
    }
    if (timedOut) break // connectivity problem, don't hammer the chain
  }

  // $0 BACKUP RUNG (OpenRouter free models): the whole Gemini walk failed, but a
  // PLAIN TEXT, ungrounded call can still be carried at zero cost by the free
  // engine inside the caller's remaining deadline. Vision and search grounded
  // bodies are refused by the bridge itself (no pixels, no browsing on free
  // models, the anti fabrication law holds), and when the bridge also fails the
  // ORIGINAL Gemini error stays the final word: Google's cause is the actionable
  // one, the backup's noise never buries it.
  const left = deadline - Date.now()
  if (left > 5_000) {
    const or = await openrouterFromGeminiBody(userId, body, Math.min(left, 16_000), trace)
    if (or && or.ok) {
      const notice = userKeyFailure
        ? `Heads up: your own Gemini key was ${userKeyFailure.cls === 'PERMISSION' ? 'blocked by Google' : userKeyFailure.cls === 'KEY_INVALID' ? 'rejected as invalid' : 'rate limited'}. This answer came from the free backup engine, so nothing stopped.`
        : 'Heads up: the daily AI allowance was out, so the free backup engine answered this one. It refills around 09:00 South African time.'
      return { ok: true, text: or.text, notice }
    }
  }

  return { ok: false, error: bestError(failures) }
}

export async function geminiGenerate(
  userId: string,
  opts: { system?: string; prompt: string; json?: boolean; search?: boolean; history?: GeminiHistoryTurn[]; timeoutMs?: number; maxOutputTokens?: number; trace?: string[] },
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
      // Callers producing big structured payloads (site analysis with 3 pitches,
      // business plans) MUST be able to raise this, a truncated JSON document
      // fails to parse and reads to the user as "the AI could not read the page".
      maxOutputTokens: opts.maxOutputTokens ?? (opts.search ? 2000 : 1200),
      // NOTE: JSON mime mode is incompatible with search grounding on many model
      // versions, when searching, we ask for raw JSON in the prompt and parse loosely.
      ...(opts.json && !opts.search ? { responseMimeType: 'application/json' } : {}),
    },
    // Real-world grounding: Google Search results the model actually saw (real businesses).
    ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
  }
  return callGemini(userId, body, opts.timeoutMs ?? (opts.search ? 55_000 : 30_000), Boolean(opts.search), opts.trace)
}

/**
 * Vision call, extract structured data from a photo/screenshot (OCR+understanding).
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

export interface GeminiKeyValidation {
  ok: boolean
  status: 'OK' | 'BLOCKED_403' | 'INVALID' | 'QUOTA' | 'UNREACHABLE'
  message: string
}

/**
 * Probe a candidate user-supplied Gemini key with ListModels (cheap, fast, and it
 * exercises the exact same authorization surface as generateContent). Called when a
 * key is saved under Integrations so a Google-blocked key is flagged in the SAME
 * minute it's pasted, not three screens later when a scan fails.
 */
export async function validateGeminiKey(key: string): Promise<GeminiKeyValidation> {
  const k = key.trim()
  // Two valid generations: classic AIza… (about 39 chars) and the newer AI Studio
  // auth keys starting with AQ. (longer). The ListModels probe below is the real
  // verdict, the shape check only catches obvious paste mistakes.
  if (!/^(AIza[0-9A-Za-z_-]{30,}|AQ\S{30,})$/.test(k)) {
    return {
      ok: false,
      status: 'INVALID',
      message: 'That does not look like a Gemini API key. Valid keys start with "AIza" (classic) or "AQ." (the newer AI Studio auth key). Copy the full key from aistudio.google.com/apikey.',
    }
  }
  try {
    const target = geminiFetchTarget(k, '/models?pageSize=1')
    const res = await fetch(target.url, {
      headers: target.headers,
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      return { ok: true, status: 'OK', message: 'Key verified with Google, AI will run on your own quota, with HustlePortal AI as automatic backup.' }
    }
    const raw = await res.text().catch(() => '')
    const cls = classify(res.status, raw)
    if (cls === 'PERMISSION') {
      return {
        ok: false,
        status: 'BLOCKED_403',
        message: 'Google blocked this key (403 Permission denied). Fastest fix: create a brand-new key at aistudio.google.com/apikey, new AI Studio keys work instantly. Or in Google Cloud console, enable the "Generative Language API" for this key\'s project and remove any API/website restrictions on the key. HustlePortal AI covers you meanwhile.',
      }
    }
    if (cls === 'QUOTA') {
      return { ok: false, status: 'QUOTA', message: 'The key works but its project is rate-limited right now. It will start working as soon as the quota window clears.' }
    }
    return {
      ok: false,
      status: 'INVALID',
      message: 'Google rejected this key (invalid, deleted or mistyped). Copy it again from aistudio.google.com/apikey, or just remove it to ride HustlePortal AI.',
    }
  } catch {
    return { ok: false, status: 'UNREACHABLE', message: 'Could not reach Google to verify the key just now, it was saved and will be used as-is.' }
  }
}
