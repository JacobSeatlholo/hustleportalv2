import { db } from '@/lib/db'

/**
 * GLM engine — pay as you go chat completions with REAL web search grounding.
 * OpenAI-compatible API, Bearer key. Two doors serve the same GLM family and
 * the keys look identical (id.secret), but each door only accepts its own:
 *   z.ai   → https://api.z.ai/api/paas/v4          (international platform)
 *   Zhipu  → https://open.bigmodel.cn/api/paas/v4  (China open platform)
 * Operators paste one key; the engine tries both doors before it says no, so
 * a key from either platform just works. Fabricated names never go out: the
 * Web Search in Chat tool grounds the model in live web results the same way
 * Gemini's google_search does.
 *
 * Cost honesty: one grounded lead scan costs roughly two cents (web search
 * tool use plus GLM tokens). Ten dollars of credits is hundreds of scans, and
 * the flash models at the end of the model walk are free on the Zhipu door,
 * so even an empty wallet keeps the demo alive.
 *
 * Key resolution: the user's own key first (their credits, their control), then
 * the platform key from the environment. A failing user key is never silently
 * swapped for the platform key — spending someone else's paid credits without
 * asking is not what a careful product does.
 *
 * The platform env var is canonically ZAI_API_KEY, but the operator is human:
 * friendly names like GLM_key are accepted too, so a key saved under a different
 * name still powers the engine instead of sitting invisible in the environment.
 */

const ENDPOINTS = [
  { id: 'z.ai' as const, base: 'https://api.z.ai/api/paas/v4' },
  { id: 'zhipu' as const, base: 'https://open.bigmodel.cn/api/paas/v4' },
]

export type ZaiEndpointId = (typeof ENDPOINTS)[number]['id']

/**
 * Door memory: the door that answered last keeps pole position for a while, so
 * a slow first door never eats the scan budget twice in a row. Module state
 * survives between requests on a warm server; a cold start just falls back to
 * the canonical order and pays the walk once.
 */
let stickyEndpoint: ZaiEndpointId | null = null
let stickyAt = 0
const STICKY_TTL = 10 * 60_000

function orderedEndpoints() {
  if (stickyEndpoint === 'zhipu' && Date.now() - stickyAt < STICKY_TTL) {
    return [ENDPOINTS[1], ENDPOINTS[0]]
  }
  return [...ENDPOINTS]
}

function markSticky(endpoint: ZaiEndpointId) {
  stickyEndpoint = endpoint
  stickyAt = Date.now()
}

/**
 * Walk list, cheap first. GLM-4.6 is the price/performance workhorse; newer
 * generations follow for when a model id is ever retired; the flash models at
 * the tail are free on the Zhipu door, so a key with zero credits still scans.
 * A model error walks to the next entry; an auth error skips straight to the
 * other door (auth is door wide, never model wide).
 */
const MODEL_PREFERENCE = ['glm-4.6', 'glm-4.7', 'glm-5.3-flash', 'glm-4.5-flash', 'glm-4-flash'] as const

const PROBE_MODELS = ['glm-4.6', 'glm-4.5-flash'] as const

export const ZAI_PROBE_MODEL = 'glm-4.6'

export type ZaiErrorReason = 'NO_KEY' | 'KEY_INVALID' | 'BALANCE' | 'RATE' | 'BUSY' | 'EMPTY' | 'OTHER'

export type ZaiResult =
  | { ok: true; text: string; keySource: 'user' | 'platform'; model: string; endpoint: ZaiEndpointId }
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
 * Surrounding quotes are stripped, because a quoted paste into an env var
 * console is the oldest key mistake in the book.
 */
const PLATFORM_ZAI_ENV_NAMES = ['ZAI_API_KEY', 'GLM_key', 'GLM_API_KEY', 'GLM_KEY', 'ZAI_KEY'] as const

export function getPlatformZaiKey(): string | null {
  for (const name of PLATFORM_ZAI_ENV_NAMES) {
    const raw = process.env[name]?.trim()
    if (!raw) continue
    const unquoted = raw.replace(/^["']+|["']+$/g, '').trim()
    if (unquoted) return unquoted
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
function friendly(status: number, endpoint: ZaiEndpointId): { error: string; reason: ZaiErrorReason } {
  const door = endpoint === 'z.ai' ? 'z.ai' : 'the Zhipu open platform'
  if (status === 401 || status === 403)
    return {
      error: 'That key was not accepted by either GLM door. Generate a fresh key on the API keys page of the platform where your credits live (z.ai or the Zhipu open platform) and save the full key.',
      reason: 'KEY_INVALID',
    }
  if (status === 402)
    return {
      error: `GLM credits on ${door} are used up. A top up on its billing page brings the engine back, and the free flash models may still carry a scan.`,
      reason: 'BALANCE',
    }
  if (status === 429)
    return {
      error: `GLM is pacing requests or the credits on ${door} need a top up. Give it a moment and run the scan again.`,
      reason: 'RATE',
    }
  if (status >= 500)
    return {
      error: 'GLM is busy right now. One more try usually lands.',
      reason: 'BUSY',
    }
  return {
    error: `GLM answered with status ${status}. One more try usually lands.`,
    reason: 'OTHER',
  }
}

/** Web Search in Chat tool payload: each door speaks a slightly different dialect. */
function searchTool(endpoint: ZaiEndpointId) {
  return [
    {
      type: 'web_search',
      web_search:
        endpoint === 'z.ai'
          ? { enable: true, search_engine: 'search-prime', search_result: true, count: 10, content_size: 'medium' }
          : { enable: true, count: 10 },
    },
  ]
}

/**
 * Arrears sniffing: GLM doors signal an empty wallet as HTTP 429 (Zhipu code
 * 1113) just like real pacing. The difference decides the walk: arrears means
 * the free flash rungs may still answer, true pacing means stop hammering.
 */
async function isArrears(res: Response): Promise<boolean> {
  try {
    const ej = (await res.json()) as { error?: { code?: string | number; message?: string } } | null
    const code = String(ej?.error?.code ?? '')
    const emsg = String(ej?.error?.message ?? '')
    return code === '1113' || /balance|arrears|insufficient|欠费/i.test(emsg)
  } catch {
    return false
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
  // timeoutMs is the TOTAL walk budget across doors and models; each attempt
  // gets a slice of what remains, so the caller's deadline is never blown.
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000)
  // The walk can end in several honest places (credits out on one door, key
  // unknown on the other). The MOST informative failure wins the final word:
  // a 402 or 429 proves a door accepted the key, so money and pacing outrank
  // an auth rejection in the story we tell the seller.
  const REASON_RANK: Record<ZaiErrorReason, number> = { NO_KEY: 0, BALANCE: 5, RATE: 4, KEY_INVALID: 3, BUSY: 2, EMPTY: 2, OTHER: 1 }
  const failures: { error: string; reason: ZaiErrorReason }[] = []
  const pickWorst = () =>
    failures.length
      ? failures.reduce((a, b) => (REASON_RANK[b.reason] > REASON_RANK[a.reason] ? b : a))
      : { error: 'GLM request failed', reason: 'OTHER' as ZaiErrorReason }
  // Once a door says the wallet is empty, its PAID rungs will say it again;
  // only the free flash rungs behind that door still deserve a knock.
  const FREE_MODELS = new Set(['glm-4.5-flash', 'glm-4-flash'])
  let doorArrears = false
  for (const ep of orderedEndpoints()) {
    doorArrears = false
    for (const model of MODEL_PREFERENCE) {
      const remaining = deadline - Date.now()
      if (remaining < 4_000) {
        const b = pickWorst()
        return { ok: false, error: b.error, reason: b.reason }
      }
      if (doorArrears && !FREE_MODELS.has(model)) continue
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: opts.temperature ?? (opts.json ? 0.3 : 0.7),
        max_tokens: opts.maxTokens ?? 1200,
        stream: false,
        ...(opts.json && !opts.search ? { response_format: { type: 'json_object' } } : {}),
        ...(opts.search ? { tools: searchTool(ep.id) } : {}),
      }
      try {
        const res = await fetch(`${ep.base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(12_000, remaining)),
        })
        if (!res.ok) {
          const f = friendly(res.status, ep.id)
          failures.push(f)
          // Auth is door wide: stop burning models here, knock on the other door.
          if (res.status === 401 || res.status === 403) break
          if (res.status === 429 || res.status === 402) {
            const arrears = await isArrears(res)
            if (arrears) {
              // Empty wallet on this door: skip its paid rungs, try its free
              // flash rungs, then move on without looking back.
              doorArrears = true
              continue
            }
            // True pacing is engine wide: do not hammer a paced engine, end
            // the walk now so the next attempt starts fresh.
            if (res.status === 429) {
              return { ok: false, error: f.error, reason: f.reason }
            }
          }
          // Other money and model errors: the free flash models behind the
          // same door may still answer, so keep walking.
          continue
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[]
          model?: string
        }
        const text = data.choices?.[0]?.message?.content?.trim() || ''
        if (!text) {
          failures.push({ error: 'GLM returned an empty answer.', reason: 'EMPTY' })
          continue
        }
        markSticky(ep.id)
        return { ok: true, text, keySource: source === 'user' ? 'user' : 'platform', model: data.model || model, endpoint: ep.id }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'request failed'
        if (/abort|timeout|timed out/i.test(msg)) {
          failures.push({ error: 'GLM took too long to answer. One more try is usually quicker.', reason: 'BUSY' })
          continue
        }
        failures.push({ error: 'Could not reach GLM just now. It retries on the next scan.', reason: 'OTHER' })
      }
    }
  }
  const b = pickWorst()
  return { ok: false, error: b.error, reason: b.reason }
}

export interface ZaiProbeOutcome {
  status: number | null
  endpoint: ZaiEndpointId | null
  raw: string | null
}

/**
 * Shared health probe for the status row, the save time verdict and the
 * diagnose page: a light shape check happens at the call sites, then a REAL
 * micro generation on the exact models the engine walks. Both doors are tried,
 * so a key from either platform reports the truth about itself.
 */
export async function probeZaiKey(
  key: string,
  timeoutMs = 15_000,
  opts: { search?: boolean } = {}
): Promise<ZaiProbeOutcome> {
  const deadline = Date.now() + timeoutMs
  // Most informative non 200 status wins: a 402 or 429 proves a door accepted
  // the key, which outranks a plain auth rejection for the verdict copy.
  const rank = (s: number) => (s === 402 ? 5 : s === 429 ? 4 : s === 401 || s === 403 ? 3 : s >= 500 ? 2 : 1)
  let worst: number | null = null
  let raw: string | null = null
  for (const ep of orderedEndpoints()) {
    for (const model of PROBE_MODELS) {
      const remaining = deadline - Date.now()
      if (remaining < 3_000) break
      try {
        const res = await fetch(`${ep.base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'Reply: OK' }],
            max_tokens: 8,
            temperature: 0,
            stream: false,
            ...(opts.search ? { tools: searchTool(ep.id) } : {}),
          }),
          signal: AbortSignal.timeout(Math.min(8_000, remaining)),
        })
        if (res.ok) {
          markSticky(ep.id)
          return { status: 200, endpoint: ep.id, raw: null }
        }
        // One body read only: it feeds both the raw words and the arrears check.
        const body = (await res.json().catch(() => null)) as { error?: { code?: string | number; message?: string } } | null
        if (worst === null || rank(res.status) > rank(worst)) {
          worst = res.status
          // The door's own words, for the operator's diagnose page.
          raw = body?.error?.message?.slice(0, 200) || body?.error?.code?.toString() || null
        }
        // Auth is door wide: stop burning models here, knock on the other door.
        if (res.status === 401 || res.status === 403) break
        // True pacing: stop probing, the walk above will tell the same story.
        if (res.status === 429) {
          const code = String(body?.error?.code ?? '')
          const emsg = String(body?.error?.message ?? '')
          const arrears = code === '1113' || /balance|arrears|insufficient|欠费/i.test(emsg)
          if (!arrears) return { status: res.status, endpoint: null, raw }
        }
      } catch {
        // this door may be unreachable while the other is fine: keep walking
      }
    }
  }
  return { status: worst, endpoint: null, raw }
}

export interface ZaiKeyValidation {
  ok: boolean
  message: string
}

/**
 * Save time validation: a light shape check, then a REAL micro generation via
 * the shared two door probe. The verdict IS the toast, the same minute the key
 * is pasted. The probe costs a fraction of a cent, same honest pattern as the
 * Gemini status probe.
 */
export async function validateZaiKey(key: string): Promise<ZaiKeyValidation> {
  const trimmed = key.trim()
  if (trimmed.length < 20 || /\s/.test(trimmed)) {
    return {
      ok: false,
      message: 'That does not look like a GLM API key. Copy the full key from the API keys page on the z.ai open platform (or the Zhipu open platform).',
    }
  }
  const probe = await probeZaiKey(trimmed)
  if (probe.status === 200) {
    return {
      ok: true,
      message:
        probe.endpoint === 'zhipu'
          ? 'Key verified on the Zhipu open platform. Lead discovery now runs on your own GLM credits, with live web search grounding and no Google quota.'
          : 'Key verified with z.ai. Lead discovery now runs on your own pay as you go credits, with live web search grounding and no Google quota.',
    }
  }
  if (probe.status === 401 || probe.status === 403) {
    return {
      ok: false,
      message: 'Neither GLM door accepted that key. Generate a fresh one on the API keys page of the platform where your credits live and paste it again.',
    }
  }
  if (probe.status === 402 || probe.status === 429) {
    return {
      ok: true,
      message: 'The key works, but GLM is pacing requests or the credits need a top up on the billing page. It will start working the moment credits land.',
    }
  }
  return { ok: false, message: `GLM answered with status ${probe.status ?? 'none'}. The key is saved and the next scan will try it.` }
}
