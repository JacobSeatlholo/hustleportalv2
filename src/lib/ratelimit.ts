/**
 * In-memory rate limiter, sliding window, single server (standalone Node
 * behind Caddy), so a Map is the honest and correct tool. No external
 * dependency, no cold-start cost.
 *
 * Design rules:
 *  - FAIL-CLOSED is wrong here: on any internal error the limiter allows the
 *    request (availability over paranoia), because these gates protect against
 *    brute force and mail bombing, not against data theft by themselves.
 *  - Keys are namespaced: "login:ip:1.2.3.4", "forgot:email:a@b.com".
 *  - Only FAILED login attempts count against the per-email door: the owner
 *    typing the correct password can never be locked out by an attacker
 *    spamming their address.
 */

type Window = { hits: number[] }

const buckets = new Map<string, Window>()
let lastSweep = Date.now()

/** Periodic garbage collection so abandoned buckets cannot grow the heap. */
function sweep() {
  const now = Date.now()
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, win] of buckets) {
    // A bucket with no hit in the last 10 minutes is dead weight.
    const newest = win.hits[win.hits.length - 1]
    if (!newest || now - newest > 600_000) buckets.delete(key)
  }
}

export interface RateVerdict {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

/**
 * Record a hit and answer whether the caller may proceed.
 * limit N per windowMs, sliding: the oldest hit must age out before a new one fits.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateVerdict {
  sweep()
  const now = Date.now()
  const win = buckets.get(key) || { hits: [] }
  win.hits = win.hits.filter((t) => now - t < windowMs)
  if (win.hits.length >= limit) {
    buckets.set(key, win)
    const oldest = win.hits[0]
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) }
  }
  win.hits.push(now)
  buckets.set(key, win)
  return { ok: true, remaining: limit - win.hits.length, retryAfterSec: 0 }
}

/** Clear a bucket (e.g. a successful login wipes the failure counter). */
export function rateLimitClear(key: string) {
  buckets.delete(key)
}

/** Best-effort client IP behind Caddy (X-Forwarded-For set by the proxy). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || ''
  const first = fwd.split(',')[0]?.trim()
  if (first) return first
  return req.headers.get('x-real-ip') || 'unknown'
}

/** Shared 429 body, friendly, plain english, no internal detail. */
export function tooMany(retryAfterSec: number): { error: string; retryAfter: number } {
  const mins = Math.max(1, Math.ceil(retryAfterSec / 60))
  return {
    error: `Too many attempts in a short time. Give it ${mins} minute${mins === 1 ? '' : 's'} and try again, this keeps your account safe.`,
    retryAfter: retryAfterSec,
  }
}

/**
 * Global cooldown for unauthenticated trigger endpoints (cron jobs): when no
 * CRON_SECRET is configured, the job may still run, but at most once per
 * cooldown window. Repeat callers get an honest "already ran recently" answer
 * without the work (and without the push blast / API spend).
 */
const lastRun = new Map<string, number>()
export function globalCooldown(key: string, cooldownMs: number): { ran: boolean; retryAfterSec: number } {
  const now = Date.now()
  const last = lastRun.get(key) || 0
  if (now - last < cooldownMs) {
    return { ran: false, retryAfterSec: Math.ceil((last + cooldownMs - now) / 1000) }
  }
  lastRun.set(key, now)
  return { ran: true, retryAfterSec: 0 }
}
