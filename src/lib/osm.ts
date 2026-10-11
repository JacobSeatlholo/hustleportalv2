/**
 * OSM lead sourcing — REAL businesses from OpenStreetMap (Overpass API + Nominatim).
 *
 * Why this exists: Gemini's google_search grounding has its own quota bucket and can
 * 429 while plain generation still works. Fabricated "demo" leads are banned, so the
 * honest fallback is a REAL, queryable directory: OpenStreetMap business POIs carry
 * name, phone, website, email, address — actual, publicly mappable facts.
 *
 * Flow: (optional plain-Gemini step translates the seller's need into OSM tag filters)
 *       → Nominatim geocodes the area → Overpass returns name-bearing POIs with contacts.
 * Gemini NEVER generates the business data itself — Overpass is the source of truth.
 */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const UA = 'HustlePortalBot/1.0 (https://hustleportal.online)'

export interface OsmLead {
  company: string
  contactName?: string
  email?: string
  phone?: string
  website?: string
  industry?: string
  city?: string
  why?: string
  score?: number
  externalId?: string
}

function tagIndustry(tags: Record<string, string>): string | undefined {
  const raw =
    tags.shop || tags.amenity || tags.office || tags.craft || tags.healthcare || tags.leisure
  if (!raw) return undefined
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Nominatim: "Soweto" → an Overpass filter: an area id OR a radius around a node. */
async function geocodePlace(area: string): Promise<{ areaId?: number; lat?: number; lon?: number } | null> {
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(area + ', South Africa')}&format=jsonv2&limit=1&countrycodes=za`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const rows = (await res.json()) as { osm_type?: string; osm_id?: number; lat?: string; lon?: string }[]
    const row = rows[0]
    if (!row) return null
    // relation → 3600_000_000 + id; way → 2400_000_000 + id
    if (row.osm_type === 'relation' && row.osm_id) return { areaId: 3_600_000_000 + row.osm_id }
    if (row.osm_type === 'way' && row.osm_id) return { areaId: 2_400_000_000 + row.osm_id }
    // Nodes (suburbs, townships, small towns) → search a radius around the pin.
    const lat = parseFloat(row.lat || '')
    const lon = parseFloat(row.lon || '')
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) return { lat, lon }
    return null
  } catch {
    return null
  }
}

/**
 * Translate the seller's need into OSM tag filters (plain Gemini, json mode).
 * Returns e.g. { regex: "^(hairdresser|beauty)$", keys: ["shop"] } style filters,
 * or null when the caller should use the generic sweep.
 */
export function buildTagRegexFromDefinition(definition: string): { key: string; regex: string }[] {
  const d = definition.toLowerCase()
  const map: { match: RegExp; key: string; values: string[] }[] = [
    { match: /tavern|bar|pub|shebeen|liquor/, key: 'amenity', values: ['bar', 'pub', 'biergarten'] },
    { match: /restaurant|food|kota|catering|kitchen|takeaway|fast/, key: 'amenity', values: ['restaurant', 'fast_food', 'cafe', 'food_court'] },
    { match: /salon|beauty|hair|nail|spa/, key: 'shop', values: ['hairdresser', 'beauty', 'massage', 'nails', 'cosmetics'] },
    { match: /clothing|fashion|boutique|sneaker|retail shop|spaza|grocery|shop|store|supermarket/, key: 'shop', values: ['clothes', 'supermarket', 'convenience', 'general', 'variety_store', 'boutique', 'shoes'] },
    { match: /construction|building|plumbing|electrician|renovat|hardware|builders/, key: 'craft', values: ['builder', 'plumber', 'electrician', 'carpenter', 'handicraft'] },
    { match: /hardware|build material/, key: 'shop', values: ['hardware', 'doityourself', 'trade'] },
    { match: /security|guard|alarm/, key: 'office', values: ['security', 'private_investigator'] },
    { match: /logistics|transport|courier|delivery|shuttle|taxi/, key: 'office', values: ['logistics', 'forwarding', 'courier'] },
    { match: /taxi|shuttle| Uber/, key: 'amenity', values: ['taxi'] },
    { match: /cleaning|laundry|dry clean/, key: 'shop', values: ['laundry', 'dry_cleaning'] },
    { match: /print|branding|signage|stationery/, key: 'shop', values: ['copyshop', 'printing', 'stationery', 'sign'] },
    { match: /school|training|academy|tutor|daycare|creche/, key: 'amenity', values: ['school', 'college', 'training', 'kindergarten', 'childcare'] },
    { match: /clinic|health|doctor|dentist|pharmacy|medical/, key: 'amenity', values: ['clinic', 'doctors', 'dentist', 'pharmacy'] },
    { match: /gym|fitness/, key: 'leisure', values: ['fitness_centre', 'sports_centre'] },
    { match: /funeral|mortuary/, key: 'shop', values: ['funeral_directors'] },
    { match: /estate|property|rental/, key: 'office', values: ['estate_agent', 'property_management'] },
    { match: /law|attorney|legal|conveyanc/, key: 'office', values: ['lawyer'] },
    { match: /account|bookkeep|tax|audit/, key: 'office', values: ['accountant', 'tax_advisor'] },
    { match: /insurance/, key: 'office', values: ['insurance'] },
    { match: /it|tech|software|web|computer/, key: 'shop', values: ['computer', 'mobile_phone', 'electronics'] },
    { match: /car|panel|mechanic|tyre|spare/, key: 'shop', values: ['car_repair', 'car_parts', 'tyres', 'car'] },
  ]
  for (const m of map) {
    if (m.match.test(d)) {
      return [{ key: m.key, regex: `^(${m.values.join('|')})$` }]
    }
  }
  return []
}

function overpassQuery(place: { areaId?: number; lat?: number; lon?: number }, tagFilters: { key: string; regex: string }[], limit: number): string {
  const filters = tagFilters.length
    ? tagFilters.map((t) => `nwr["name"]["${t.key}"~"${t.regex}",i](around.RADIUS,LAT,LON);`)
    : [
        'nwr["name"]["shop"](around.RADIUS,LAT,LON);',
        'nwr["name"]["office"](around.RADIUS,LAT,LON);',
        'nwr["name"]["craft"](around.RADIUS,LAT,LON);',
        'nwr["name"]["healthcare"](around.RADIUS,LAT,LON);',
        'nwr["name"]["amenity"~"^(restaurant|fast_food|cafe|bar|pub|pharmacy|clinic|school|college|taxi)$",i](around.RADIUS,LAT,LON);',
      ]
  let scope: string
  if (place.areaId) {
    scope = `area(${place.areaId})->.searchArea;`
    return `[out:json][timeout:25];
${scope}
(
${filters.map((f) => f.replace(/\(around\.RADIUS,LAT,LON\)/g, '(area.searchArea)')).join('\n')}
);
out tags center ${Math.max(limit * 6, 60)};`
  }
  const radius = 8000 // metros/townships: 8 km around the resolved pin
  return `[out:json][timeout:25];
(
${filters.map((f) => f.replace('RADIUS', String(radius)).replace('LAT', String(place.lat)).replace('LON', String(place.lon))).join('\n')}
);
out tags center ${Math.max(limit * 6, 60)};`
}

export async function searchOsmLeads(
  area: string,
  definition: string,
  limit: number
): Promise<{ leads: OsmLead[]; note?: string }> {
  const place = await geocodePlace(area)
  if (!place) return { leads: [], note: `Could not map "${area}" to a map area — check the spelling.` }

  const tagFilters = buildTagRegexFromDefinition(definition)
  const runOverpass = async (query: string): Promise<{ ok: boolean; data?: { elements?: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] }; status?: number }> => {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) continue // mirror busy/blocked — try the next one
        const json = (await res.json()) as { elements?: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] }
        return { ok: true, data: json }
      } catch {
        continue
      }
    }
    return { ok: false, status: 503 }
  }
  try {
    let result = await runOverpass(overpassQuery(place, tagFilters, limit))
    // Category too narrow for this area (common in townships) → one generic sweep of
    // ALL named businesses. Still 100% real directory data.
    if ((!result.ok || (result.data?.elements || []).length === 0) && tagFilters.length > 0) {
      result = await runOverpass(overpassQuery(place, [], limit))
    }
    if (!result.ok) return { leads: [], note: 'The map directory is busy right now — try again in a minute.' }
    const data = result.data!
    const seen = new Set<string>()
    const leads: OsmLead[] = []
    for (const el of data.elements || []) {
      const t = el.tags || {}
      const name = (t.name || '').trim()
      if (!name) continue
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      const lat = el.lat ?? el.center?.lat
      const lon = el.lon ?? el.center?.lon
      const suburb = t['addr:suburb'] || t['addr:neighbourhood'] || t['addr:town']
      leads.push({
        company: name,
        contactName: t['contact:person'] || undefined,
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email || '') ? t.email : undefined,
        phone: (t.phone || t['contact:phone'] || '').trim() || undefined,
        website: (t.website || t['contact:website'] || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || undefined,
        industry: tagIndustry(t),
        city: suburb || t['addr:city'] || area,
        why: `Listed on OpenStreetMap${t['opening_hours'] ? ' · open ' + t['opening_hours'] : ''}${suburb ? ' · ' + suburb : area ? ' · ' + area : ''}${lat && lon ? ` (pin ${lat.toFixed(4)}, ${lon.toFixed(4)})` : ''} — a real, mappable business${tagFilters.length ? ' matching what you sell' : ''}.`,
        score: tagFilters.length ? 4 : 3,
        externalId: `osm_${el.type}_${el.id}`,
      })
      if (leads.length >= limit) break
    }
    return { leads, note: leads.length ? undefined : 'No named businesses with contact details matched that category in this area yet.' }
  } catch {
    return { leads: [], note: 'Could not reach the map directory — try again shortly.' }
  }
}
