/**
 * reach.ts, the REACHABLE half of the quality promise.
 *
 * "Relevant and reachable" is what the platform sells. Relevance was already
 * a gate (the taxonomy + ranker + the deck's floor); reachability was an
 * assumption. This file makes it a fact, at $0 and without burning a single
 * AI credit: a plain DNS mail-exchanger lookup answers "can this address
 * ever receive mail" for the cost of one resolver roundtrip.
 *
 * Three verdicts, and honesty about the difference:
 *  - ok      the domain announces mail servers, mail can land
 *  - dead    the domain does not exist (NXDOMAIN) or announces no way to
 *            receive mail at all: no MX and no A fallback. Mail to it is a
 *            guaranteed bounce, so the address never serves, never reveals
 *            for money and never enters the pool.
 *  - unknown resolver trouble (timeout, SERVFAIL, offline). Never punished:
 *            an unknown address behaves exactly as it did before this file
 *            existed. A network hiccup must never delete a real lead.
 *
 * Verdicts are cached in memory (per serverless instance): the megaprovider
 * domains every second lead wears cost one lookup a day per instance, and a
 * scan of thirty faces costs one parallel DNS roundtrip, not thirty.
 */

import { isEmail } from '@/lib/quality'

export type ReachVerdict = 'ok' | 'dead' | 'unknown'

const TTL_OK = 24 * 60 * 60 * 1000 // a healthy domain stays healthy for a day
const TTL_DEAD = 6 * 60 * 60 * 1000 // dead domains get re-asked sooner (they do come back to life sometimes)
const TTL_UNKNOWN = 15 * 60 * 1000 // retry resolver trouble quickly

const cache = new Map<string, { verdict: ReachVerdict; at: number }>()

export function domainOf(email?: string | null): string | null {
  const s = String(email || '').trim().toLowerCase()
  const at = s.lastIndexOf('@')
  if (at <= 0 || at === s.length - 1) return null
  return s.slice(at + 1)
}

function cached(domain: string): ReachVerdict | null {
  const hit = cache.get(domain)
  if (!hit) return null
  const ttl = hit.verdict === 'ok' ? TTL_OK : hit.verdict === 'dead' ? TTL_DEAD : TTL_UNKNOWN
  if (Date.now() - hit.at > ttl) {
    cache.delete(domain)
    return null
  }
  return hit.verdict
}

/**
 * One mail-exchanger question with a hard stop. Never throws. The verdict
 * matters: a domain that does not exist (NXDOMAIN) is PROOF of death, a
 * domain with no MX record needs the A-record fallback asked separately,
 * and only resolver trouble (timeout, SERVFAIL, no network) stays unknown.
 */
async function askMx(domain: string): Promise<'has-mx' | 'no-mx' | 'nxdomain' | 'error'> {
  try {
    const dns = await import('node:dns')
    const res = await Promise.race([
      dns.promises.resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error('mx timeout'), { code: 'ETIMEOUT' })), 2_500)),
    ])
    return Array.isArray(res) && res.length > 0 ? 'has-mx' : 'no-mx'
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === 'ENOTFOUND') return 'nxdomain' // the domain itself does not exist
    if (code === 'ENODATA') return 'no-mx' // domain exists, announces no MX
    return 'error'
  }
}

/** The A-record fallback (RFC 5321 implicit MX): a domain with no MX but a live A record can still receive mail. */
async function askA(domain: string): Promise<boolean> {
  try {
    const dns = await import('node:dns')
    const res = await Promise.race([
      dns.promises.resolve4(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error('a timeout'), { code: 'ETIMEOUT' })), 2_500)),
    ])
    return Array.isArray(res) && res.length > 0
  } catch {
    return false
  }
}

/**
 * Can mail to this address land? 'dead' is only ever claimed on PROOF:
 * the domain itself does not resolve, or it resolves and announces no mail
 * path at all (no MX, no A). Everything else stays 'unknown' and passes.
 */
export async function emailReach(email?: string | null): Promise<ReachVerdict> {
  const addr = String(email || '').trim()
  if (!addr) return 'dead' // an absent address is not an error, but it is not a door either
  if (!isEmail(addr)) return 'dead' // junk shape can never receive mail
  const domain = domainOf(addr)
  if (!domain) return 'dead'
  const hit = cached(domain)
  if (hit) return hit
  const mx = await askMx(domain)
  let verdict: ReachVerdict
  if (mx === 'has-mx') {
    verdict = 'ok'
  } else if (mx === 'nxdomain') {
    verdict = 'dead' // the domain does not exist: mail there is a guaranteed bounce
  } else if (mx === 'no-mx') {
    verdict = (await askA(domain)) ? 'ok' : 'dead'
  } else {
    verdict = 'unknown' // resolver trouble: pass, never punish
  }
  cache.set(domain, { verdict, at: Date.now() })
  return verdict
}

/** Cached verdict when we have one, without asking the resolver. */
export function emailReachCached(email?: string | null): ReachVerdict | null {
  const addr = String(email || '').trim()
  if (!addr || !isEmail(addr)) return 'dead'
  const domain = domainOf(addr)
  return domain ? cached(domain) : null
}

/**
 * Gate a batch of addresses (the scan answer, the capture rows). Returns a
 * map keyed by lowercased email holding only the PROVABLY dead ones — the
 * contract every caller shares: drop emails present in this map, keep
 * everything else exactly as it was. Bounded so a wide scan can never turn
 * into a DNS storm.
 */
export async function deadEmailMap(emails: (string | null | undefined)[], max = 24): Promise<Set<string>> {
  const unique = [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))]
  const dead = new Set<string>()
  const ask = unique.slice(0, max)
  // Parallel in small crews: one resolver roundtrip each, worst case a few
  // seconds for a full batch, usually one cache hit after the first scan.
  for (let i = 0; i < ask.length; i += 8) {
    await Promise.all(
      ask.slice(i, i + 8).map(async (e) => {
        if (await emailReach(e) === 'dead') dead.add(e)
      })
    )
  }
  return dead
}

/** True when an address is PROVABLY undeliverable (shape junk or dead domain). Never true on 'unknown'. */
export async function emailIsDead(email?: string | null): Promise<boolean> {
  return (await emailReach(email)) === 'dead'
}
