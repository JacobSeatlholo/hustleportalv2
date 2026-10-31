import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { submitReviewLeads } from '@/lib/xpitchReview'
import { tregEnabled, tregProbeCall, tregProbeSpendMicro, TREG_PROBE_BUDGET_USD } from '@/lib/tregverify'

export const maxDuration = 60

/**
 * /api/admin/exec/xpitch/search — THE CO-FOUNDER FINDS LEADS THROUGH TREG.
 *
 * The boss types an ask ("shisanyama soweto", "mobile nail tech johannesburg")
 * and a platform; the route runs ONE metered treg search (X or TikTok),
 * keeps the South Africans, stamps freshness on the best ones (one extra
 * metered call each, capped), and drops the candidates in the REVIEW QUEUE —
 * never straight into the pipeline. The boss's go/no-go stays the only door.
 *
 * Money honesty, the whole chain visible in the response:
 *   - every call rides the probe ledger (via 'probe') and its durable
 *     lifetime counter (TREG_PROBE_BUDGET_USD, $1.00 hard cap);
 *   - the route refuses before spending when the remaining budget cannot
 *     cover the worst case of the request;
 *   - X search $0.00075/call, TikTok search $0.001/call, freshness
 *     $0.0005–$0.015/call — all confirmed against the catalog first;
 *   - Facebook has NO cheap door: the only endpoint is $0.1221/call
 *     (about R2.20), so it is refused unless the body carries
 *     confirmCost: true — an explicit, informed decision, never a slip.
 */

const SEARCH_ENDPOINT: Record<string, string> = {
  x: 'anyapi.twitter.search_users',      // $0.00075 per success (verified, catalog)
  tiktok: 'treg.tiktok.search.users',    // ~$0.001 per success (misses free)
  facebook: 'anyapi.facebook.search_pages', // $0.1221 per call — pricey, gated below
}

const FRESH_ENDPOINT: Record<string, string> = {
  x: 'treg.x.user.posts',        // body {username}; posts[] carry created_at
  tiktok: 'treg.tiktok.user.videos', // body {sec_uid, limit}; videos[] carry create_time
}

const MAX_CALL_COST_USD = 0.02 // hard ceiling per call; real costs sit near $0.001
const DEFAULT_FRESH_CHECKS = 5

// ---------- classification helpers (same spirit as the sweep scripts) ----------

const TRADE_WORDS = [
  'plumber', 'electrician', 'salon', 'hair', 'barber', 'nails', 'lashes', 'beauty', 'spa',
  'cleaning', 'clean', 'photographer', 'photo', 'videographer', 'shisanyama', 'braai',
  'catering', 'caterer', 'baker', 'bakery', 'shuttle', 'driver', 'courier', 'delivery',
  'tailor', 'fashion', 'sneakers', 'dj', 'events', 'decor', 'builder', 'construction',
  'landscaping', 'gardening', 'mechanic', 'panel', 'towing', 'solar', 'geyser', 'pest',
  'tutor', 'lessons', 'fitness', 'gym', 'training', 'nail', 'makeup', 'welding', 'carpentry',
  'paving', 'painting', 'pool', 'security', 'aircon', 'appliance', 'repair', 'tech', 'phones',
]

const CITY_WORDS = [
  'durban', 'johannesburg', 'joburg', 'jhb', 'cape town', 'capetown', 'pretoria', 'tshwane',
  'soweto', 'sandton', 'midrand', 'randburg', 'roodepoort', 'krugersdorp', 'centurion',
  'tembisa', 'katlehong', 'alexandra', 'mamelodi', 'benoni', 'boksburg', 'kempton park',
  'pietermaritzburg', 'pmb', 'umlazi', 'kwamashu', 'chatsworth', 'phoenix', 'pinetown',
  'hillcrest', 'kloof', 'westville', 'umhlanga', 'ballito', 'nelspruit', 'mbombela',
  'polokwane', 'rustenburg', 'bloemfontein', 'east london', 'gqeberha', 'port elizabeth',
  'mthatha', 'george', 'stellenbosch', 'paarl', 'khayelitsha', 'mitchells plain', 'witbank',
  'emalahleni', 'middelburg', 'newcastle', 'potchefstroom', 'klerksdorp', 'welkom', 'springs',
]

const CITY_TITLE: Record<string, string> = {
  johannesburg: 'Johannesburg', joburg: 'Johannesburg', jhb: 'Johannesburg',
  durban: 'Durban', 'cape town': 'Cape Town', capetown: 'Cape Town',
  pretoria: 'Pretoria', tshwane: 'Pretoria', soweto: 'Soweto', sandton: 'Sandton',
  midrand: 'Midrand', randburg: 'Randburg', roodepoort: 'Roodepoort', krugersdorp: 'Krugersdorp',
  centurion: 'Centurion', tembisa: 'Tembisa', katlehong: 'Katlehong', alexandra: 'Alexandra',
  mamelodi: 'Mamelodi', benoni: 'Benoni', boksburg: 'Boksburg', 'kempton park': 'Kempton Park',
  pietermaritzburg: 'Durban', pmb: 'Durban', umlazi: 'Durban', kwamashu: 'Durban',
  chatsworth: 'Durban', phoenix: 'Durban', pinetown: 'Durban', hillcrest: 'Durban',
  kloof: 'Durban', westville: 'Durban', umhlanga: 'Durban', ballito: 'Durban',
  nelspruit: 'Nelspruit', mbombela: 'Nelspruit', polokwane: 'Polokwane', rustenburg: 'Rustenburg',
  bloemfontein: 'Bloemfontein', 'east london': 'East London', gqeberha: 'Gqeberha',
  'port elizabeth': 'Gqeberha', mthatha: 'Mthatha', george: 'George', stellenbosch: 'Stellenbosch',
  paarl: 'Paarl', khayelitsha: 'Cape Town', 'mitchells plain': 'Cape Town', witbank: 'Witbank',
  emalahleni: 'Witbank', middelburg: 'Middelburg', newcastle: 'Newcastle',
  potchefstroom: 'Potchefstroom', klerksdorp: 'Klerksdorp', welkom: 'Welkom', springs: 'Springs',
}

function looksSouthAfrican(text: string, region?: string | null): boolean {
  if (region === 'ZA') return true
  const low = String(text || '').toLowerCase()
  if (/(south africa|southafrica|s\.a\.?|mzansi|joburg|jhb|durban|cape town|soweto|pretoria|sandton|south african)/.test(low)) return true
  if (/(\+27|27\d{9}|0\d{9}|wa\.me\/27|\.co\.za)/.test(low.replace(/\s/g, ''))) return true
  return false
}

function guessCity(text: string): string {
  const low = String(text || '').toLowerCase()
  for (const c of CITY_WORDS) {
    if (low.includes(c)) return CITY_TITLE[c] || c
  }
  return ''
}

function guessTrade(text: string): string {
  const low = String(text || '').toLowerCase()
  for (const t of TRADE_WORDS) {
    if (low.includes(t)) return t
  }
  return 'unsorted'
}

function extractContacts(text: string): { phone: string; email: string } {
  const t = String(text || '')
  const email = (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [''])[0].toLowerCase()
  let phone = ''
  const wa = t.match(/wa\.me\/(\+?\d{9,14})/i)
  if (wa) {
    phone = wa[1].replace(/^\+/, '')
  } else {
    const m = t.match(/(?:\+27|27|0)(?:\d[\s.-]?){8,9}\d/)
    if (m) {
      const digits = m[0].replace(/\D/g, '')
      if (digits.length >= 9 && digits.length <= 12) phone = digits.startsWith('0') ? digits : digits
    }
  }
  return { phone, email }
}

function freshStamp(latestMs: number | null): { fresh: 'fresh' | 'warm' | 'stale' | 'no-posts'; lastPost: string } {
  if (!latestMs) return { fresh: 'no-posts', lastPost: '' }
  const days = Math.floor((Date.now() - latestMs) / 86_400_000)
  const fresh = days <= 21 ? 'fresh' : days <= 60 ? 'warm' : 'stale'
  return { fresh, lastPost: new Date(latestMs).toISOString().slice(0, 10) }
}

function asMs(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

function pickLatestTime(rows: unknown[], keys: string[]): number | null {
  let best: number | null = null
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    for (const k of keys) {
      const ms = asMs(row[k])
      if (ms && (best === null || ms > best)) best = ms
    }
  }
  return best
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  if (!tregEnabled) {
    return NextResponse.json({ error: 'TREG_TOKEN is not set on this deployment — no external search.' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const ask = String(body?.ask || '').trim().slice(0, 140)
  const platform = String(body?.platform || 'x').trim().toLowerCase()
  const wantFresh = body?.fresh !== false
  const maxFresh = Math.min(Math.max(Number(body?.maxFresh) || DEFAULT_FRESH_CHECKS, 0), 8)
  const confirmCost = body?.confirmCost === true

  if (ask.length < 3) {
    return NextResponse.json({ error: 'Describe the lead you want (at least 3 characters).' }, { status: 400 })
  }
  if (!['x', 'tiktok', 'facebook'].includes(platform)) {
    return NextResponse.json({ error: 'platform must be x, tiktok or facebook.' }, { status: 400 })
  }
  if (platform === 'facebook' && !confirmCost) {
    return NextResponse.json(
      {
        error: 'Facebook search is the expensive door: the only endpoint in the catalog charges $0.1221 per call (about R2.20) — roughly 160x the X search. Nothing was spent. If you want it anyway, send confirmCost: true and it runs as one call.',
        priceUsd: 0.1221,
      },
      { status: 402 }
    )
  }

  // Lifetime budget guard, read BEFORE a cent is spent: this request needs at
  // worst 1 search call + maxFresh freshness calls at MAX_CALL_COST_USD each.
  const spentBefore = await tregProbeSpendMicro()
  const capMicro = Math.round(TREG_PROBE_BUDGET_USD * 1e6)
  const worstCaseMicro = Math.round((MAX_CALL_COST_USD * (1 + maxFresh)) * 1e6)
  if (spentBefore + worstCaseMicro > capMicro) {
    return NextResponse.json(
      {
        ok: false,
        budgetReached: true,
        budget: { capUsd: TREG_PROBE_BUDGET_USD, spentUsd: Number((spentBefore / 1e6).toFixed(4)), remainingUsd: Number((Math.max(0, capMicro - spentBefore) / 1e6).toFixed(4)) },
        error: 'The treg probe budget cannot cover this search worst-case. Nothing was spent. Raise TREG_PROBE_BUDGET_USD deliberately in code if the door earns it.',
      },
      { status: 402 }
    )
  }

  // 1) the search call itself
  const searchArgs =
    platform === 'x'
      ? { method: 'POST', body: { query: ask } }
      : { method: 'POST', body: { q: ask } }
  const search = await tregProbeCall(SEARCH_ENDPOINT[platform], searchArgs, { timeoutMs: 30_000, maxCostUsd: MAX_CALL_COST_USD })
  let costUsd = search.costUsd ?? 0

  if (!search.ok) {
    const spentNow = await tregProbeSpendMicro()
    return NextResponse.json(
      {
        ok: false,
        error: `The ${platform} search bought nothing: ${search.error || 'treg error'}.`,
        costUsd,
        budget: {
          capUsd: TREG_PROBE_BUDGET_USD,
          spentUsd: Number((spentNow / 1e6).toFixed(4)),
          remainingUsd: Number((Math.max(0, capMicro - spentNow) / 1e6).toFixed(4)),
        },
      },
      { status: 502 }
    )
  }

  // 2) parse candidates, keep the South Africans
  const out = (search.body as { output?: Record<string, unknown> } | null)?.output ?? {}
  type Raw = Record<string, unknown>
  let rawRows: Raw[] = []
  if (platform === 'x') {
    rawRows = ((out as { data?: { users?: Raw[] } }).data?.users || []) as Raw[]
  } else {
    rawRows = ((out as { users?: Raw[] }).users || []) as Raw[]
  }

  interface Candidate {
    handle: string
    name: string
    trade: string
    city: string
    followers: number
    url: string
    phone: string
    email: string
    fresh: 'fresh' | 'warm' | 'stale' | 'no-posts' | 'unknown'
    lastPost: string
    secUid?: string
  }

  const kept: Candidate[] = []
  let dropped = 0
  for (const u of rawRows) {
    const handle = String(u.username || u.handle || '').trim()
    if (!handle) { dropped++; continue }
    const name = String(u.name || u.nickname || handle).trim()
    const bio = String(u.bio || u.signature || '')
    const region = u.region ? String(u.region) : null
    const hay = `${bio} ${name} ${u.location ? String(u.location) : ''}`
    if (!looksSouthAfrican(hay, region)) { dropped++; continue }
    const contacts = extractContacts(bio)
    kept.push({
      handle,
      name,
      trade: guessTrade(`${bio} ${name}`),
      city: guessCity(`${bio} ${u.location ? String(u.location) : ''} ${ask}`) || 'SA',
      followers: Math.max(0, Math.round(Number(u.followers) || 0)),
      url: platform === 'x' ? (String(u.profileUrl || '') || `https://x.com/${handle}`) : `https://www.tiktok.com/@${handle}`,
      phone: contacts.phone,
      email: contacts.email,
      fresh: 'unknown',
      lastPost: '',
      secUid: u.secUid ? String(u.secUid) : undefined,
    })
  }

  // 3) freshness: one capped metered call per checked account, best-first
  const toCheck = wantFresh
    ? [...kept].sort((a, b) => b.followers - a.followers).slice(0, maxFresh)
    : []
  for (const c of toCheck) {
    const args =
      platform === 'x'
        ? { method: 'POST', body: { username: c.handle } }
        : { method: 'POST', body: { sec_uid: c.secUid || c.handle, limit: 3 } }
    const r = await tregProbeCall(FRESH_ENDPOINT[platform], args, { timeoutMs: 25_000, maxCostUsd: MAX_CALL_COST_USD })
    costUsd += r.costUsd ?? 0
    if (!r.ok) continue // freshness is a bonus; unknown is an honest stamp
    const outF = (r.body as { output?: Record<string, unknown> } | null)?.output ?? {}
    const rows = (platform === 'x' ? (outF as { posts?: unknown[] }).posts : (outF as { videos?: unknown[] }).videos) || []
    const stamp = freshStamp(pickLatestTime(Array.isArray(rows) ? rows : [], platform === 'x' ? ['created_at', 'createdAt', 'createdUtc', 'timestamp'] : ['create_time', 'createTime', 'timestamp']))
    c.fresh = stamp.fresh
    c.lastPost = stamp.lastPost
  }

  // 4) into the review queue — never straight into the pipeline
  const submitted = kept.map((c) => ({ ...c, platform, source: 'ai-search', note: ask.slice(0, 120) }))
  const r = await submitReviewLeads(submitted)
  const spentAfter = await tregProbeSpendMicro()

  return NextResponse.json({
    ok: true,
    platform,
    ask,
    providerRows: rawRows.length,
    southAfrican: kept.length,
    droppedNonSa: dropped,
    freshChecked: toCheck.length,
    added: r.added,
    skipped: r.skipped,
    queueCount: r.queueCount,
    costUsd: Number(costUsd.toFixed(4)),
    budget: {
      capUsd: TREG_PROBE_BUDGET_USD,
      spentUsd: Number((spentAfter / 1e6).toFixed(4)),
      remainingUsd: Number((Math.max(0, capMicro - spentAfter) / 1e6).toFixed(4)),
    },
    message: `${kept.length} South African candidate${kept.length === 1 ? '' : 's'} from ${rawRows.length} rows; ${r.added} new in the review queue. This search cost $${costUsd.toFixed(4)} — probe budget $${((capMicro - spentAfter) / 1e6).toFixed(2)} left. Nothing joins the pitch list until you say so.`,
  })
}
