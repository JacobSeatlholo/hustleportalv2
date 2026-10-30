/**
 * tregverify.ts — DOOR 3C, the mailbox gate at the till.
 *
 * The reveal already refuses to sell an address whose DOMAIN is provably dead
 * (reach.ts, free DNS). This file adds the finer promise the DNS gate cannot
 * make: does the MAILBOX behind the address actually accept mail? One call to
 * millionverifier through the team's treg.to account answers it for $0.00178
 * (R0.03) — 0.2% of a R15 reveal, measured on our own pool on 2026-10-31
 * (15 pool emails, dual-provider: download/treg_verification_test_2026-10-31.md).
 *
 * The three honesty rules this file lives by:
 *  1. FAIL OPEN. treg down, token missing, balance dry, timeout — every
 *     failure reads 'unknown' and the reveal behaves exactly as before this
 *     file existed. A paid feature must never break because its safety net
 *     hiccuped, and an 'unknown' is never punished (same law as reach.ts).
 *  2. PAY ONCE PER EMAIL, PLATFORM-WIDE. Verdicts are cached in memory per
 *     instance AND durably in PlatformConfig (same home as REVEAL_STATS), so
 *     the first reveal that meets an email pays the R0.03 and every reveal
 *     after reads it free. The cache never grows unbounded and never holds
 *     'unknown' — an unknown is a non-answer, not a fact worth storing.
 *  3. ONLY PROOF KILLS. 'invalid' is the only verdict that strips an email
 *     (the provider PROVED the mailbox does not exist). 'catch_all' means the
 *     domain accepts anything, so it proves nothing either way: the email
 *     stays, it just never earns the mailbox-verified bonus.
 *
 * Transport is the team token over treg's MCP endpoint (Authorization: Bearer)
 * — one credential, no per-provider keys, cost rides back in the receipt.
 * The token lives in TREG_TOKEN; no token means this whole file is a no-op.
 */

const TREG_MCP_URL = 'https://treg.to/mcp/'
const TREG_TOKEN = (process.env.TREG_TOKEN || '').trim()
export const tregEnabled = TREG_TOKEN.length > 20

/** The one provider the reveal gate pins: cheapest verified-verdict per success in the catalog, misses on catch-all/unknown settle at $0. */
const VERIFY_ENDPOINT = 'millionverifier.people.email.verify'

export type MailVerdict = 'valid' | 'invalid' | 'catch_all' | 'unknown'

export interface MailVerifyResult {
  verdict: MailVerdict
  /** What the call cost us in USD micros (0 on cache hits and failures). */
  costMicro: number
  /** True when the answer came from a cache, not the provider. */
  cached: boolean
  /** treg's call id, for the ledger and support. */
  callId?: string
  /** Set only on fail-open paths, so the operator's logs say WHY. */
  error?: string
}

// ---------- verdict shape ----------

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normalize(raw?: string | null): MailVerdict {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'ok' || v === 'valid') return 'valid'
  if (v === 'invalid') return 'invalid'
  if (v === 'catch_all' || v === 'accept_all' || v === 'catch-all') return 'catch_all'
  return 'unknown'
}

// ---------- caches: instance memory, then the platform's shared memory ----------

const TTL_MS: Record<Exclude<MailVerdict, 'unknown'>, number> = {
  valid: 14 * 24 * 60 * 60 * 1000, // a live mailbox stays live for a fortnight
  invalid: 7 * 24 * 60 * 60 * 1000, // dead mailboxes do come back sometimes
  catch_all: 3 * 24 * 60 * 60 * 1000, // the least trustworthy verdict of the three
}
const TTL_UNKNOWN_MS = 20 * 60 * 1000 // provider trouble retries quickly

const memCache = new Map<string, { verdict: MailVerdict; at: number }>()
const inflight = new Map<string, Promise<MailVerifyResult>>()

const DURABLE_KEY = 'TREG_EMAIL_VERDICTS'
const DURABLE_TTL_MS: Record<Exclude<MailVerdict, 'unknown'>, number> = {
  valid: 30 * 24 * 60 * 60 * 1000,
  invalid: 14 * 24 * 60 * 60 * 1000,
  catch_all: 7 * 24 * 60 * 60 * 1000,
}
const DURABLE_MAX = 4_000 // entries; the oldest leave first so the row can never bloat

type DurableEntry = { v: MailVerdict; at: number; c?: number }

function memKey(email: string): string {
  return email.trim().toLowerCase()
}

function memGet(email: string): MailVerdict | null {
  const hit = memCache.get(memKey(email))
  if (!hit) return null
  const ttl = hit.verdict === 'unknown' ? TTL_UNKNOWN_MS : TTL_MS[hit.verdict]
  if (Date.now() - hit.at > ttl) {
    memCache.delete(memKey(email))
    return null
  }
  return hit.verdict
}

/** The shared verdict store. Best effort in both directions: a read miss or a
 * write failure falls straight through to the live call, never blocks a reveal. */
async function durableRead(email: string): Promise<DurableEntry | null> {
  try {
    const { db } = await import('@/lib/db')
    const row = await db.platformConfig.findUnique({ where: { key: DURABLE_KEY } })
    if (!row?.value) return null
    const store = JSON.parse(row.value) as Record<string, DurableEntry>
    const e = store[memKey(email)]
    if (!e) return null
    const ttl = e.v === 'unknown' ? TTL_UNKNOWN_MS : DURABLE_TTL_MS[e.v]
    if (!ttl || Date.now() - e.at > ttl) return null
    return e
  } catch {
    return null
  }
}

async function durableWrite(email: string, entry: DurableEntry): Promise<void> {
  try {
    const { db } = await import('@/lib/db')
    const row = await db.platformConfig.findUnique({ where: { key: DURABLE_KEY } })
    let store: Record<string, DurableEntry> = {}
    if (row?.value) {
      try {
        store = JSON.parse(row.value)
      } catch {}
    }
    store[memKey(email)] = entry
    const keys = Object.keys(store)
    if (keys.length > DURABLE_MAX) {
      keys.sort((a, b) => (store[a].at || 0) - (store[b].at || 0))
      for (const k of keys.slice(0, keys.length - DURABLE_MAX)) delete store[k]
    }
    await db.platformConfig.upsert({
      where: { key: DURABLE_KEY },
      update: { value: JSON.stringify(store) },
      create: { key: DURABLE_KEY, value: JSON.stringify(store) },
    })
  } catch {
    // The durable cache is an optimisation; its failure must never fail a reveal.
  }
}

// ---------- the transport: one JSON-RPC tools/call, stateless ----------

interface TregReceipt {
  status?: number
  cost_usd?: number | null
  call_id?: string
  body?: { result?: string; status?: string; subresult?: string } | null
  whose_error?: string
  retry_after?: number | null
  error?: string | null
  detail?: string | null
}

async function mcpCall(endpointId: string, args: Record<string, unknown>, timeoutMs: number): Promise<TregReceipt | null> {
  const res = await fetch(TREG_MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TREG_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'call', arguments: { endpoint_id: endpointId, ...args } },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`treg http ${res.status}`)
  const json = (await res.json()) as { result?: { structuredContent?: TregReceipt; isError?: boolean } }
  return json.result?.structuredContent ?? null
}

// ---------- the public doors ----------

/**
 * Is this mailbox real? Cached verdicts answer instantly; otherwise one
 * metered call decides. NEVER THROWS: every possible failure lands on the
 * fail-open 'unknown' with the reason attached for the console log.
 */
export async function tregVerifyEmail(email?: string | null, opts?: { timeoutMs?: number }): Promise<MailVerifyResult> {
  const addr = String(email || '').trim()
  if (!addr || !EMAIL_SHAPE.test(addr) || addr.length > 254) {
    return { verdict: 'invalid', costMicro: 0, cached: false } // junk shape: no call needed, the shape is the proof
  }
  if (!tregEnabled) return { verdict: 'unknown', costMicro: 0, cached: false, error: 'TREG_TOKEN not set' }

  const key = memKey(addr)
  const seen = memGet(addr)
  if (seen) return { verdict: seen, costMicro: 0, cached: true }

  // One flight per email per instance: two reveals racing the same new
  // business share the single paid call instead of paying twice.
  const running = inflight.get(key)
  if (running) return running

  const flight = (async (): Promise<MailVerifyResult> => {
    const durable = await durableRead(addr)
    if (durable) {
      memCache.set(key, { verdict: durable.v, at: Date.now() })
      return { verdict: durable.v, costMicro: 0, cached: true }
    }
    try {
      const receipt = await mcpCall(VERIFY_ENDPOINT, { method: 'GET', query: { email: addr } }, opts?.timeoutMs ?? 8_000)
      if (!receipt) throw new Error('treg returned no receipt')
      if (receipt.status !== 200) {
        throw new Error(`treg status ${receipt.status}${receipt.whose_error ? ` (${receipt.whose_error})` : ''}`)
      }
      const verdict = normalize(receipt.body?.result ?? receipt.body?.status)
      const costMicro = Math.round((receipt.cost_usd || 0) * 1_000_000)
      memCache.set(key, { verdict, at: Date.now() })
      if (verdict !== 'unknown') await durableWrite(addr, { v: verdict, at: Date.now(), c: costMicro })
      return { verdict, costMicro, cached: false, callId: receipt.call_id }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      console.warn('[tregverify] fail-open:', reason)
      memCache.set(key, { verdict: 'unknown', at: Date.now() })
      return { verdict: 'unknown', costMicro: 0, cached: false, error: reason }
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, flight)
  return flight
}

/** The team's prepaid treg balance in USD micros, or null when the token is missing / the call failed. The sweeper's tap before it spends. */
export async function tregBalanceMicro(): Promise<number | null> {
  if (!tregEnabled) return null
  try {
    const res = await fetch(TREG_MCP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TREG_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'balance', arguments: {} } }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { result?: { structuredContent?: { balance_micro?: number } } }
    const micro = json.result?.structuredContent?.balance_micro
    return typeof micro === 'number' ? micro : null
  } catch {
    return null
  }
}
