import { db } from '@/lib/db'
import { aiDay } from '@/lib/aiusage'

/**
 * LEAD LOOKUP MEMORY — the reveal's first two doors, in front of Google's quota.
 *
 * Door 1 (memory): one verified contact answer per business, shared by every
 * member. The FIRST reveal of "Spar, Observatory" pays the search; every later
 * reveal of the same business reads the cache row and burns ZERO search quota.
 *
 * Door 2 (the website's own door): a locked lead with a website gets one plain
 * fetch of the business's OWN pages and a read of the contact details they
 * publish there. No AI, no quota, no model rotation, no fabrication: the email
 * and phone literally appear on their site, which the grounded contract already
 * names as the strongest source. The reach gate still applies at the till.
 *
 * Both doors feed the same honesty contract as the AI lookup: only details that
 * actually appear in a public source are ever stored, and nothing is charged
 * unless a real door comes back.
 */

export interface LookupContact {
  email?: string
  phone?: string
  contactName?: string
  source: string
  /** The cache row this answer actually came from (may differ from the asked key on a stem match). */
  cacheKey?: string
}

/** Normalised business identity: same business, same key, across every member. */
export function companyKeyFor(company: string, city?: string | null, website?: string | null): string {
  const name = String(company || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const place = String(city || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const host = hostOf(website)
  return [name, place, host || ''].join('|')
}

function hostOf(url?: string | null): string | null {
  const raw = String(url || '').trim()
  if (!raw) return null
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/** Read the memory. A hit still passes the sane + reach gates at the call site. */
export async function cacheGetContact(companyKey: string): Promise<LookupContact | null> {
  let row = await db.leadLookupCache.findUnique({ where: { companyKey } }).catch(() => null)
  if (!row) {
    // The SAME business often sits in two shapes across members' pipelines: one
    // row carries its website, another (a web-found lead) has none, and the two
    // identities key differently ("spar|observatory|" vs "spar|observatory|spar.co.za").
    // A verified answer paid by the first must still rescue the second, so on an
    // exact miss fall back to the name+city stem, most-verified answer first.
    // Still one real public answer for that name+city — nothing is invented here.
    const stem = companyKey.split('|').slice(0, 2).join('|')
    if (stem && stem !== '||') {
      row = await db.leadLookupCache
        .findFirst({
          where: { companyKey: { startsWith: `${stem}|` } },
          orderBy: [{ hits: 'desc' }, { updatedAt: 'desc' }],
        })
        .catch(() => null)
    }
  }
  if (!row || (!row.email && !row.phone)) return null
  // Hit counting is best effort: a failed counter write must never fail a reveal.
  db.leadLookupCache
    .update({ where: { id: row.id }, data: { hits: { increment: 1 } } })
    .catch(() => {})
  return { email: row.email || undefined, phone: row.phone || undefined, contactName: row.contactName || undefined, source: row.source, cacheKey: row.companyKey }
}

/** Write the memory. Additive upsert; existing verified facts are never blanked. */
export async function cachePutContact(companyKey: string, contact: LookupContact): Promise<void> {
  if (!contact.email && !contact.phone) return
  try {
    await db.leadLookupCache.upsert({
      where: { companyKey },
      update: {
        ...(contact.email ? { email: contact.email } : {}),
        ...(contact.phone ? { phone: contact.phone } : {}),
        ...(contact.contactName ? { contactName: contact.contactName } : {}),
        source: contact.source,
      },
      create: {
        companyKey,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        contactName: contact.contactName ?? null,
        source: contact.source,
      },
    })
  } catch {
    // The memory is an optimisation; a write failure must never fail a reveal.
  }
}

// ---------- Door 2: the business's own website ----------

const FETCH_TIMEOUT_MS = 7_000
const MAX_HTML = 400_000
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Emails that are plumbing, not a contact door. */
const EMAIL_NOISE =
  /example\.(com|org|net)|your?(email|domain)|domain\.com|sentry\.io|wixpress\.com|godaddy\.com|@2x|\.png|\.jpe?g|\.webp|\.gif|\.svg|schema\.org|sitelock|cloudflare|no-?reply@google|u003e|javascript/i

function extractEmails(html: string, host: string | null): string[] {
  const found = new Set<string>()
  // mailto: links first, they are the deliberate doors (decode entities/spaces).
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try {
      found.add(decodeURIComponent(m[1]).trim())
    } catch {
      found.add(m[1].trim())
    }
  }
  for (const m of html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    found.add(m[0].replace(/^mailto:/i, '').trim())
  }
  const sane = [...found].map((e) => e.replace(/^[.;,]+|[.;,]+$/g, '')).filter((e) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return false
    if (EMAIL_NOISE.test(e)) return false
    return true
  })
  // Prefer an address on the business's own domain, it is the strongest claim.
  if (host) {
    const own = sane.filter((e) => e.toLowerCase().endsWith(`@${host}`) || e.toLowerCase().endsWith(`.${host}`))
    if (own.length) return own
  }
  return sane
}

function extractPhones(html: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) found.add(m[1].trim())
  // South African shapes on the page itself: 0xx xxx xxxx, +27 xx xxx xxxx.
  for (const m of html.matchAll(/(?:\+27|27|0)[\s\-().]{0,3}\d{2}[\s\-().]{0,3}\d{3}[\s\-().]{0,3}\d{4}\b/g)) {
    found.add(m[0].trim())
  }
  return [...found].filter((p) => {
    const digits = p.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 12) return false
    if (/^0{4,}|^27{2,}/.test(digits)) return false // placeholder runs like 000000000
    return true
  })
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') || ''
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) return null
    const text = await res.text()
    return text.slice(0, MAX_HTML)
  } catch {
    return null
  }
}

/**
 * Read the business's own pages for the contact details they publish.
 * Homepage first, then the obvious contact pages while the clock allows.
 * Returns null when the site yields no door at all.
 */
export async function siteContactDoor(website?: string | null): Promise<LookupContact | null> {
  const raw = String(website || '').trim()
  if (!raw) return null
  let base: URL
  try {
    base = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const host = base.hostname.replace(/^www\./, '')
  const started = Date.now()
  const pages: string[] = [base.origin + base.pathname]
  const contactPath = base.pathname.replace(/\/$/, '')
  // Already a contact page? Then the homepage pick IS the contact attempt.
  // Anything else still earns the obvious fallback paths.
  if (!/contact/i.test(contactPath)) {
    pages.push(`${base.origin}/contact`, `${base.origin}/contact-us`)
  }

  for (const page of pages) {
    const left = 16_000 - (Date.now() - started)
    if (left < 3_000) break
    const html = await fetchPage(page)
    if (!html) continue
    const emails = extractEmails(html, host)
    const phones = extractPhones(html)
    if (emails.length || phones.length) {
      return {
        ...(emails[0] ? { email: emails[0] } : {}),
        ...(phones[0] ? { phone: phones[0] } : {}),
        source: `their own website (${page})`,
      }
    }
  }
  return null
}

// ---------- The exec counter: what did the doors actually do today ----------

type RevealDoor = 'lookups' | 'memory' | 'site' | 'gemini' | 'glm' | 'fail' | 'engineFail'
export const REVEAL_STATS_KEY = 'REVEAL_STATS'
const STATS_KEY = REVEAL_STATS_KEY
const STATS_DAYS = 30

/** Best-effort per-day counter, SAST stamped like every other meter. */
export async function bumpRevealStats(door: RevealDoor): Promise<void> {
  try {
    const day = aiDay()
    const row = await db.platformConfig.findUnique({ where: { key: STATS_KEY } })
    let stats: Record<string, Record<string, number>> = {}
    if (row?.value) {
      try {
        stats = JSON.parse(row.value)
      } catch {}
    }
    // Keep only the recent window so the row can never bloat.
    for (const k of Object.keys(stats)) {
      if (k < addDays(day, -(STATS_DAYS - 1))) delete stats[k]
    }
    const today = stats[day] || { lookups: 0, memory: 0, site: 0, gemini: 0, glm: 0, fail: 0, engineFail: 0 }
    today.lookups += door === 'lookups' ? 1 : 0
    today.memory += door === 'memory' ? 1 : 0
    today.site += door === 'site' ? 1 : 0
    today.gemini += door === 'gemini' ? 1 : 0
    today.fail += door === 'fail' ? 1 : 0
    // New doors on days first touched before they existed: guard the zero so
    // yesterday's rows never read NaN when today's door fires on them.
    today.glm = (today.glm || 0) + (door === 'glm' ? 1 : 0)
    today.engineFail = (today.engineFail || 0) + (door === 'engineFail' ? 1 : 0)
    stats[day] = today
    await db.platformConfig.upsert({
      where: { key: STATS_KEY },
      update: { value: JSON.stringify(stats) },
      create: { key: STATS_KEY, value: JSON.stringify(stats) },
    })
  } catch {
    // Observability must never stand in front of money.
  }
}

function addDays(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
