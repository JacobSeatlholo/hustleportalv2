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
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
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
    const lat = parseFloat(row.lat || '')
    const lon = parseFloat(row.lon || '')
    // relation → 3600_000_000 + id; way → 2400_000_000 + id
    if (row.osm_type === 'relation' && row.osm_id) return { areaId: 3_600_000_000 + row.osm_id, lat, lon }
    if (row.osm_type === 'way' && row.osm_id) return { areaId: 2_400_000_000 + row.osm_id, lat, lon }
    // Nodes (suburbs, townships, small towns) → search a radius around the pin.
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) return { lat, lon }
    return null
  } catch {
    return null
  }
}

/**
 * Translate the seller's need into OSM tag filters AND a human category term for
 * Nominatim's category search (which works from datacenter IPs where Overpass
 * mirrors refuse traffic).
 */
export function buildTagFilters(definition: string): { tags: { key: string; regex: string }[]; term?: string } {
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
      return { tags: [{ key: m.key, regex: `^(${m.values.join('|')})$` }] }
    }
  }
  return { tags: [] }
}

/** Human-readable category term + key/value for Nominatim category search. */
export function buildNominatimQuery(definition: string): { kv?: { key: string; value: string }; term?: string } {
  const d = definition.toLowerCase()
  const kvMap: { match: RegExp; key: string; values: string[] }[] = [
    { match: /tavern|shebeen|liquor/, key: 'amenity', values: ['bar', 'pub'] },
    { match: /\bbar\b|\bpub\b/, key: 'amenity', values: ['bar', 'pub'] },
    { match: /restaurant|food|kota|catering|kitchen|takeaway/, key: 'amenity', values: ['restaurant', 'fast_food', 'cafe'] },
    { match: /cafe|coffee/, key: 'amenity', values: ['cafe'] },
    { match: /salon|beauty|hair|nail|spa/, key: 'shop', values: ['hairdresser', 'beauty'] },
    { match: /spaza|grocery|supermarket|store|shop|retail/, key: 'shop', values: ['supermarket', 'convenience', 'clothes'] },
    { match: /construction|building|plumbing|electrician|renovat/, key: 'craft', values: ['builder', 'plumber', 'electrician'] },
    { match: /hardware|build material/, key: 'shop', values: ['hardware', 'doityourself'] },
    { match: /security|guard|alarm/, key: 'office', values: ['security'] },
    { match: /logistics|transport|courier|delivery/, key: 'office', values: ['logistics', 'courier'] },
    { match: /cleaning|laundry|dry clean/, key: 'shop', values: ['laundry', 'dry_cleaning'] },
    { match: /print|branding|signage|stationery/, key: 'shop', values: ['copyshop', 'stationery'] },
    { match: /school|training|academy|tutor|daycare|creche/, key: 'amenity', values: ['school', 'college', 'kindergarten'] },
    { match: /clinic|health|doctor|dentist|pharmacy|medical/, key: 'amenity', values: ['clinic', 'doctors', 'dentist', 'pharmacy'] },
    { match: /gym|fitness/, key: 'leisure', values: ['fitness_centre', 'sports_centre'] },
    { match: /funeral|mortuary/, key: 'shop', values: ['funeral_directors'] },
    { match: /estate|property|rental/, key: 'office', values: ['estate_agent'] },
    { match: /law|attorney|legal/, key: 'office', values: ['lawyer'] },
    { match: /account|bookkeep|tax_|audit/, key: 'office', values: ['accountant'] },
    { match: /insurance/, key: 'office', values: ['insurance'] },
    { match: /\bit\b|tech|software|web|computer|phone repair/, key: 'shop', values: ['computer', 'mobile_phone', 'electronics'] },
    { match: /car|panel|mechanic|tyre|spare/, key: 'shop', values: ['car_repair', 'car_parts', 'tyres'] },
  ]
  for (const m of kvMap) {
    if (m.match.test(d)) {
      const value = m.values[0]
      const term = value.replace(/_/g, ' ')
      return { kv: { key: m.key, value }, term }
    }
  }
  return {}
}

function overpassQuery(place: { areaId?: number; lat?: number; lon?: number }, tagFilters: { key: string; regex: string }[], limit: number, useGpsPin = false): string {
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
  // GPS pin → tight 5 km around the user's real position; city geocode → 8 km metro default
  const radius = useGpsPin ? 5000 : 8000
  return `[out:json][timeout:25];
(
${filters.map((f) => f.replace('RADIUS', String(radius)).replace('LAT', String(place.lat)).replace('LON', String(place.lon))).join('\n')}
);
out tags center ${Math.max(limit * 6, 60)};`
}

/**
 * Nominatim category search — same OpenStreetMap data, works from datacenter IPs.
 * extratags=1 returns website/phone/email where mapped. Real businesses or nothing.
 */
async function searchNominatimLeads(
  area: string,
  definition: string,
  limit: number
): Promise<{ leads: OsmLead[]; note?: string }> {
  const { kv } = buildNominatimQuery(definition)
  if (!kv) return { leads: [] }
  try {
    const params = new URLSearchParams({
      [kv.key]: kv.value,
      city: area,
      countrycodes: 'za',
      format: 'jsonv2',
      limit: String(Math.min(limit * 3, 40)),
      addressdetails: '1',
      extratags: '1',
    })
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { leads: [] }
    const rows = (await res.json()) as {
      osm_id?: number
      category?: string
      type?: string
      name?: string
      display_name?: string
      lat?: string
      lon?: string
      address?: Record<string, string>
      extratags?: Record<string, string>
    }[]
    const seen = new Set<string>()
    const leads: OsmLead[] = []
    for (const r of rows) {
      // Skip place/boundary rows — “Johannesburg” is not a hairdresser.
      if (r.category === 'place' || r.category === 'boundary' || r.type === 'administrative') continue
      const name = (r.name || r.display_name?.split(',')[0] || '').trim()
      if (!name) continue
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      const ex = r.extratags || {}
      const addr = r.address || {}
      const suburb = addr.suburb || addr.neighbourhood || addr.town || addr.city_district
      leads.push({
        company: name,
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ex.email || '') ? ex.email : undefined,
        phone: (ex.phone || ex['contact:phone'] || '').trim() || undefined,
        website: (ex.website || ex['contact:website'] || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || undefined,
        industry: (kv.value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        city: suburb || addr.city || area,
        why: `Listed on OpenStreetMap${suburb ? ' in ' + suburb : ''}${addr.state ? ', ' + addr.state : ''} — a real, mappable business matching what you sell.`,
        score: 4,
        externalId: r.osm_id ? `osm_n_${r.osm_id}` : undefined,
      })
      if (leads.length >= limit) break
    }
    return { leads }
  } catch {
    return { leads: [] }
  }
}

/**
 * Photon (komoot) POI search — the friendliest keyless endpoint for datacenter IPs
 * (Overpass mirrors refuse them more often than not; Photon rarely does). Same OSM
 * data via its own index. Contacts are rarely mapped here — reveal's grounded lookup
 * handles the contact hunt; these leads are real names with real locations.
 */
async function searchPhotonLeads(
  area: string,
  definition: string,
  limit: number,
  place: { lat?: number; lon?: number }
): Promise<{ leads: OsmLead[]; note?: string }> {
  const { kv, term } = buildNominatimQuery(definition)
  if (!kv || place.lat === undefined || place.lon === undefined) return { leads: [] }
  try {
    const dLat = 0.08
    const dLon = 0.1 // ~9 km × 10 km box around the mapped point
    const bbox = `${(place.lon - dLon).toFixed(4)},${(place.lat - dLat).toFixed(4)},${(place.lon + dLon).toFixed(4)},${(place.lat + dLat).toFixed(4)}`
    const params = new URLSearchParams({
      q: term || kv.value.replace(/_/g, ' '),
      osm_tag: `${kv.key}:${kv.value}`,
      bbox,
      limit: String(Math.min(limit * 2, 30)),
      lang: 'en',
    })
    const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return { leads: [] }
    const json = (await res.json()) as {
      features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string | number> }[]
    }
    const seen = new Set<string>()
    const leads: OsmLead[] = []
    for (const f of json.features || []) {
      const p = f.properties || {}
      const name = String(p.name || '').trim()
      if (!name) continue
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      const suburb = String(p.district || p.city || p.county || '').trim()
      const industry = String(p.osm_value || kv.value)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
      leads.push({
        company: name,
        industry,
        city: suburb || area,
        why: `Listed on OpenStreetMap${suburb ? ` in ${suburb}` : ''} (Photon index) — a real, mappable business matching what you sell. Contact details come through on reveal.`,
        score: 3,
        externalId: p.osm_id ? `osm_p_${String(p.osm_type || 'n')[0]}_${p.osm_id}` : undefined,
      })
      if (leads.length >= limit) break
    }
    return { leads }
  } catch {
    return { leads: [] }
  }
}

export async function searchOsmLeads(
  area: string,
  definition: string,
  limit: number,
  opts?: { deadlineAt?: number; lat?: number; lng?: number }
): Promise<{ leads: OsmLead[]; note?: string }> {
  // Wall-clock budget: the mirror chain (3 endpoints × up to 30s) + generic sweep
  // + Nominatim fallback can stack past any caller's timeout. Every stage checks
  // the clock so the chain always returns within the caller's remaining budget.
  const deadlineAt = opts?.deadlineAt ?? Date.now() + 60_000
  const remaining = () => deadlineAt - Date.now()
  if (remaining() < 15_000) {
    return { leads: [], note: 'The map directory was out of time budget — try again in a minute.' }
  }
  // GPS pin from the client skips Nominatim entirely — a 5 km radius around the
  // real position beats geocoding a city name the user may have typed loosely.
  const place =
    opts?.lat !== undefined && opts?.lng !== undefined
      ? { lat: opts.lat, lon: opts.lng }
      : await geocodePlace(area)
  if (!place) return { leads: [], note: `Could not map "${area}" to a map area — check the spelling.` }

  const tagFilters = buildTagFilters(definition).tags
  const runOverpass = async (query: string): Promise<{ ok: boolean; data?: { elements?: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] }; status?: number }> => {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      const left = remaining()
      if (left < 5_000) break // no budget for another mirror — bail honestly
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(Math.min(30_000, left)),
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
    let result = await runOverpass(overpassQuery(place, tagFilters, limit, opts?.lat !== undefined))
    // Category too narrow for this area (common in townships) → one generic sweep of
    // ALL named businesses. Still 100% real directory data. Only while budget lasts.
    if ((!result.ok || (result.data?.elements || []).length === 0) && tagFilters.length > 0 && remaining() > 20_000) {
      result = await runOverpass(overpassQuery(place, [], limit, opts?.lat !== undefined))
    }
    if (!result.ok) {
      // Overpass mirrors refuse datacenter traffic more often than not — Nominatim's
      // category search (same OSM data, indexer-friendly) picks up the slack, then
      // Photon (most datacenter-friendly of all) before we admit defeat.
      if (remaining() > 20_000) {
        const nom = await searchNominatimLeads(area, definition, limit)
        if (nom.leads.length > 0) return nom
      }
      if (remaining() > 8_000) {
        const ph = await searchPhotonLeads(area, definition, limit, place)
        if (ph.leads.length > 0) return ph
      }
      return { leads: [], note: remaining() > 0 ? 'The map directory is busy right now — try again in a minute.' : 'The map directory was out of time budget — try again in a minute.' }
    }
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
    if (leads.length === 0) {
      // Sparse township coverage in the map directory → Nominatim's category indexer
      // (same OSM data) gets one more shot, then Photon, before we admit defeat.
      const nom = await searchNominatimLeads(area, definition, limit)
      if (nom.leads.length > 0) return nom
      if (remaining() > 8_000) {
        const ph = await searchPhotonLeads(area, definition, limit, place)
        if (ph.leads.length > 0) return ph
      }
    }
    return { leads, note: leads.length ? undefined : 'No named businesses with contact details matched that category in this area yet.' }
  } catch {
    return { leads: [], note: 'Could not reach the map directory — try again shortly.' }
  }
}
