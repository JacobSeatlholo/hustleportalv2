import { db } from '@/lib/db'

/**
 * OpenRouter free engine, the ZERO COST backup rung of the AI chain.
 * OpenAI-compatible API at https://openrouter.ai/api/v1 (Bearer key).
 *
 * STRICT $0 LAW: this engine only ever calls models whose prompt AND completion
 * price are zero (the :free family). No credit is ever spent, no card touched.
 * The engine exists so a drained Google quota never leaves a seller with
 * nothing: whenever the Gemini walk comes back empty on a plain text call
 * (ranking, drafting, pitching, classifying), the free engine gets a turn.
 *
 * WHAT IT CAN NEVER DO (honest boundaries, same law as DeepSeek):
 *  - No web browsing. It never discovers businesses on its own and it is never
 *    asked to. Callers hand it REAL source records and it matches, scores and
 *    explains them; every caller re-validates contact facts against the source.
 *  - No images. Vision calls stay on the Gemini chain.
 *
 * FREE TIER MECHANICS (verified against OpenRouter's own docs, Oct 2026):
 *  - 20 requests per minute flat on :free models, per account.
 *  - Daily cap on :free requests: 50 a day while the account has bought fewer
 *    than 10 credits LIFETIME, 1,000 a day at 10 or more (permanent once crossed).
 *    GET /api/v1/key reports the exact counter (free_model_daily_requests), so
 *    save time validation can show the seller their real ceiling.
 *  - A 429 usually names the PROVIDER serving that model as full, not the
 *    account: routing to a different model is the correct response, waiting is not.
 *  - Failed requests still burn the daily allowance, so the walk caps its attempts.
 *  - TWO TRAPS the docs bury: an HTTP 200 can carry an error object in the body,
 *    and a 200 can carry an empty answer (a reasoning model that spent the whole
 *    budget thinking). Both are failures: check body.error before choices, and
 *    treat empty content as a miss, then move on.
 *
 * Key resolution: the user's own key first (their cap, their control), then the
 * platform key from the environment. A failing user key is never silently
 * swapped for the platform key.
 */

const BASE = 'https://openrouter.ai/api/v1'
const HEADERS_BASE: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Title': 'HustlePortal',
  'HTTP-Referer': 'https://www.hustleportal.online',
}

/** Families we trust for structured, low temperature work, best first. A
 * discovery hit outside these families still gets used, it just waits its turn. */
const FAMILY_PREFERENCE = [
  'moonshotai', 'deepseek', 'qwen', 'meta-llama', 'google', 'mistralai', 'nvidia', 'openrouter',
]

/** Verified :free slugs, the static chain when discovery itself fails. Verified
 * live on OpenRouter Oct 2026; discovery re ranks the real catalog every 30
 * minutes anyway, so a stale static entry costs nothing but a benched attempt.
 * The openrouter/free router is the last rung: it picks any healthy free model. */
const STATIC_FREE_CHAIN = ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'openrouter/free']

export type OpenrouterErrorReason = 'NO_KEY' | 'KEY_INVALID' | 'DAILY_CAP' | 'RATE' | 'BUSY' | 'EMPTY' | 'OTHER'

export type OpenrouterResult =
  | { ok: true; text: string; keySource: 'user' | 'platform'; model: string }
  | { ok: false; error: string; reason: OpenrouterErrorReason }

export async function getUserOpenrouterKey(userId: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: 'OPENROUTER_API_KEY' } },
  })
  return row?.value || null
}

/** Platform key from the environment (set once on the server by the operator). */
export function getPlatformOpenrouterKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null
}

/** Resolution order: the user's own key (their cap) → platform key → none. */
export async function resolveOpenrouterKey(
  userId: string
): Promise<{ key: string | null; source: 'user' | 'platform' | 'none' }> {
  const userKey = await getUserOpenrouterKey(userId)
  if (userKey) return { key: userKey, source: 'user' }
  const platformKey = getPlatformOpenrouterKey()
  if (platformKey) return { key: platformKey, source: 'platform' }
  return { key: null, source: 'none' }
}

/**
 * Free model discovery: one public GET (no key needed) every TTL, the FULL
 * ranked pool of zero cost text models. Ranking: preferred family first, then
 * the bigger context window, because ranking prompts carry whole lead lists.
 * Exclusions are hard no's: anything that is not a text out / text in model,
 * plus known reasoning first rungs that burn the whole budget thinking and
 * answer empty on tight max_tokens.
 */
const DISCOVERY_TTL_MS = 30 * 60_000
let discovery: { models: string[]; at: number } | null = null

interface OrModel {
  id?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

/** Exported for the harness and the diagnose page: the exact pool the walk rides. */
export async function resolveFreeModels(): Promise<string[]> {
  const now = Date.now()
  if (discovery && now - discovery.at < DISCOVERY_TTL_MS) return discovery.models
  try {
    const res = await fetch(`${BASE}/models`, { headers: HEADERS_BASE, signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      const data = (await res.json()) as { data?: OrModel[] }
      const free = (data.data || []).filter((m) => {
        const id = m.id || ''
        if (!id || !id.includes('/')) return false
        const zero = m.pricing?.prompt === '0' && m.pricing?.completion === '0'
        if (!zero && !id.endsWith(':free')) return false
        const outs = m.architecture?.output_modalities || ['text']
        const ins = m.architecture?.input_modalities || ['text']
        if (!outs.includes('text') || !ins.includes('text')) return false
        // Hard no's: non text modalities, moderation/classifier rungs, and the
        // families that refuse plain API calls outright (thinkingmachines models
        // answer 403 to every normal request, they serve agent harnesses only;
        // a 403 here would bench the whole KEY for a MODEL level refusal).
        // -vl families ride the same hard no: they are vision language models,
        // this chain never sends pixels, and on a text only ranking prompt they
        // answer slow or time out (the live scan evidence, Oct 2026).
        if (/tts|image|video|embed|moderation|safety|guard|rerank|transcribe|whisper|vision-only|omni|lyria|music|thinkingmachines|-reasoning|reasoning-only|thinking-only|-vl(?=$|:)/i.test(id)) return false
        return true
      })
      const ranked = free
        .map((m) => ({ id: m.id as string, ctx: m.context_length || 0 }))
        .sort((a, b) => {
          const fa = FAMILY_PREFERENCE.indexOf(a.id.split('/')[0])
          const fb = FAMILY_PREFERENCE.indexOf(b.id.split('/')[0])
          const pa = fa === -1 ? FAMILY_PREFERENCE.length : fa
          const pb = fb === -1 ? FAMILY_PREFERENCE.length : fb
          if (pa !== pb) return pa - pb
          return b.ctx - a.ctx
        })
        .slice(0, 8)
        .map((m) => m.id)
      if (ranked.length > 0) {
        discovery = { models: ranked, at: now }
        return ranked
      }
    }
  } catch {
    // discovery is best effort, the static chain takes over
  }
  return [...STATIC_FREE_CHAIN]
}

/**
 * Model benches, in memory per serverless instance (same discipline as the
 * Gemini and GLM chains): a provider that answered FULL rides a short bench so
 * the walk skips it while the window clears, a daily cap rides a long one, a
 * retired slug rides an hour. Benched models cost zero attempts, the walk goes
 * straight to the rungs that can actually answer.
 */
const RATE_BENCH_MS = 65_000
const CAP_BENCH_MS = 30 * 60_000
const MISSING_BENCH_MS = 60 * 60_000
const modelBench = new Map<string, number>()
function bench(model: string, ms: number): void {
  modelBench.set(model, Date.now() + ms)
}
function benched(model: string): boolean {
  const until = modelBench.get(model)
  if (!until) return false
  if (Date.now() >= until) {
    modelBench.delete(model)
    return false
  }
  return true
}

/** Key bench: an auth rejection benches the KEY (every model rejects), 10 minutes. */
const KEY_BENCH_MS = 10 * 60_000
const keyBench = new Map<string, number>()
function keyTag(key: string): string {
  return `${key.slice(0, 10)}:${key.slice(-4)}`
}
function keyBenched(key: string): boolean {
  const until = keyBench.get(keyTag(key))
  if (!until) return false
  if (Date.now() >= until) {
    keyBench.delete(keyTag(key))
    return false
  }
  return true
}

/** Brand voice error lines, honest about who fixes what. No dashes anywhere. */
function friendly(reason: OpenrouterErrorReason, status: number): string {
  switch (reason) {
    case 'KEY_INVALID':
      return 'That OpenRouter key was not accepted. Check the key saved under Integrations, or paste a fresh one from openrouter.ai/settings/keys.'
    case 'DAILY_CAP':
      return 'The free backup engine has used its daily request cap on this OpenRouter key. It refills at midnight UTC. HustlePortal AI carries the load meanwhile.'
    case 'RATE':
      return 'The free backup engine is pacing requests this minute. One more try usually lands.'
    case 'BUSY':
      return 'The free backup engine is busy right now. HustlePortal AI carries the load meanwhile.'
    case 'EMPTY':
      return 'The free backup engine returned an empty answer. HustlePortal AI carries the load meanwhile.'
    default:
      return `The free backup engine answered with status ${status}. HustlePortal AI carries the load meanwhile.`
  }
}

/**
 * One hardened walk: (user key → platform key) × (free model pool), deadline
 * driven. Attempt discipline: at most three model knocks per key, because even
 * a failed attempt burns the daily free allowance. The walk returns the FIRST
 * real answer and never invents one.
 */
export async function openrouterGenerate(
  userId: string,
  opts: { system?: string; prompt: string; temperature?: number; maxTokens?: number; timeoutMs?: number; trace?: string[] }
): Promise<OpenrouterResult> {
  const keys: { key: string; source: 'user' | 'platform' }[] = []
  const userKey = await getUserOpenrouterKey(userId)
  if (userKey) keys.push({ key: userKey, source: 'user' })
  const platformKey = getPlatformOpenrouterKey()
  if (platformKey && platformKey !== userKey) keys.push({ key: platformKey, source: 'platform' })
  if (keys.length === 0) {
    return { ok: false, error: 'No OpenRouter key is configured.', reason: 'NO_KEY' }
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 18_000)
  const pool = (await resolveFreeModels()).filter((m) => !benched(m))
  if (pool.length === 0) {
    return { ok: false, error: friendly('RATE', 429), reason: 'RATE' }
  }

  let worst: { error: string; reason: OpenrouterErrorReason; status: number } | null = null
  const rank = (r: OpenrouterErrorReason): number =>
    r === 'DAILY_CAP' ? 6 : r === 'KEY_INVALID' ? 5 : r === 'RATE' ? 4 : r === 'BUSY' ? 3 : r === 'EMPTY' ? 2 : 1

  for (const { key, source } of keys) {
    if (keyBenched(key)) continue
    let attempts = 0
    for (const model of pool) {
      const remaining = deadline - Date.now()
      // THE GUARANTEED LAST RUNG: the openrouter/free auto-router picks any
      // healthy free model server side, so it is the one knock that must never
      // be crowded out by dead discovery slugs. It rides OUTSIDE the three
      // knock budget (the deadline still rules); every other slug keeps the
      // failed attempts burn the daily allowance discipline.
      if (remaining < 4_000) break
      if (model !== 'openrouter/free' && attempts >= 3) break
      attempts += 1
      const at = Date.now()
      try {
        const res = await fetch(`${BASE}/chat/completions`, {
          method: 'POST',
          headers: { ...HEADERS_BASE, Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [
              ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
              { role: 'user', content: opts.prompt },
            ],
            temperature: opts.temperature ?? 0.4,
            max_tokens: opts.maxTokens ?? 1400,
            stream: false,
            // NOTE: no response_format here. Free providers disagree about
            // structured outputs and a 400 burns a daily attempt; callers
            // demand JSON in the prompt and parse loosely instead.
          }),
          // 10s per knock: free models that answer a 1400 token JSON ranking
          // do it well inside this, and a fat 16s timeout once ate the whole
          // walk's deadline before the router rung ever got its turn.
          signal: AbortSignal.timeout(Math.min(10_000, remaining)),
        })
        if (!res.ok) {
          const raw = await res.text().catch(() => '')
          opts.trace?.push(`or/${model} → ${res.status} (${Date.now() - at}ms) ${raw.replace(/\s+/g, ' ').slice(0, 160)}`)
          if (res.status === 401 || res.status === 403) {
            keyBench.set(keyTag(key), Date.now() + KEY_BENCH_MS)
            const f = { error: friendly('KEY_INVALID', res.status), reason: 'KEY_INVALID' as const, status: res.status }
            if (!worst || rank(f.reason) > rank(worst.reason)) worst = f
            break
          }
          if (res.status === 402) {
            // Negative balance: even :free models stop until the wallet is back above zero.
            const f = { error: 'The OpenRouter account behind this key is below zero, which blocks even the free models until it is topped up or the debt clears.', reason: 'DAILY_CAP' as const, status: res.status }
            if (!worst || rank(f.reason) > rank(worst.reason)) worst = f
            break
          }
          if (res.status === 429) {
            // Most 429s name the PROVIDER as full: bench that model short and move on.
            // A daily cap wall rides the long bench on every model of this key.
            const daily = /daily|free.model|allowed requests per day|free-model/i.test(raw)
            if (daily) {
              const f = { error: friendly('DAILY_CAP', 429), reason: 'DAILY_CAP' as const, status: res.status }
              if (!worst || rank(f.reason) > rank(worst.reason)) worst = f
              break
            }
            bench(model, RATE_BENCH_MS)
            const f = { error: friendly('RATE', 429), reason: 'RATE' as const, status: res.status }
            if (!worst || rank(f.reason) > rank(worst.reason)) worst = f
            continue
          }
          if (res.status === 404 || res.status === 400) {
            bench(model, MISSING_BENCH_MS)
            const f = { error: friendly('OTHER', res.status), reason: 'OTHER' as const, status: res.status }
            if (!worst || rank(f.reason) > rank(worst.reason)) worst = f
            continue
          }
          const f = { error: friendly(res.status >= 500 ? 'BUSY' : 'OTHER', res.status), reason: (res.status >= 500 ? 'BUSY' : 'OTHER') as OpenrouterErrorReason, status: res.status }
          if (!worst || rank(f.reason) > rank(worst.reason)) worst = f
          continue
        }
        // TRAP ONE: a 200 body can carry an error object instead of a choice.
        const data = (await res.json()) as {
          choices?: { message?: { content?: string | null } }[]
          error?: { message?: string; code?: number | string }
        }
        if (data.error) {
          opts.trace?.push(`or/${model} → 200-with-error (${Date.now() - at}ms) ${String(data.error.message || '').slice(0, 140)}`)
          bench(model, RATE_BENCH_MS)
          const f = { error: friendly('BUSY', 200), reason: 'BUSY' as const, status: 200 }
          if (!worst || rank(f.reason) > rank(worst.reason)) worst = f
          continue
        }
        const text = (data.choices?.[0]?.message?.content || '').trim()
        // TRAP TWO: a 200 with empty content (reasoning spent the whole budget).
        if (!text) {
          opts.trace?.push(`or/${model} → 200-empty (${Date.now() - at}ms)`)
          bench(model, RATE_BENCH_MS)
          const f = { error: friendly('EMPTY', 200), reason: 'EMPTY' as const, status: 200 }
          if (!worst || rank(f.reason) > rank(worst.reason)) worst = f
          continue
        }
        opts.trace?.push(`or/${model} → 200 (${Date.now() - at}ms) ok`)
        return { ok: true, text, keySource: source, model }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'request failed'
        const timedOut = /abort|timeout|timed out/i.test(msg)
        opts.trace?.push(`or/${model} → ${timedOut ? 'TIMEOUT' : 'NETWORK'} (${Date.now() - at}ms)`)
        // A slug that just ate the clock rides the short bench, the next scan
        // goes straight to rungs that can actually answer.
        if (timedOut) bench(model, RATE_BENCH_MS)
        const f = { error: friendly(timedOut ? 'BUSY' : 'OTHER', 0), reason: (timedOut ? 'BUSY' : 'OTHER') as OpenrouterErrorReason, status: 0 }
        if (!worst || rank(f.reason) > rank(worst.reason)) worst = f
      }
    }
  }
  return { ok: false, error: worst?.error || 'The free backup engine could not answer just now.', reason: worst?.reason || 'OTHER' }
}

/**
 * BRIDGE from the Gemini world: translate a Gemini shaped body (contents,
 * parts, systemInstruction, generationConfig) into OpenRouter messages, but
 * ONLY for plain text, ungrounded calls. Anything with an image part or a
 * google_search tool is refused here: the free engine can neither see pixels
 * nor browse, and a silent downgrade would break the anti fabrication law.
 */
export function geminiBodyIsTextOnlyUngrounded(body: Record<string, unknown>): boolean {
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      if (t && typeof t === 'object' && ('google_search' in (t as Record<string, unknown>) || 'googleSearch' in (t as Record<string, unknown>))) {
        return false
      }
    }
  }
  const contents = body.contents
  if (!Array.isArray(contents)) return false
  for (const c of contents) {
    const parts = (c as { parts?: unknown })?.parts
    if (!Array.isArray(parts)) continue
    for (const p of parts) {
      if (p && typeof p === 'object' && ('inline_data' in p || 'inlineData' in p)) return false
    }
  }
  return true
}

function geminiBodyToMessages(body: Record<string, unknown>): { system?: string; prompt: string; temperature?: number; maxTokens?: number } {
  const sys = body.systemInstruction as { parts?: { text?: string }[] } | undefined
  const system = (sys?.parts || []).map((p) => p.text || '').filter(Boolean).join('\n') || undefined
  const contents = Array.isArray(body.contents) ? body.contents : []
  const lines: string[] = []
  for (const c of contents) {
    const parts = (c as { parts?: { text?: string }[] })?.parts || []
    const text = parts.map((p) => p?.text || '').filter(Boolean).join('\n')
    if (text) lines.push(text)
  }
  const gen = (body.generationConfig || {}) as { temperature?: number; maxOutputTokens?: number }
  return { system, prompt: lines.join('\n\n'), temperature: gen.temperature, maxTokens: gen.maxOutputTokens }
}

/**
 * The hook the Gemini chain calls when its whole walk failed: translate, guard,
 * and give the free engine one turn inside the caller's remaining budget.
 * Returns null when the bridge does not apply (vision, grounded, no runway),
 * so the Gemini error contract stays the single source of truth.
 */
export async function openrouterFromGeminiBody(
  userId: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  trace?: string[]
): Promise<OpenrouterResult | null> {
  if (timeoutMs < 6_000) return null
  if (!geminiBodyIsTextOnlyUngrounded(body)) return null
  const t = geminiBodyToMessages(body)
  if (!t.prompt.trim()) return null
  return openrouterGenerate(userId, {
    system: t.system,
    prompt: t.prompt,
    temperature: t.temperature,
    maxTokens: t.maxTokens,
    timeoutMs: Math.min(16_000, timeoutMs),
    trace,
  })
}

export interface OpenrouterKeyInfo {
  isFreeTier: boolean
  dailyLimit: number | null
  dailyRemaining: number | null
  dailyUsed: number | null
}

export interface OpenrouterKeyValidation {
  ok: boolean
  message: string
  info?: OpenrouterKeyInfo
}

/**
 * Save time validation: shape check, then a REAL probe of GET /api/v1/key,
 * which reports the account's exact free tier status and the day's remaining
 * free requests. The verdict IS the toast, the same minute the key is pasted,
 * with the seller's true ceiling named instead of a vague promise.
 */
export async function validateOpenrouterKey(key: string): Promise<OpenrouterKeyValidation> {
  const k = key.trim()
  if (!/^sk-or-v1?-[A-Za-z0-9_-]{16,}$/.test(k)) {
    return {
      ok: false,
      message: 'That does not look like an OpenRouter API key. Keys start with sk-or- and come from openrouter.ai/settings/keys.',
    }
  }
  try {
    const res = await fetch(`${BASE}/key`, { headers: { ...HEADERS_BASE, Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10_000) })
    if (res.status === 401) {
      return { ok: false, message: 'OpenRouter rejected that key. Generate a fresh one at openrouter.ai/settings/keys and paste it again.' }
    }
    if (!res.ok) {
      return { ok: false, message: `OpenRouter answered with status ${res.status}. The key is saved, and the next AI call will try it.` }
    }
    const data = (await res.json()) as {
      data?: {
        is_free_tier?: boolean
        free_model_daily_requests?: { limit?: number | null; remaining?: number | null; used?: number | null }
      }
    }
    const d = data.data || {}
    const info: OpenrouterKeyInfo = {
      isFreeTier: Boolean(d.is_free_tier),
      dailyLimit: d.free_model_daily_requests?.limit ?? null,
      dailyRemaining: d.free_model_daily_requests?.remaining ?? null,
      dailyUsed: d.free_model_daily_requests?.used ?? null,
    }
    const capLine =
      info.dailyLimit !== null
        ? `${info.dailyRemaining ?? '?'} of ${info.dailyLimit} free requests left today`
        : 'free model access confirmed'
    return {
      ok: true,
      message: `Key verified with OpenRouter. ${capLine}. Whenever the main AI engines run dry, this key's free models carry the ranking and drafting at zero cost.`,
      info,
    }
  } catch {
    return { ok: false, message: 'Could not reach OpenRouter just now. The key is saved, and the next AI call will use it.' }
  }
}
