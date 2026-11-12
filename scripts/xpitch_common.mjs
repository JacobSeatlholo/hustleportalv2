/**
 * Shared plumbing for the daily fresh-leads sweep scripts.
 *
 * Every platform call rides the exec seat session (POST /api/auth login) and
 * the platform's own metered treg doors:
 *   - GET  /api/admin/exec/pool/verify  — the treg balance + probe budget read
 *   - POST /api/admin/exec/xpitch/search — one metered search + freshness caps
 *   - GET  /api/admin/exec/xpitch/review — the candidate queue (free)
 *
 * Credentials NEVER live in this repo: the runner exports OPS_SEAT_EMAIL and
 * OPS_SEAT_PASSWORD before invoking a script. Missing or stale credentials
 * fail fast with exit code 2 and zero spend.
 */

export const BASE = process.env.HP_BASE || 'https://www.hustleportal.online'

export const SWEEP_CAPS = {
  tiktok: Number(process.env.TIKTOK_SWEEP_CAP_USD || 0.03),
  facebook: Number(process.env.FB_SWEEP_CAP_USD || 0.03),
  run: Number(process.env.RUN_CAP_USD || 0.2),
}

/** Login as the ops seat; returns the session cookie. Exits 2 on any failure. */
export async function login(scriptName) {
  const email = (process.env.OPS_SEAT_EMAIL || 'ops@hustleqa.example.com').trim()
  const password = (process.env.OPS_SEAT_PASSWORD || '').trim()
  if (!password) {
    console.error(`[${scriptName}] FAIL fast: OPS_SEAT_PASSWORD is not set in the environment. Nothing was spent.`)
    console.error(`[${scriptName}] The runner must export the CURRENT ops-seat password (the one baked into the cron payload was rotated).`)
    process.exit(2)
  }
  const res = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', email, password }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[${scriptName}] FAIL fast: ops-seat login ${res.status} — ${body.slice(0, 160) || 'no body'}. Nothing was spent.`)
    console.error(`[${scriptName}] If this is 401, the password in the runner env (or the cron payload) is stale — update it and re-run.`)
    process.exit(2)
  }
  const sc = res.headers.get('set-cookie') || ''
  const cookie = sc.split(';')[0]
  if (!cookie) {
    console.error(`[${scriptName}] FAIL fast: login returned no session cookie. Nothing was spent.`)
    process.exit(2)
  }
  return cookie
}

/** GET wrapper with the session cookie. */
export async function apiGet(cookie, path, timeoutMs = 45_000) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

/** POST wrapper with the session cookie. */
export async function apiPost(cookie, path, body, timeoutMs = 90_000) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

/**
 * The treg truth: balance, probe budget, whether the door is lit at all.
 * Returns { ok, treg, budget } or { ok: false, error } — never throws.
 */
export async function tregTruth(cookie) {
  try {
    const { status, json } = await apiGet(cookie, '/api/admin/exec/pool/verify', 60_000)
    if (status !== 200 || !json?.ok) {
      return { ok: false, error: `pool/verify ${status}: ${JSON.stringify(json).slice(0, 200)}` }
    }
    return { ok: true, treg: json.treg || null, budget: json.budget || null }
  } catch (e) {
    return { ok: false, error: `pool/verify threw: ${e.message}` }
  }
}

/**
 * One metered search through the platform door. Returns the response json
 * whatever the status, so callers can read costUsd and budget honestly.
 */
export async function searchAsk(cookie, platform, ask, opts = {}) {
  const payload = { platform, ask: ask.slice(0, 140) }
  if (opts.maxFresh != null) payload.maxFresh = opts.maxFresh
  if (opts.confirmCost) payload.confirmCost = true
  if (opts.fresh === false) payload.fresh = false
  const timeoutMs = platform === 'facebook' ? 100_000 : 60_000
  try {
    return await apiPost(cookie, '/api/admin/exec/xpitch/search', payload, timeoutMs)
  } catch (e) {
    return { status: 0, json: { ok: false, error: `${platform} search threw: ${e.message}` } }
  }
}

/** The daily ask rotation — one trade per day, city mixed in, deterministic by date. */
export const TIKTOK_ASKS = [
  'shisanyama soweto',
  'nail tech johannesburg',
  'salon durban',
  'photographer cape town',
  'plumber pretoria',
  'car detailing johannesburg',
  'bakery cape town',
  'event decor durban',
  'mobile mechanic soweto',
  'lashes sandton',
]

/** Deterministic pick for a date: rotate through the list, N per run. */
export function picksForToday(list, n, dateIso = new Date().toISOString().slice(0, 10)) {
  let seed = 0
  for (const ch of dateIso) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  const out = []
  for (let i = 0; i < n && i < list.length; i++) out.push(list[(seed + i) % list.length])
  return out
}
