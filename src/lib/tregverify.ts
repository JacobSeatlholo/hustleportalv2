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
// TREG_TOKEN is the canonical name; TREG_API_TOKEN is accepted as an alias so
// a differently-named Vercel variable still lights the gate up instead of
// leaving it silently off.
const TREG_TOKEN = (process.env.TREG_TOKEN || process.env.TREG_API_TOKEN || '').trim()
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

// ---------- the call ledger: every paid call leaves a receipt ----------

const LEDGER_KEY = 'TREG_CALL_LEDGER'
const LEDGER_MAX = 200 // a ring; the oldest receipts fall off first

export interface TregLedgerEntry {
  id?: string // treg's call id, for support and the vendor bill
  e: string // the address that was verified
  v: MailVerdict
  c: number // what the call cost in USD micros
  via: 'reveal' | 'sweep' | string
  at: number
}

async function ledgerAdd(entry: TregLedgerEntry): Promise<void> {
  try {
    const { db } = await import('@/lib/db')
    const row = await db.platformConfig.findUnique({ where: { key: LEDGER_KEY } })
    let ring: TregLedgerEntry[] = []
    if (row?.value) {
      try {
        ring = JSON.parse(row.value) as TregLedgerEntry[]
      } catch {}
    }
    ring.push(entry)
    if (ring.length > LEDGER_MAX) ring = ring.slice(ring.length - LEDGER_MAX)
    await db.platformConfig.upsert({
      where: { key: LEDGER_KEY },
      update: { value: JSON.stringify(ring) },
      create: { key: LEDGER_KEY, value: JSON.stringify(ring) },
    })
  } catch {
    // The ledger is an optimisation for visibility; it must never fail a call.
  }
}

/** The most recent provider receipts, newest first. */
export async function tregCallLedger(limit = 25): Promise<TregLedgerEntry[]> {
  try {
    const { db } = await import('@/lib/db')
    const row = await db.platformConfig.findUnique({ where: { key: LEDGER_KEY } })
    const ring = row?.value ? (JSON.parse(row.value) as TregLedgerEntry[]) : []
    return ring.slice(-limit).reverse()
  } catch {
    return []
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
      // Hard budget ceiling on every routed call: no single verification may
      // ever cost more than one cent, whatever the waterfall tries. The pinned
      // millionverifier endpoint settles at $0.00178; this header is the
      // guardrail for the day the route wanders.
      'X-Treg-Route-Max-Cost': '0.01',
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
export async function tregVerifyEmail(
  email?: string | null,
  opts?: { timeoutMs?: number; via?: 'reveal' | 'sweep' }
): Promise<MailVerifyResult> {
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
      // The call-id ledger: every actual provider call leaves its receipt here
      // (id, address, verdict, charge) so the exec lens can show exactly what
      // the gate bought. Cached verdicts were free — they do not belong on a
      // spend ledger, and unknowns bought nothing.
      if (receipt.call_id || costMicro > 0) {
        await ledgerAdd({ id: receipt.call_id, e: addr, v: verdict, c: costMicro, via: opts?.via || 'reveal', at: Date.now() })
      }
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

/** The team's prepaid treg balance in USD micros, or null when the token is missing / the call failed. The sweeper's tap before it spends. Instance-cached for a minute so dashboard refreshes never hammer the balance endpoint; pass fresh to force a live read. */
let balCache: { micro: number; at: number } | null = null
export async function tregBalanceMicro(opts?: { fresh?: boolean }): Promise<number | null> {
  if (!tregEnabled) return null
  if (!opts?.fresh && balCache && Date.now() - balCache.at < 60_000) return balCache.micro
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
    if (typeof micro === 'number') {
      balCache = { micro, at: Date.now() }
      return micro
    }
    return null
  } catch {
    return null
  }
}

// ---------- the executive lens: what did the gate buy, what did it cost ----------

const DAY_MS = 86_400_000

function sastDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())
}

export interface TregExecSnapshot {
  enabled: boolean
  /** Where the token came from — 'env' when the deployment carries it. */
  tokenSource: 'env' | null
  /** Live team balance in USD micros; null when treg would not say. */
  balanceMicro: number | null
  /** The active pool's mailbox truth, counted. */
  pool: {
    /** Active rows that still hold a live-suspect email (not proved dead). */
    withEmail: number
    /** Mailbox proved live by the gate. */
    verified: number
    /** Catch-all domains: reachable, unverified — never the verified badge. */
    catchAll: number
    /** Active rows whose email was proved dead and stripped (emailDeadAt set). */
    dead: number
    /** withEmail rows the gate has not answered yet. */
    pending: number
  }
  /** The durable verdict store (TREG_EMAIL_VERDICTS): what the platform remembers and what that memory cost. */
  store: { valid: number; invalid: number; catchAll: number; entries: number; spendMicro: number }
  /** The call-id ledger: real provider calls, real charges. */
  ledger: {
    total: number
    paidCalls: number
    spendMicro: number
    lastAt: number | null
    recent: TregLedgerEntry[]
  }
  /** REVEAL_STATS gate doors: verdicts delivered and proved-dead finds, today and over the 30-day window. */
  stats: {
    today: { verify: number; verifyDead: number; costMicro: number }
    days30: { verify: number; verifyDead: number; costMicro: number }
  }
}

/**
 * One read of everything the owner needs to see the mailbox gate: is it on,
 * what is the team balance, how much of the pool wears proved mailbox truth,
 * what the last real calls bought and what they cost. Every part is
 * best-effort — a dead part returns its empty shape, never an error.
 */
export async function tregExecSnapshot(opts?: { ledgerTake?: number }): Promise<TregExecSnapshot> {
  const snap: TregExecSnapshot = {
    enabled: tregEnabled,
    tokenSource: tregEnabled ? 'env' : null,
    balanceMicro: null,
    pool: { withEmail: 0, verified: 0, catchAll: 0, dead: 0, pending: 0 },
    store: { valid: 0, invalid: 0, catchAll: 0, entries: 0, spendMicro: 0 },
    ledger: { total: 0, paidCalls: 0, spendMicro: 0, lastAt: null, recent: [] },
    stats: { today: { verify: 0, verifyDead: 0, costMicro: 0 }, days30: { verify: 0, verifyDead: 0, costMicro: 0 } },
  }
  const take = Math.max(0, Math.min(opts?.ledgerTake ?? 25, 100))

  await Promise.all([
    // The live balance; a slow treg must not drag the whole dashboard.
    tregBalanceMicro().then((m) => {
      snap.balanceMicro = m
    }),
    // Pool coverage: one light scan over the active pool's mailbox facts.
    (async () => {
      try {
        const { db } = await import('@/lib/db')
        const rows = await db.leadPool.findMany({
          where: { active: true },
          select: { email: true, emailDeadAt: true, verifyChecks: true },
        })
        for (const r of rows) {
          if (r.emailDeadAt) {
            snap.pool.dead++
            continue
          }
          if (!r.email) continue
          snap.pool.withEmail++
          let ok: boolean | undefined
          let catchAll: boolean | undefined
          try {
            const v = r.verifyChecks ? (JSON.parse(r.verifyChecks) as Record<string, unknown>) : {}
            ok = v.emailOk === true
            catchAll = v.emailCatchAll === true
          } catch {}
          if (ok) snap.pool.verified++
          else if (catchAll) snap.pool.catchAll++
          else snap.pool.pending++
        }
      } catch {}
    })(),
    // The durable verdict store + the call ledger share PlatformConfig.
    (async () => {
      try {
        const { db } = await import('@/lib/db')
        const [vRow, lRow] = await Promise.all([
          db.platformConfig.findUnique({ where: { key: DURABLE_KEY } }),
          db.platformConfig.findUnique({ where: { key: LEDGER_KEY } }),
        ])
        if (vRow?.value) {
          try {
            const store = JSON.parse(vRow.value) as Record<string, { v?: string; c?: number }>
            for (const e of Object.values(store)) {
              snap.store.entries++
              if (e.v === 'valid') snap.store.valid++
              else if (e.v === 'invalid') snap.store.invalid++
              else if (e.v === 'catch_all') snap.store.catchAll++
              snap.store.spendMicro += e.c || 0
            }
          } catch {}
        }
        if (lRow?.value) {
          try {
            const ring = JSON.parse(lRow.value) as TregLedgerEntry[]
            snap.ledger.total = ring.length
            snap.ledger.lastAt = ring.length ? ring[ring.length - 1].at : null
            for (const e of ring) {
              snap.ledger.spendMicro += e.c || 0
              if (e.c > 0) snap.ledger.paidCalls++
            }
            snap.ledger.recent = take > 0 ? ring.slice(-take).reverse() : []
          } catch {}
        }
      } catch {}
    })(),
    // The REVEAL_STATS gate doors, today + the whole 30-day window.
    (async () => {
      try {
        const { db } = await import('@/lib/db')
        const row = await db.platformConfig.findUnique({ where: { key: 'REVEAL_STATS' } })
        if (!row?.value) return
        const stats = JSON.parse(row.value) as Record<string, Record<string, number>>
        const today = sastDay()
        const oldest = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(
          new Date(Date.now() - 29 * DAY_MS)
        )
        for (const [day, s] of Object.entries(stats)) {
          if (day < oldest) continue
          snap.stats.days30.verify += s.verify || 0
          snap.stats.days30.verifyDead += s.verifyDead || 0
          snap.stats.days30.costMicro += s.verifyCostMicro || 0
          if (day === today) {
            snap.stats.today.verify = s.verify || 0
            snap.stats.today.verifyDead = s.verifyDead || 0
            snap.stats.today.costMicro = s.verifyCostMicro || 0
          }
        }
      } catch {}
    })(),
  ])

  return snap
}
