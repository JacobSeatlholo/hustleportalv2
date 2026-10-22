import dns from 'node:dns/promises'
import net from 'node:net'

/**
 * SSRF guard, every server-side fetch of a user-supplied host goes through
 * here first. Two layers:
 *
 *  1. Syntactic: only http(s), a real hostname with a dot, no credentials,
 *     no non-standard ports beyond a sane set.
 *  2. Resolved: the hostname is DNS-resolved (ALL addresses) and every
 *     answer must be public. This closes the classic bypasses that a
 *     hostname string check misses: octal/decimal IP forms, IPv6 loopback,
 *     DNS that points at 127.0.0.1 or 169.254.169.254, etc.
 *
 * DNS rebinding (resolve public, re-resolve private at fetch time) remains
 * theoretically possible but is out of scope for this threat model; the
 * practical attack class, "make the server talk to its own localhost,
 * private network or cloud metadata", is fully closed.
 */

const BLOCKED_HOSTNAMES = /^(localhost|metadata\.google\.internal|instance-data)$/i

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast + reserved
    return false
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v === '::' || v === '::1') return true
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true // link-local + ULA
    if (/^f[ef]/.test(v)) return true
    // IPv4-mapped ::ffff:127.0.0.1 etc.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIp(mapped[1])
    return false
  }
  return true // unparseable, treat as hostile
}

export interface SafeUrlVerdict {
  ok: boolean
  url?: string
  reason?: string
}

/** Validate + resolve a user-supplied URL. Returns the normalized URL on success. */
export async function safeUrl(raw: string, opts?: { allowedPorts?: number[] }): Promise<SafeUrlVerdict> {
  const v = String(raw || '').trim()
  if (!v) return { ok: false, reason: 'empty' }
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: 'scheme' }
  if (u.username || u.password) return { ok: false, reason: 'credentials' }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || !host.includes('.') && !net.isIPv6(host)) return { ok: false, reason: 'hostname' }
  if (BLOCKED_HOSTNAMES.test(host)) return { ok: false, reason: 'blocked-host' }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return { ok: false, reason: 'blocked-host' }
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
  const allowed = opts?.allowedPorts ?? [80, 443, 8080, 8443]
  if (!allowed.includes(port)) return { ok: false, reason: 'port' }
  if (u.toString().length > 2000) return { ok: false, reason: 'too-long' }

  // Resolve every address the hostname answers with; all must be public.
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true })
    if (!addrs.length) return { ok: false, reason: 'no-dns' }
    for (const a of addrs) {
      if (isPrivateIp(a.address)) return { ok: false, reason: 'private-address' }
    }
  } catch {
    return { ok: false, reason: 'dns-failed' }
  }
  return { ok: true, url: u.toString() }
}

/** Convenience for the website-liveness ping: is this host fetchable at all? */
export async function safeHost(host: string): Promise<boolean> {
  const verdict = await safeUrl(`https://${host.replace(/^https?:\/\//i, '')}`)
  return verdict.ok
}
