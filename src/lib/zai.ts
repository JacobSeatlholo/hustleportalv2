import { db } from '@/lib/db'

/**
 * GLM engine, pay as you go chat completions with REAL web search grounding.
 * OpenAI-compatible API, Bearer key. Two doors serve the same GLM family and
 * the keys look identical (id.secret), but each door only accepts its own:
 *   z.ai   → https://api.z.ai/api/paas/v4          (international platform)
 *   Zhipu  → https://open.bigmodel.cn/api/paas/v4  (China open platform)
 * Operators paste one key; the engine tries both doors before it says no, so
 * a key from either platform just works. Zhipu knocks first because a wrong
 * door auth error costs half a second, while a wrong door pacing walk costs
 * many; door memory then keeps the winner in front. Fabricated names never go
 * out: the Web Search in Chat tool grounds the model in live web results the
 * same way Gemini's google_search does.
 *
 * Cost honesty: one grounded lead scan costs roughly two cents (web search
 * tool use plus GLM tokens). Ten dollars of credits is hundreds of scans, and
 * the flash models at the end of the model walk are free on the Zhipu door,
 * so even an empty wallet keeps the demo alive.
 *
 * Key resolution: the user's own key first (their credits, their control), then
 * the platform key from the environment. A failing user key is never silently
 * swapped for the platform key, spending someone else's paid credits without
 * asking is not what a careful product does.
 *
 * The platform env var is canonically ZAI_API_KEY, but the operator is human:
 * friendly names like GLM_key are accepted too, so a key saved under a different
 * name still powers the engine instead of sitting invisible in the environment.
 */

const ENDPOINTS = [
  { id: 'zhipu' as const, base: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'z.ai' as const, base: 'https://api.z.ai/api/paas/v4' },
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

function orderedEndpoints(opts?: { search?: boolean }) {
  // SEARCH walks knock where the money lives first. The platform account sits
  // on z.ai international: its pocket holds the prepaid flash bundle and the
  // cash that pays the web search fee. The Zhipu door accepts the key too,
  // but its grounded walks stalled past every honest budget in the live
  // check (33s timeouts on both workhorse models), so letting it walk first
  // meant the funded door never got a knock at all - the walk clock ran out
  // one door before the money.
  if (opts?.search) {
    const zai = ENDPOINTS.find((e) => e.id === 'z.ai')!
    const rest = ENDPOINTS.filter((e) => e.id !== 'z.ai')
    return [zai, ...rest]
  }
  if (stickyEndpoint && Date.now() - stickyAt < STICKY_TTL && ENDPOINTS[0].id !== stickyEndpoint) {
    return [ENDPOINTS[1], ENDPOINTS[0]]
  }
  return [...ENDPOINTS]
}

function markSticky(endpoint: ZaiEndpointId) {
  stickyEndpoint = endpoint
  stickyAt = Date.now()
}

/**
 * Walk list, funded rungs first. GLM-5.3-Flash leads: the platform account
 * carries a prepaid 5.3 flash token bundle (100M, Nov 2026), so its rung
 * burns prepaid tokens and leaves the cash pocket for the web search fee,
 * which bills apart from model tokens. GLM-4.6 follows as the paid step-up
 * when a door refuses flash, then the 5.3 flagship for the doors that have
 * moved past 4.6, and the tail rungs stay free on the Zhipu door so a key
 * with zero credits still scans. A model error walks to the next entry; an
 * auth error skips straight to the other door (auth is door wide, never
 * model wide).
 */
const MODEL_PREFERENCE = ['glm-5.3-flash', 'glm-4.6', 'glm-5.3', 'glm-4.5-flash', 'glm-4-flash'] as const

/**
 * SEARCH walks never touch the flash rung. The live evidence is exhaustive:
 * glm-5.3-flash could not land one grounded scan in five fair attempts
 * (200 with empty content at 19s thinking on, then timeouts at 28s and 33s
 * thinking off, on both doors, with a clean business-intent query) while
 * glm-4.6 answered the same work in 9.2 seconds with real leads. Every scan
 * that re-paid flash's 33s of dead air stole the window from the rung that
 * actually delivers - and the hang bench expires between scans, so the tax
 * came back again and again. glm-4.6 leads (its tokens cost cash fractions
 * of a cent, the runway model's own assumption); the free Zhipu rungs stay
 * as the zero-credit survival net. Plain generation keeps flash first, where
 * it is fast and burns the prepaid bundle as designed.
 */
const SEARCH_MODEL_PREFERENCE = ['glm-4.6', 'glm-4.5-flash', 'glm-4-flash'] as const

const PROBE_MODELS = ['glm-4.6', 'glm-4.5-flash'] as const

export const ZAI_PROBE_MODEL = 'glm-4.6'

export type ZaiErrorReason = 'NO_KEY' | 'KEY_INVALID' | 'BALANCE' | 'RATE' | 'BUSY' | 'EMPTY' | 'OTHER'

export type ZaiResult =
  | { ok: true; text: string; keySource: 'user' | 'platform'; model: string; endpoint: ZaiEndpointId }
  | { ok: false; error: string; reason: ZaiErrorReason; endpoint?: ZaiEndpointId }

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
          ? // The international door documents STRING values for these flags
            // (its own samples send "True" and "5"); a boolean true can read as
            // an unknown value and switch the tool OFF silently - the model
            // then sees zero results and honestly answers with no leads, no
            // error anywhere. The live empty-answer scans are exactly that
            // shape, so the payload now matches the door's documented form.
            { enable: 'True', search_engine: 'search-prime', search_result: 'True', count: '10', content_size: 'high' }
          : { enable: true, count: 10 },
    },
  ]
}

/**
 * Read the door's own words from an error body, ONCE. The walk needs the code
 * and message to tell an empty wallet from real pacing, and the trace and the
 * status row need the actual words so the operator can act on what the door
 * said instead of a guess. Returned sanitized and short.
 */
async function readDoorError(res: Response): Promise<{ code: string; message: string; words: string | null }> {
  try {
    const ej = (await res.json()) as { error?: { code?: string | number; message?: string } } | null
    const code = String(ej?.error?.code ?? '')
    const message = String(ej?.error?.message ?? '')
    const words = message ? message.replace(/\s+/g, ' ').trim().slice(0, 120) : code || null
    return { code, message, words }
  } catch {
    return { code: '', message: '', words: null }
  }
}

function arrearsWords(door: { code: string; message: string }): boolean {
  return door.code === '1113' || /balance|arrears|insufficient|欠费/i.test(door.message)
}

/**
 * Search walk model bench: a model that hung the full attempt cap or answered
 * 400 with the web search tool attached is dead weight for SEARCH scans (the
 * live trace proved both: glm 4.5 flash hung ten seconds a door, glm 4 flash
 * 400ed on the tool payload). Bench the model so later scans skip straight to
 * the rungs that can actually answer. Plain (no search) walks are untouched:
 * free flash models answer plain generation all day.
 * In memory per serverless instance, same as the door memory.
 */
const SEARCH_BENCH_HANG_MS = 10 * 60_000
const SEARCH_BENCH_BAD_MS = 60 * 60_000
const searchModelBench = new Map<string, number>()

/**
 * Retired model bench: a door that answers 400 naming the model as unknown or
 * unsupported has retired that rung for EVERY walk, plain and search alike.
 * Without this, a retired flagship would tax every plain generation with a
 * knock that can never land. Keyed on the door's own words, so a payload
 * shape refusal (no model words in the message) never benches a healthy rung.
 */
const MODEL_MISSING_MS = 60 * 60_000
const missingModelBench = new Map<string, number>()
function modelRetired(model: string): boolean {
  const until = missingModelBench.get(model)
  if (!until) return false
  if (Date.now() >= until) {
    missingModelBench.delete(model)
    return false
  }
  return true
}
function isModelMissing(door: { code: string; message: string }): boolean {
  return /model|模型/i.test(door.message) && /not\s+exist|unknown|invalid|not\s+found|unsupported|不存在|不支持/i.test(door.message)
}
function searchBenched(model: string): boolean {
  const until = searchModelBench.get(model)
  if (!until) return false
  if (Date.now() >= until) {
    searchModelBench.delete(model)
    return false
  }
  return true
}

/**
 * Platform search pocket memory: the platform GLM wallet funds the web
 * search tool from its own cash pocket, topped up manually by the operator
 * (never auto charged). A search walk that ENDED ok on a platform key proves
 * the pocket pays, so for the next half hour the backup lane can be trusted
 * without re-proving itself; a walk that ended BALANCE (both doors refused
 * the tool) means the pocket is dry, so for five minutes scans skip the dead
 * knocks and hand those seconds to the lanes that can answer. Personal keys
 * are never memorized: their wallets are their owner's business. Both TTLs
 * self-heal: the dead flag expires so a fresh top up is picked up within
 * minutes, and the alive flag expires so a drained pocket is re-discovered
 * honestly instead of being trusted on stale proof.
 */
const PLATFORM_ALIVE_MS = 30 * 60_000
const PLATFORM_DEAD_MS = 5 * 60_000
let platformPocketAliveUntil = 0
let platformPocketDownUntil = 0

export function markPlatformSearchOutcome(
  source: 'user' | 'platform',
  ok: boolean,
  reason?: ZaiErrorReason
): void {
  if (source !== 'platform') return
  if (ok) {
    platformPocketAliveUntil = Date.now() + PLATFORM_ALIVE_MS
    platformPocketDownUntil = 0
  } else if (reason === 'BALANCE') {
    platformPocketDownUntil = Date.now() + PLATFORM_DEAD_MS
    platformPocketAliveUntil = 0
  }
}

/** True while the platform pocket is freshly known to refuse the search tool. */
export function platformPocketDown(): boolean {
  return Date.now() < platformPocketDownUntil
}

export async function zaiGenerate(
  userId: string,
  opts: { system?: string; prompt: string; history?: { role: 'user' | 'assistant'; content: string }[]; json?: boolean; search?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number; trace?: string[] }
): Promise<ZaiResult> {
  const { key, source } = await resolveZaiKey(userId)
  if (!key) {
    return { ok: false, error: 'No z.ai key is configured.', reason: 'NO_KEY' }
  }
  // JSON mime mode rides along only on plain calls: with the web search tool active
  // we ask for raw JSON in the prompt instead and parse loosely, exactly like the
  // Gemini path handles search plus JSON. History (chat continuity, the AI
  // Co-Founder fallback) rides between the system line and the new turn.
  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    ...(opts.history ?? []),
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
  // only the free flash rungs behind that door still deserve a knock. And a
  // paced door is exhausted too, because pacing is per door, never engine
  // wide: the other door may be perfectly healthy.
  const FREE_MODELS = new Set(['glm-4.5-flash', 'glm-4-flash'])
  let doorArrears = false
  let doorPaced = false
  // Billing refusals are per door, not per account: one login serves both
  // doors, but each platform keeps its own billing pocket, so a wallet
  // refusal on one door says nothing about the other. Count them across the
  // whole walk; only when BOTH doors refuse does the wallet become the
  // final word. (The live billing history proved the old one knock rule
  // wrong: a z.ai key with a paid resource pack was refused by the Zhipu
  // door's pocket and the walk never asked the z.ai door.)
  let arrearsDoors = 0
  for (const ep of orderedEndpoints({ search: opts.search })) {
    doorArrears = false
    doorPaced = false
    for (const model of opts.search ? SEARCH_MODEL_PREFERENCE : MODEL_PREFERENCE) {
      const remaining = deadline - Date.now()
      if (remaining < 4_000) {
        const b = pickWorst()
        return { ok: false, error: b.error, reason: b.reason }
      }
      if (doorArrears && !FREE_MODELS.has(model)) continue
      if (doorPaced) break
      if (modelRetired(model)) continue
      if (opts.search && searchBenched(model)) continue
      // Flash rungs answer fast or step aside: a hung free model must not eat
      // the budget the other door still needs. PAID rungs on a search walk get
      // a real window: a grounded GLM scan spends 20 to 40 seconds on search
      // rounds before the JSON answer (the live walk proved flash needs more
      // than 28s), so a Gemini-sized cap only produces timeouts.
      const attemptCap = FREE_MODELS.has(model) ? 10_000 : opts.search ? 33_000 : 28_000
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: opts.temperature ?? (opts.json ? 0.3 : 0.7),
        max_tokens: opts.maxTokens ?? 1200,
        stream: false,
        ...(opts.json && !opts.search ? { response_format: { type: 'json_object' } } : {}),
        ...(opts.search
          ? {
              tools: searchTool(ep.id),
              // Hybrid reasoning OFF on search walks. The live walk caught the
              // smoking gun: at a 900 token cap flash returned 200 at 19s with
              // EMPTY content (the cap went to thinking and tool rounds), and
              // with a fatter cap it just thought LONGER - timeouts at 28s and
              // 33s on both workhorse models and both doors. The search tool
              // does the grounding; the JSON report needs the model's answer,
              // not its essay. Documented GLM parameter on both doors.
              thinking: { type: 'disabled' },
            }
          : {}),
      }
      const at = Date.now()
      try {
        const res = await fetch(`${ep.base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          // A REAL grounded scan legitimately takes 15 to 25 seconds (search
          // plus a JSON report). The deadline guard above, not a tight cap
          // here, is what protects the caller's budget.
          signal: AbortSignal.timeout(Math.min(attemptCap, remaining)),
        })
        if (!res.ok) {
          const door = await readDoorError(res)
          opts.trace?.push(`${ep.id}/${model} → ${res.status} (${Date.now() - at}ms)${door.words ? ` "${door.words}"` : ''}`)
          // Auth is door wide: stop burning models here, knock on the other door.
          if (res.status === 401 || res.status === 403) {
            failures.push(friendly(res.status, ep.id))
            break
          }
          if (res.status === 429 || res.status === 402) {
            const arrears = arrearsWords(door)
            if (opts.search && arrears) {
              // The web search tool is billed apart from model tokens, and
              // each door bills from its own pocket. This door refused, so
              // stop paying its rungs and knock the other door once; only
              // when BOTH doors refuse does the wallet story become the
              // final answer. (One door's words no longer settle the walk:
              // the live billing history proved a paid pack on one platform
              // sits invisible to the other door.)
              arrearsDoors += 1
              if (arrearsDoors >= 2) {
                return {
                  ok: false,
                  error: 'Both GLM doors refused the web search tool for balance. A small top up or a search bundle on the billing page of the platform where your credits live brings web grounded scans back.',
                  reason: 'BALANCE',
                  endpoint: ep.id,
                }
              }
              break
            }
            if (arrears) {
              // Plain walk, empty pocket on this door: skip its paid rungs,
              // its free flash rungs may still answer plain generation.
              doorArrears = true
              continue
            }
            if (res.status === 429) {
              // Pacing is per door: stop knocking here, try the other door.
              doorPaced = true
              break
            }
          }
          // Other money and model errors: a 400 naming the model benches the
          // rung for every walk (a retired model id will not self heal), a 400
          // on a search walk benches the rung for search walks (a tool payload
          // this model refuses will not self heal either), then keep walking.
          if (res.status === 400) {
            if (isModelMissing(door)) missingModelBench.set(model, Date.now() + MODEL_MISSING_MS)
            if (opts.search) searchModelBench.set(model, Date.now() + SEARCH_BENCH_BAD_MS)
          }
          failures.push(friendly(res.status, ep.id))
          continue
        }
        opts.trace?.push(`${ep.id}/${model} → ${res.status} (${Date.now() - at}ms)`)
        const data = (await res.json()) as {
          choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[]
          model?: string
        }
        const choice = data.choices?.[0]
        const text = choice?.message?.content?.trim() || ''
        // Did the door actually search? With search_result on, the answer body
        // carries the result list beside choices; its size (or absence) is the
        // truth about whether the tool ran - an honest {"leads":[]} cannot
        // tell that story by itself, and a silently-off tool produces exactly
        // that shape.
        const ws = (data as { web_search?: unknown[] }).web_search
        if (opts.search) {
          const first = Array.isArray(ws) && ws.length ? ((ws[0] as { title?: string })?.title || '').slice(0, 80) : ''
          opts.trace?.push(
            `door search results: ${Array.isArray(ws) ? ws.length : 'no web_search field in answer'}${first ? ` (first: ${first})` : ''}`
          )
        }
        if (!text) {
          // A 200 with no content is a budget artifact more often than a model
          // fault: the rung spent its whole output cap on search rounds and
          // thinking and never reached the answer (finish_reason "length").
          // Say so in the trace, because an unexplained dark rung sends the
          // next diagnosis hunting in the wrong place.
          const why =
            choice?.finish_reason === 'length'
              ? 'hit its output cap before answering'
              : 'returned no content'
          opts.trace?.push(
            `${ep.id}/${model} → empty answer, ${why}${choice?.message?.reasoning_content ? ' (thinking present)' : ''}`
          )
          failures.push({ error: 'GLM returned an empty answer.', reason: 'EMPTY' })
          continue
        }
        markSticky(ep.id)
        return { ok: true, text, keySource: source === 'user' ? 'user' : 'platform', model: data.model || model, endpoint: ep.id }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'request failed'
        const timedOut = /abort|timeout|timed out/i.test(msg)
        opts.trace?.push(`${ep.id}/${model} → ${timedOut ? 'TIMEOUT' : 'NETWORK'} (${Date.now() - at}ms)`)
        if (timedOut) {
          // A hung model with the search tool attached is a known dead rung:
          // bench it for search walks so the next scan does not pay its wait.
          // But only when the rung burned its OWN cap - an abort by the walk
          // clock is the deadline doing its job, and benching an innocent
          // rung for that would sideline the paid step-up on busy afternoons.
          if (opts.search && remaining >= attemptCap)
            searchModelBench.set(model, Date.now() + SEARCH_BENCH_HANG_MS)
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

export interface ZaiSearchProbe {
  ok: boolean
  status: number | null
  words: string | null
  endpoint: ZaiEndpointId | null
}

/**
 * One search tool micro generation, for the status row and the diagnose page.
 * The plain probe can say Live while the web search tool is refused (it is
 * billed apart from model tokens), and scans need the tool, so the scan path
 * gets its own honest check. The prompt FORCES a real search invocation: a
 * trivial "Reply: OK" prompt lets the door answer 200 without ever executing
 * the tool, which once made an empty wallet look search ready. One tiny
 * grounded request on the sticky door first, the other door as backup, the
 * door's own words coming back so the operator reads the truth, not a guess.
 */
export async function probeZaiSearch(key: string, timeoutMs = 9_000): Promise<ZaiSearchProbe> {
  // Both doors get asked: one login serves both, and each platform bills
  // from its own pocket, so the first door's refusal must never hide an
  // answer from the other. The most informative refusal (billing beats
  // auth) comes back when both doors say no.
  const rank = (s: number) => (s === 402 ? 5 : s === 429 ? 4 : s === 401 || s === 403 ? 3 : 2)
  let worst: ZaiSearchProbe | null = null
  for (const ep of orderedEndpoints()) {
    try {
      const res = await fetch(`${ep.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 'glm-4.6',
          messages: [
            { role: 'user', content: 'Search the web for one current news headline from Johannesburg, then reply with it.' },
          ],
          max_tokens: 64,
          temperature: 0,
          stream: false,
          tools: searchTool(ep.id),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) {
        markSticky(ep.id)
        return { ok: true, status: 200, words: null, endpoint: ep.id }
      }
      const door = await readDoorError(res)
      const refused = arrearsWords(door)
      const probe: ZaiSearchProbe = {
        ok: false,
        status: res.status,
        words: refused ? 'not covered by the current balance' : door.words,
        endpoint: ep.id,
      }
      if (!worst || rank(probe.status ?? 0) > rank(worst.status ?? 0)) worst = probe
    } catch {
      // this door may be unreachable while the other is fine: try the next
    }
  }
  return worst ?? { ok: false, status: null, words: null, endpoint: null }
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
