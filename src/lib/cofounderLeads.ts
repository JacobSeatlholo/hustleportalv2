import { db } from '@/lib/db'

/**
 * cofounderLeads.ts — the AI Co-Founder's lead search.
 *
 * When a member asks the Co-Founder for a specific kind of lead ("find me a
 * plumber in Durban"), the chat should not just give advice — it should check
 * the house pool FIRST and say what is actually there. This module parses the
 * ask into (trade words + city), runs one free query against LeadPool and
 * returns honest matches.
 *
 * Money law: the pool search is FREE — it is our own database. Contact
 * details stay exactly where they belong: behind the Lead Finder scan and the
 * reveal flow. The chat never hands out phones or emails, and the treg
 * external search is the owner's exec tool, never a member chat toy.
 */

export interface PoolMatch {
  company: string
  industry: string | null
  city: string | null
  hasPhone: boolean
  hasWebsite: boolean
  score: number | null
}

export interface PoolSearchResult {
  /** True when the message read like a lead ask we acted on. */
  matched: boolean
  /** The trade words we searched for (human readable). */
  terms: string[]
  city: string | null
  /** Total rows matching, of which matches shows the top few. */
  total: number
  matches: PoolMatch[]
  /** A ready context block for the advisor prompt (empty when no match). */
  context: string
}

const SA_CITIES = [
  'johannesburg', 'joburg', 'jhb', 'durban', 'cape town', 'cpt', 'pretoria', 'tshwane',
  'soweto', 'sandton', 'midrand', 'randburg', 'roodepoort', 'krugersdorp', 'centurion',
  'tembisa', 'katlehong', 'alexandra', 'diepsloot', 'mamelodi', 'atteridgeville',
  'benoni', 'boksburg', 'kempton park', 'germiston', 'vanderbijlpark', 'vereeniging',
  'pietermaritzburg', 'pmb', 'umlazi', 'kwamashu', 'chatsworth', 'phoenix', 'pinetown',
  'hillcrest', 'kloof', 'westville', 'umhlanga', 'ballito', 'richards bay',
  'nelspruit', 'mbombela', 'polokwane', 'rustenburg', 'bloemfontein', 'kimberley',
  'east london', 'gqeberha', 'port elizabeth', 'mthatha', 'bizana', 'motherwell',
  'george', 'knysna', 'plettenberg bay', 'stellenbosch', 'paarl', 'worcester',
  'bellville', 'khayelitsha', 'mitchells plain', 'strand', 'somerset west',
  'witbank', 'emalahleni', 'middelburg', 'secunda', 'newcastle', 'ladysmith',
  'potchefstroom', 'klerksdorp', 'welkom', 'sasolburg', 'springs', 'nigel', 'heidelberg',
]

const LEAD_NOUN = /\b(lead|leads|client|clients|customer|customers|buyer|buyers|business|businesses|company|companies|seller|sellers|shop|shops|store|stores|spaza|people|someone|anyone|anybody|vendor|vendors|supplier|suppliers)\b/i
const SEARCH_VERB = /\b(find|finding|looking for|look for|get me|need|search|searching|source|show me|who is|who are|who does|who needs|any)\b/i
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'has', 'are', 'was', 'were', 'you', 'your', 'ours', 'our',
  'find', 'finding', 'looking', 'look', 'get', 'need', 'needs', 'search', 'searching', 'source', 'show', 'want',
  'lead', 'leads', 'client', 'clients', 'customer', 'customers', 'buyer', 'buyers', 'business', 'businesses',
  'company', 'companies', 'seller', 'sellers', 'shop', 'shops', 'store', 'stores', 'people', 'someone', 'anyone',
  'anybody', 'some', 'any', 'who', 'what', 'where', 'there', 'here', 'please', 'can', 'could', 'would', 'like',
  'from', 'near', 'around', 'into', 'onto', 'about', 'them', 'they', 'their', 'mine', 'pool',
  'south', 'africa', 'african', 'sa', 'area', 'town', 'city', 'hustle', 'portal', 'today', 'tomorrow', 'week',
])

export interface AskHint { city?: string | null; industry?: string | null }

/** Parse a chat message into lead-ask parts. Returns null when it is not a lead ask. */
export function parseLeadAsk(message: string, hint?: AskHint): { terms: string[]; city: string | null } | null {
  const m = String(message || '').slice(0, 500)
  if (!m.trim()) return null
  if (!(SEARCH_VERB.test(m) && (LEAD_NOUN.test(m) || /\bwho\b/i.test(m)))) return null

  const low = m.toLowerCase()
  const city = SA_CITIES.find((c) => low.includes(c)) || (hint?.city ? String(hint.city).toLowerCase().trim() : null) || null

  const tokens = low
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^'-'+|'+$/g, '').trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !(city && t === city) && !SA_CITIES.includes(t))
  // de-dup, keep order, cap at 3 so the query stays sharp
  const terms: string[] = []
  for (const t of tokens) {
    if (!terms.includes(t)) terms.push(t)
    if (terms.length >= 3) break
  }
  if (terms.length === 0 && hint?.industry) {
    for (const t of String(hint.industry).toLowerCase().split(/[\s,/]+/)) {
      if (t.length >= 3 && !STOPWORDS.has(t) && !terms.includes(t)) terms.push(t)
      if (terms.length >= 2) break
    }
  }
  if (terms.length === 0 && !city) return null
  return { terms, city }
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Search the house pool for a lead ask. NEVER THROWS — a pool hiccup must
 * never break the chat; failure reads as "no matches this time".
 */
export async function searchPoolForAsk(message: string, hint?: AskHint): Promise<PoolSearchResult> {
  const empty: PoolSearchResult = { matched: false, terms: [], city: null, total: 0, matches: [], context: '' }
  try {
    const parsed = parseLeadAsk(message, hint)
    if (!parsed) return empty

    const andBlock: Record<string, unknown>[] = [{ active: true }]
    if (parsed.city) {
      andBlock.push({
        OR: [
          { city: { contains: parsed.city, mode: 'insensitive' as const } },
          { areaLabel: { contains: parsed.city, mode: 'insensitive' as const } },
        ],
      })
    }
    if (parsed.terms.length > 0) {
      andBlock.push({
        OR: parsed.terms.flatMap((t) => [
          { industry: { contains: t, mode: 'insensitive' as const } },
          { company: { contains: t, mode: 'insensitive' as const } },
        ]),
      })
    }
    const where = { active: true, AND: andBlock }

    const [rows, total] = await Promise.all([
      db.leadPool.findMany({
        where,
        select: { company: true, industry: true, city: true, phone: true, website: true, score: true },
        orderBy: [{ feedbackBad: 'asc' }, { verifyScore: 'desc' }, { lastSeenAt: 'desc' }],
        take: 6,
      }),
      db.leadPool.count({ where }),
    ])

    const matches: PoolMatch[] = rows.map((r) => ({
      company: r.company,
      industry: r.industry,
      city: r.city,
      hasPhone: !!r.phone,
      hasWebsite: !!r.website,
      score: r.score,
    }))

    const what = parsed.terms.length ? parsed.terms.map(titleCase).join(' / ') : 'that kind of business'
    const whereTxt = parsed.city ? titleCase(parsed.city) : 'across SA'
    const context =
      total > 0
        ? `HOUSE POOL SEARCH: ${total} matching row${total === 1 ? '' : 's'} for "${what}" ${parsed.city ? 'in ' + whereTxt : whereTxt}. Top names: ${matches
            .map((m) => `${m.company}${m.city ? ` (${m.city})` : ''}${m.hasPhone ? ' [phone on file]' : ''}${m.hasWebsite ? ' [site on file]' : ''}`)
            .join('; ')}. Tell the member these businesses are in the house pool and they can scan and reveal full contact details with the Lead Finder on the Leads tab — do NOT write out any phone number or email in chat.`
        : `HOUSE POOL SEARCH: nothing in the house pool for "${what}" ${parsed.city ? 'in ' + whereTxt : whereTxt} right now. Suggest the member run the Lead Finder (Leads tab) to scan fresh, and offer to note what they sell and where so the next scan is sharper.`

    return { matched: true, terms: parsed.terms, city: parsed.city, total, matches, context }
  } catch (e) {
    console.error('[cofounderLeads] pool search failed (chat continues):', e)
    return empty
  }
}
