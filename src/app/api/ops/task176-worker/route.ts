import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { promises as dns } from 'dns'
import { db } from '@/lib/db'
import { normalizeCampaignFrom, isSesConfigured } from '@/lib/mailer'
import { writeCampaignState } from '@/lib/campaignqueue'
import { isProbeEmail, isInternalEmail } from '@/lib/probe'
import { tregBalanceMicro } from '@/lib/tregverify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ONE-TIME DOOR #5 (Task 176) — the treg→bench worker + stager, on the boss's
 * instruction "use treg to find the 1000 relevant people". Four actions:
 *
 *  collect  dropleads.people.search (FREE, SA owners/founders, requireEmail)
 *           → dropleads.people.enrich.verified ($0.0036 per SUCCESS only,
 *             hard budget: halt when treg balance < $4 or 1150 verified)
 *           → insert into the master's bench (source TREG, stage NEW),
 *             deduped by externalId + email, risky role inboxes and QA /
 *             internal / gov domains refused at the door. No campaigns yet.
 *  stage    bench rows (source TREG, untouched, valid MX) → city buckets →
 *           QUEUED rows + campaign states born PAUSED (SES, 100/h). The
 *           Start button stays the boss's. Never sends.
 *  harden   the Yoco/justice lesson as data: both mis-sent addresses onto the
 *           Suppression list (idempotent, scoped to exactly those two).
 *  status   cursor + totals + balance, nothing else.
 *
 * Provider keys injected server-side by treg; no credential ever leaves the
 * deployment. Deleted in the same session.
 */

const DOOR_TOKEN = 'f4a9d1c73b80e256940ac7eb2f165d308c7e94b21a6d0f83'
const MASTER_EMAIL = 'ceo@businesshustle.co.za'
const TREG_MCP_URL = 'https://treg.to/mcp/'
const TREG_TOKEN = (process.env.TREG_TOKEN || process.env.TREG_API_TOKEN || '').trim()

const CURSOR_KEY = 'TASK176_CURSOR'
const TOTALS_KEY = 'TASK176_TOTALS'
const BALANCE_FLOOR_USD = 4.0
const MAX_VERIFIED = 1150
const MAX_PAGES = 60
const PER_HIT_MS = 36_000

const SUBJECT = 'Still hunting clients the hard way?'

const BODY = `Hi,

Quick one, because your time is money.

[HustlePortal](https://www.hustleportal.online) is one place to run your hustle:

• Tell us what you do — our AI finds verified leads near you and loads them into your pipeline, ready to call.
• Quotes, invoices, tasks, clients and your money — all in one place, from your phone.
• Every new account starts with R99 free credit. No card needed.

That's the whole pitch. Month to month, pause any time.

See it for yourself: [HustlePortal](https://www.hustleportal.online)

The Business Hustle team`

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ROLE_BLOCK = /^(support|complaints|abuse|noreply|no-reply|donotreply|postmaster|hostmaster|security|webmaster|billing|legal|privacy)@/
const DOMAIN_BLOCK = [/\.gov\.za$/i, /(^|\.)yoco\.com$/i, /(^|\.)justice\.gov\.za$/i]

const SEARCH_FILTERS = {
  countries: ['South Africa'],
  jobTitles: ['Owner', 'Business Owner', 'Co-Owner', 'Founder', 'Co-Founder', 'Director', 'Managing Director', 'Proprietor'],
  requireEmail: true,
}

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function tregCall(endpointId: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<{ ok: boolean; body: unknown }> {
  try {
    const res = await fetch(TREG_MCP_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TREG_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'call', arguments: { endpoint_id: endpointId, params: args } } }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, body: `http ${res.status}` }
    const json = (await res.json()) as { result?: { structuredContent?: unknown; content?: { text?: string }[] } }
    let parsed: unknown = json.result?.structuredContent ?? json.result?.content?.[0]?.text ?? json.result ?? null
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch { /* keep string */ }
    }
    return { ok: true, body: parsed }
  } catch (e) {
    return { ok: false, body: e instanceof Error ? e.message : String(e) }
  }
}

function unwrap(body: unknown): { rows: Record<string, unknown>[]; total: unknown } {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const provider = (typeof b.body === 'object' && b.body !== null ? b.body : b) as Record<string, unknown>
  const data = (provider.data ?? {}) as Record<string, unknown>
  const rows = (data.leads ?? provider.leads ?? []) as Record<string, unknown>[]
  return { rows, total: data.total ?? provider.total ?? null }
}

async function readConfigJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await db.platformConfig.findUnique({ where: { key } })
    return row?.value ? (JSON.parse(row.value) as T) : fallback
  } catch {
    return fallback
  }
}

async function writeConfigJson(key: string, value: unknown): Promise<void> {
  await db.platformConfig.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } })
}

interface Cursor { page: number; done: boolean }
interface Totals { verified: number; inserted: number; missed: number; pages: number; dupes: number; skipped: number }

function safeCity(...parts: unknown[]): string {
  for (const p of parts) {
    const s = String(p || '').trim()
    if (s) return s.slice(0, 60)
  }
  return 'South Africa'
}

function cleanPhone(p: unknown): string | null {
  const s = String(p || '').trim()
  if (!s) return null
  const cleaned = s.replace(/[^\d+()\- ]/g, '').trim()
  return cleaned ? cleaned.slice(0, 40) : null
}

function riskyInbox(email: string): boolean {
  const e = email.toLowerCase()
  if (ROLE_BLOCK.test(e)) return true
  const domain = e.split('@')[1] || ''
  return DOMAIN_BLOCK.some((re) => re.test(domain))
}

function bucketFor(city: string): 'jhb' | 'cpt' | 'coastal' | 'sarest' {
  const c = city.toLowerCase()
  if (/(johannesburg|jhb|pretoria|tshwane|sandton|midrand|centurion|randburg|roodepoort|kempton|benoni|germiston|soweto|krugersdorp| vereeniging|vanterset)/.test(c)) return 'jhb'
  if (/(cape town|cpt|stellenbosch|paarl|somerset west|george|swellendam|worcester|bellville|durbanville|milnerton|fish hoek|simon)/.test(c)) return 'cpt'
  if (/(durban|pietermaritzburg|richards bay|newcastle|gqeberha|port elizabeth|pe:|east london|king william|bloemfontein|umsint|umhlanga|ballito|nelspruit|mbombela|polokwane|pietersburg|rustenburg|potchef|klerksdorp|kimberley|mahikeng|mlinka|mthatha|ustenburg)/.test(c)) return 'coastal'
  return 'sarest'
}

async function getConfigCounter(key: string): Promise<number> {
  const row = await db.platformConfig.findUnique({ where: { key } })
  const n = row?.value ? Number(row.value) : 0
  return Number.isFinite(n) ? n : 0
}

async function bumpCounter(key: string, by: number): Promise<number> {
  const n = (await getConfigCounter(key)) + by
  await db.platformConfig.upsert({ where: { key }, create: { key, value: String(n) }, update: { value: String(n) } })
  return n
}

// ---------------- collect ----------------

async function collect(): Promise<NextResponse> {
  const started = Date.now()
  const master = await db.user.findFirst({ where: { email: MASTER_EMAIL }, select: { id: true } })
  if (!master) return NextResponse.json({ error: `Master ${MASTER_EMAIL} not found` }, { status: 503 })

  const cursor = await readConfigJson<Cursor>(CURSOR_KEY, { page: 1, done: false })
  const totals = await readConfigJson<Totals>(TOTALS_KEY, { verified: 0, inserted: 0, missed: 0, pages: 0, dupes: 0, skipped: 0 })

  let enrichedThisHit = 0
  let insertedThisHit = 0
  let missedThisHit = 0
  let halt: string | null = null

  while (!cursor.done && Date.now() - started < PER_HIT_MS) {
    if (totals.verified >= MAX_VERIFIED) { halt = 'verified cap reached'; break }
    const balance = await tregBalanceMicro({ fresh: true })
    if (balance != null && balance < BALANCE_FLOOR_USD * 1e6) { halt = `treg balance $${(balance / 1e6).toFixed(2)} under floor $${BALANCE_FLOOR_USD.toFixed(2)}`; break }

    const r = await tregCall('dropleads.people.search', { filters: SEARCH_FILTERS, pagination: { page: cursor.page, limit: 50 } })
    if (!r.ok) { halt = `search failed: ${String(r.body).slice(0, 120)}`; break }
    const { rows } = unwrap(r.body)
    if (rows.length === 0) { cursor.done = true; break }
    cursor.page++
    totals.pages++

    // fresh-enough rows: skip ids already on the bench (externalId dedupe)
    const ids = rows.map((x) => String(x.id ?? '')).filter(Boolean)
    const known = new Set<string>()
    if (ids.length) {
      const existing = await db.lead.findMany({ where: { externalId: { in: ids.map((i) => `dropleads:${i}`) } }, select: { externalId: true } })
      for (const e of existing) known.add(e.externalId || '')
    }

    const candidates = rows.filter((x) => {
      const id = String(x.id ?? '')
      if (!id || known.has(`dropleads:${id}`)) { totals.dupes++; return false }
      const size = Number(x.companySize ?? 999)
      if (Number.isFinite(size) && size > 60) { totals.skipped++; return false } // not a small business
      return true
    })

    // enrich in chunks of 6, $0.0036 each, billed per success only
    for (let i = 0; i < candidates.length; i += 6) {
      if (Date.now() - started >= PER_HIT_MS || totals.verified >= MAX_VERIFIED) break
      const chunk = candidates.slice(i, i + 6)
      const results = await Promise.all(chunk.map(async (person) => {
        const args: Record<string, unknown> = { email_verification_type: 'valid_and_catchall' }
        for (const k of ['id', 'first_name', 'firstName', 'last_name', 'lastName', 'name', 'organization_name', 'companyName', 'domain', 'linkedin_url']) {
          if (person[k] != null && person[k] !== '') args[k] = person[k]
        }
        const er = await tregCall('dropleads.people.enrich.verified', args, 25_000)
        if (!er.ok) return { miss: true, person }
        const eb = (typeof er.body === 'object' && er.body !== null ? er.body : {}) as Record<string, unknown>
        const pb = (typeof eb.body === 'object' && eb.body !== null ? eb.body : eb) as Record<string, unknown>
        const personOut = (pb.person ?? {}) as Record<string, unknown>
        const email = String(personOut.email || '').trim().toLowerCase()
        const verified = pb.verified === true
        if (!email || !EMAIL_RE.test(email) || !verified) return { miss: true, person }
        return { miss: false, person, personOut, email }
      }))

      for (const out of results) {
        if (out.miss) { totals.missed++; missedThisHit++; continue }
        const email = out.email!
        const personOut = out.personOut!
        if (isProbeEmail(email) || isInternalEmail(email) || riskyInbox(email)) { totals.skipped++; continue }
        // bench dedupe by email (any source, any stage)
        const clash = await db.lead.findFirst({ where: { email }, select: { id: true } })
        if (clash) { totals.dupes++; continue }
        const orgName = String(personOut.organization_name || out.person.companyName || '').trim()
        await db.lead.create({
          data: {
            userId: master.id,
            company: (orgName || email.split('@')[1] || 'Unknown').slice(0, 120),
            contactName: String(personOut.first_name && personOut.last_name ? `${personOut.first_name} ${personOut.last_name}` : out.person.fullName || '').slice(0, 120) || null,
            role: String(out.person.title || personOut.title || '').slice(0, 120) || null,
            profileUrl: String(personOut.linkedin_url || out.person.linkedinUrl || '').slice(0, 300) || null,
            email,
            phone: cleanPhone(personOut.phone_numbers && (personOut.phone_numbers as unknown[])[0] ? (personOut.phone_numbers as unknown[])[0] : personOut.organization_phone),
            website: String(personOut.organization_website_url || '').replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 200) || null,
            city: safeCity(personOut.city, out.person.city, personOut.organization_city),
            industry: String(personOut.organization_industry || out.person.industry || '').slice(0, 80) || null,
            country: 'South Africa',
            source: 'TREG',
            stage: 'NEW',
            externalId: `dropleads:${String(personOut.id ?? out.person.id ?? '')}`,
            notes: 'Task 176 treg lane: dropleads verified email (mailbox-checked by provider).',
          },
          select: { id: true },
        })
        totals.verified++
        totals.inserted++
        enrichedThisHit++
        insertedThisHit++
      }
    }

    if (cursor.page > MAX_PAGES) { cursor.done = true; break }
    await writeConfigJson(CURSOR_KEY, cursor)
    await writeConfigJson(TOTALS_KEY, totals)
  }

  await writeConfigJson(CURSOR_KEY, cursor)
  await writeConfigJson(TOTALS_KEY, totals)
  const balance = await tregBalanceMicro({ fresh: true })

  return NextResponse.json({
    ok: true,
    action: 'collect',
    cursor,
    totals,
    thisHit: { enriched: enrichedThisHit, inserted: insertedThisHit, missed: missedThisHit },
    halt,
    balanceMicro: balance,
    balanceUsd: balance != null ? Number((balance / 1e6).toFixed(4)) : null,
  })
}

// ---------------- stage ----------------

const BUCKETS: { tag: string; key: string }[] = [
  { tag: 'treg-intro-2026-11-jhb', key: 'jhb' },
  { tag: 'treg-intro-2026-11-cpt', key: 'cpt' },
  { tag: 'treg-intro-2026-11-coastal', key: 'coastal' },
  { tag: 'treg-intro-2026-11-sarest', key: 'sarest' },
]

async function stage(): Promise<NextResponse> {
  if (!isSesConfigured()) return NextResponse.json({ error: 'SES lane not configured — staging refused.' }, { status: 503 })
  const master = await db.user.findFirst({ where: { email: MASTER_EMAIL }, select: { id: true, email: true } })
  if (!master) return NextResponse.json({ error: `Master ${MASTER_EMAIL} not found` }, { status: 503 })

  const tags = BUCKETS.map((b) => b.tag)
  const clashes = await db.emailLog.groupBy({ by: ['campaign'], where: { campaign: { in: tags } }, _count: { _all: true } })
  if (clashes.length > 0) {
    return NextResponse.json({ error: 'Stage tags already carry rows, refusing double-fire.', clashes: clashes.map((c) => ({ tag: c.campaign, rows: c._count._all })) }, { status: 409 })
  }

  // the collect harvest, untouched
  const bench = await db.lead.findMany({
    where: { userId: master.id, source: 'TREG', stage: 'NEW', email: { not: null }, emailLogs: { none: {} } },
    select: { id: true, email: true, company: true, contactName: true, city: true },
  })
  const emails = [...new Set(bench.map((b) => (b.email || '').trim().toLowerCase()))]

  const [suppressed, touched] = await Promise.all([
    db.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    db.emailLog.findMany({ where: { campaign: { not: null }, status: { in: ['QUEUED', 'SENT', 'FAILED', 'BOUNCED'] }, toEmail: { in: emails } }, select: { toEmail: true } }),
  ])
  const suppressedSet = new Set(suppressed.map((s) => s.email))
  const touchedSet = new Set(touched.map((t) => t.toEmail.trim().toLowerCase()))

  // belt-and-braces MX pass on every candidate domain (free DNS, chunks of 120)
  const domainSet = new Set(emails.map((e) => e.split('@')[1]).filter(Boolean) as string[])
  const deadDomains = new Set<string>()
  const domains = [...domainSet]
  for (let i = 0; i < domains.length; i += 120) {
    const chunk = domains.slice(i, i + 120)
    await Promise.all(chunk.map(async (d) => {
      try {
        const mx = await dns.resolveMx(d)
        if (!mx || mx.length === 0) deadDomains.add(d)
      } catch {
        try {
          const a = await dns.resolve(d)
          if (!a || a.length === 0) deadDomains.add(d)
        } catch { deadDomains.add(d) }
      }
    }))
  }

  const perBucket: Record<string, { email: string; leadId: string; name: string }[]> = { jhb: [], cpt: [], coastal: [], sarest: [] }
  const excluded = { suppressed: 0, touched: 0, risky: 0, deadMx: 0, dupInBatch: 0 }
  const seen = new Set<string>()

  for (const row of bench) {
    const email = (row.email || '').trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) continue
    if (suppressedSet.has(email)) { excluded.suppressed++; continue }
    if (touchedSet.has(email)) { excluded.touched++; continue }
    if (isProbeEmail(email) || isInternalEmail(email) || riskyInbox(email)) { excluded.risky++; continue }
    const domain = email.split('@')[1] || ''
    if (deadDomains.has(domain)) { excluded.deadMx++; continue }
    if (seen.has(email)) { excluded.dupInBatch++; continue }
    seen.add(email)
    const bucket = bucketFor(row.city || '')
    perBucket[bucket].push({ email, leadId: row.id, name: row.company || email.split('@')[1] })
  }

  const state = {
    status: 'PAUSED' as const,
    perHour: 100,
    from: normalizeCampaignFrom('BlackBiz <blackbiz@hustleportal.online>'),
    provider: 'SES' as const,
    createdAt: new Date().toISOString(),
  }

  const results: unknown[] = []
  for (const b of BUCKETS) {
    const rows = perBucket[b.key]
    if (rows.length === 0) { results.push({ campaign: b.tag, queued: 0 }); continue }
    await db.emailLog.createMany({
      data: rows.map((r) => ({
        userId: master.id,
        toEmail: r.email,
        subject: SUBJECT,
        body: BODY,
        status: 'QUEUED',
        provider: 'PLATFORM',
        campaign: b.tag,
        leadId: r.leadId,
      })),
    })
    await writeCampaignState(b.tag, state)
    results.push({ campaign: b.tag, queued: rows.length })
  }

  return NextResponse.json({
    ok: true,
    action: 'stage',
    stagedUnder: master.email,
    benchCandidates: bench.length,
    excluded,
    state,
    results,
    note: 'QUEUED + PAUSED. Edit the From on each card (the new Edit draft button), then press Start per campaign.',
  })
}

// ---------------- harden ----------------

async function harden(): Promise<NextResponse> {
  const targets = [
    { email: 'support@yoco.com', note: 'cold-intro-2026-11 mis-send: payment provider support inbox, never contact again (Task 176)' },
    { email: 'complaints.ir@justice.gov.za', note: 'cold-intro-2026-11 mis-send: government complaints inbox, never contact again (Task 176)' },
  ]
  const out: unknown[] = []
  for (const t of targets) {
    const existing = await db.suppression.findUnique({ where: { email: t.email } })
    if (existing) { out.push({ email: t.email, already: true }); continue }
    await db.suppression.create({ data: { email: t.email, reason: 'MANUAL', note: t.note } })
    out.push({ email: t.email, added: true })
  }
  const total = await db.suppression.count()
  return NextResponse.json({ ok: true, action: 'harden', rows: out, suppressionTotal: total })
}

// ---------------- status ----------------

async function status(): Promise<NextResponse> {
  const [cursor, totals, balance, benchCount] = await Promise.all([
    readConfigJson<Cursor>(CURSOR_KEY, { page: 1, done: false }),
    readConfigJson<Totals>(TOTALS_KEY, { verified: 0, inserted: 0, missed: 0, pages: 0, dupes: 0, skipped: 0 }),
    tregBalanceMicro({ fresh: true }),
    (async () => {
      const master = await db.user.findFirst({ where: { email: MASTER_EMAIL }, select: { id: true } })
      if (!master) return 0
      return db.lead.count({ where: { userId: master.id, source: 'TREG', stage: 'NEW', emailLogs: { none: {} } } })
    })(),
  ])
  return NextResponse.json({ ok: true, action: 'status', cursor, totals, balanceMicro: balance, balanceUsd: balance != null ? Number((balance / 1e6).toFixed(4)) : null, benchUntouched: benchCount })
}

export async function POST(req: NextRequest) {
  if (!TREG_TOKEN || TREG_TOKEN.length <= 20) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string }
  switch (body.action) {
    case 'collect': return collect()
    case 'stage': return stage()
    case 'harden': return harden()
    case 'status': return status()
    default: return NextResponse.json({ error: 'action must be collect | stage | harden | status' }, { status: 400 })
  }
}
