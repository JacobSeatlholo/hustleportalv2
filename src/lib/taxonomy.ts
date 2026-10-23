/**
 * taxonomy.ts, the trade dictionary the matching engine thinks in.
 *
 * WHY: keyword overlap alone says a business listed as "drainage and pipe
 * repair" has nothing to do with a plumber's scan. This map gives every
 * South African trade one canonical key plus the words businesses actually
 * call themselves, and a buys graph of what each trade typically purchases.
 * The lead engine resolves every seller and every lead to these keys and
 * scores fit on the graph, not on shared letters.
 */

export interface TradeCategory {
  key: string
  label: string
  /** How businesses describe themselves, matched on normalized text. */
  aliases: string[]
  /** Category keys this trade typically BUYS from (their suppliers & services). */
  buys: string[]
  /** Broad family, for the shared group tiebreak. */
  group: string
}

const C = (key: string, label: string, group: string, aliases: string[], buys: string[]): TradeCategory => ({
  key, label, group, aliases, buys,
})

export const TRADES: TradeCategory[] = [
  // ---------- trades & home services ----------
  C('plumbing', 'Plumbing', 'trades', ['plumb', 'plumber', 'drainage', 'drains', 'pipe repair', 'geyser', 'leak detection', 'blocked drain'], ['accounting', 'marketing', 'security', 'cleaning', 'insurance']),
  C('electrical', 'Electrical', 'trades', ['electric', 'electrician', 'wiring', 'coco', 'certificate of compliance', 'solar install'], ['accounting', 'marketing', 'insurance', 'security']),
  C('building', 'Building & Construction', 'trades', ['construction', 'building contractor', 'builder', 'renovat', 'civil', 'brick', 'cement', 'plaster', 'drywall', 'ceiling'], ['accounting', 'marketing', 'security', 'hiring', 'insurance', 'transport']),
  C('roofing', 'Roofing & Waterproofing', 'trades', ['roof', 'waterproof', 'gutter', 'damp proof'], ['accounting', 'marketing', 'building']),
  C('painting', 'Painting & Decorating', 'trades', ['paint', 'decorat'], ['accounting', 'marketing']),
  C('gardening', 'Landscaping & Gardens', 'trades', ['landscap', 'garden', 'lawn', 'tree felling', 'irrigation', 'pool care', 'garden service'], ['accounting', 'marketing']),
  C('cleaning', 'Cleaning & Hygiene', 'cleaning', ['clean', 'hygiene', 'sanit', 'car wash', 'valet', 'domestic'], ['accounting', 'marketing']),
  C('pest', 'Pest Control', 'trades', ['pest', 'fumigat', 'termite', 'cockroach'], ['accounting', 'marketing']),
  C('paving', 'Paving & Surfacing', 'trades', ['pav', 'tar', 'asphalt', 'bricklay'], ['building', 'accounting']),
  C('pool', 'Pool Services', 'trades', ['pool'], ['accounting', 'marketing']),
  C('fencing', 'Fencing & Gates', 'trades', ['fenc', 'gate motor', 'automation gate', 'carport', 'awning'], ['building', 'accounting', 'security']),
  C('locksmith', 'Locksmiths', 'trades', ['locksmith', 'key cut', 'safe'], ['security', 'accounting']),
  C('welding', 'Welding & Steelwork', 'trades', ['weld', 'steel work', 'steelwork', 'metal work', 'balustrade', 'stainless'], ['building', 'manufacturing']),
  C('carpentry', 'Carpentry & Joinery', 'trades', ['carpent', 'joinery', 'cupboard', 'kitchen units', 'furniture maker', 'woodwork'], ['building', 'manufacturing']),
  C('hvac', 'Heating & Cooling', 'trades', ['air condition', 'aircon', 'hvac', 'refrigerat', 'fridge repair', 'cooling'], ['accounting', 'marketing']),

  // ---------- automotive ----------
  C('mechanic', 'Motor Mechanics', 'auto', ['mechanic', 'motor repair', 'auto repair', 'engine', 'brake', 'suspension', 'diesel inject'], ['accounting', 'marketing', 'insurance']),
  C('panelbeater', 'Panel Beating & Spray', 'auto', ['panel beat', 'panelbeat', 'spray paint', 'smash repair', 'chassis'], ['insurance', 'accounting', 'marketing']),
  C('tyres', 'Tyres & Fitment', 'auto', ['tyre', 'tire', 'wheel align', 'fitment centre'], ['accounting', 'marketing']),
  C('carwash', 'Car Wash & Valet', 'auto', ['car wash', 'carwash', 'valet'], ['marketing', 'cleaning']),
  C('towing', 'Towing & Recovery', 'auto', ['tow', 'recovery vehicle', 'breakdown'], ['insurance', 'accounting']),
  C('spares', 'Auto Spares & Parts', 'auto', ['spares', 'auto part', 'motor part', 'scrap yard', 'scrapyard', 'wreck'], ['wholesale', 'accounting']),

  // ---------- food & hospitality ----------
  C('restaurant', 'Restaurants', 'food', ['restaurant', 'grill', 'diner', 'eatery', 'bistro', 'sushi', 'pizza'], ['accounting', 'cleaning', 'pest', 'marketing', 'delivery', 'security']),
  C('cafe', 'Cafes & Coffee', 'food', ['coffee shop', 'cafe', 'coffee roast', 'espresso', 'tea room'], ['accounting', 'cleaning', 'pest', 'marketing', 'delivery']),
  C('fastfood', 'Take Aways & Fast Food', 'food', ['take away', 'takeaway', 'fast food', 'kota', 'chicken lig', 'fish and chips', 'food truck'], ['accounting', 'cleaning', 'pest', 'marketing', 'delivery']),
  C('tavern', 'Taverns & Bars', 'food', ['tavern', 'shebeen', 'bar and grill', 'pub', 'liquor', 'night club', 'nightclub', 'shisanyama', 'braai place'], ['security', 'cleaning', 'accounting', 'marketing', 'pest']),
  C('bakery', 'Bakeries', 'food', ['bakery', 'baker', 'cake', 'confection', 'pastry'], ['accounting', 'marketing', 'wholesale', 'packaging', 'delivery']),
  C('butchery', 'Butcheries', 'food', ['butcher', 'biltong', 'meat'], ['accounting', 'marketing', 'wholesale', 'packaging', 'refrigeration']),
  C('catering', 'Catering & Events Food', 'food', ['cater'], ['accounting', 'marketing', 'events']),
  C('guesthouse', 'Guest Houses & Lodging', 'hospitality', ['guest house', 'guesthouse', 'b and b', 'bnb', 'lodge', 'backpackers', 'hotel', 'accommodation', 'self catering'], ['cleaning', 'marketing', 'accounting', 'security', 'travel']),
  C('events', 'Events & Conferencing', 'events', ['event', 'conference', 'function venue', 'wedding venue', 'party plan', 'marquee', 'entertainment'], ['catering', 'marketing', 'accounting', 'printing']),

  // ---------- retail ----------
  C('spaza', 'Spaza & Corner Shops', 'retail', ['spaza', 'tuck shop', 'tuckshop', 'corner shop', 'general dealer'], ['wholesale', 'delivery']),
  C('grocery', 'Grocers & Food Retail', 'retail', ['grocer', 'supermarket', 'fruit and veg', 'green grocer', 'food market'], ['wholesale', 'delivery', 'accounting', 'cleaning']),
  C('bottlestore', 'Bottle Stores', 'retail', ['bottle store', 'off licence', 'wine shop'], ['wholesale', 'security', 'accounting']),
  C('fashion', 'Clothing & Fashion', 'retail', ['clothing', 'boutique', 'fashion', 'shoe', 'tailor', 'dressmak', 'lingerie', 'sneaker'], ['accounting', 'marketing', 'packaging']),
  C('hardware', 'Hardware & Building Supply', 'retail', ['hardware', 'build supply', 'tool shop', 'paint shop', 'plumbing supply'], ['wholesale', 'transport', 'accounting']),
  C('furniture', 'Furniture & Home', 'retail', ['furniture', 'home decor', 'appliance', 'bedding', 'mattress'], ['transport', 'accounting', 'marketing']),
  C('pharmacy', 'Pharmacies', 'health', ['pharmac', 'chemist'], ['wholesale', 'accounting', 'security']),
  C('secondhand', 'Secondhand & Pawn', 'retail', ['second hand', 'secondhand', 'pawn', 'thrift'], ['accounting']),

  // ---------- professional services ----------
  C('accounting', 'Accounting & Tax', 'prof', ['account', 'bookkeep', 'tax', 'audit', 'payroll', 'sars'], ['marketing', 'hiring']),
  C('legal', 'Legal & Conveyancing', 'prof', ['attorney', 'law firm', 'lawyer', 'legal', 'conveyanc', 'notary', 'advocate'], ['accounting', 'marketing']),
  C('insurance', 'Insurance & Brokers', 'prof', ['insur', 'broker', 'assurance', 'funeral cover', 'financial adviser', 'financial advisor', 'wealth'], ['marketing', 'accounting', 'hiring']),
  C('marketing', 'Marketing & Advertising', 'media', ['marketing', 'advertis', 'seo', 'social media', 'branding', 'graphic design', 'web design', 'promo product', 'brand agency', 'digital agency'], ['accounting', 'hiring']),
  C('printing', 'Printing & Signage', 'media', ['print', 'signage', 'sign writer', 'embroidery', 'banner', 'label', 'stationery', 'copy shop'], ['packaging', 'accounting', 'marketing']),
  C('it', 'IT & Web Services', 'media', ['it support', 'computer', 'software', 'web develop', 'web host', 'network', 'cctv install', 'tech'], ['accounting', 'hiring']),
  C('recruitment', 'Recruitment & Staffing', 'prof', ['recruit', 'staffing', 'labour broker', 'hiring', 'placement agency', 'domestic worker'], ['marketing', 'accounting']),
  C('training', 'Training & Education', 'prof', ['training', 'academy', 'college', 'school', 'driving school', 'tutor', 'educare centre', 'skills develop'], ['marketing', 'accounting']),
  C('childcare', 'Childcare & Creches', 'prof', ['creche', 'crèche', 'day care', 'daycare', 'aftercare', 'nursery school', 'preschool', 'pre school'], ['cleaning', 'catering', 'security']),
  C('realestate', 'Real Estate & Property', 'prof', ['estate agent', 'property', 'realtor', 'letting', 'rental agent', 'sectional title'], ['marketing', 'accounting', 'legal']),

  // ---------- health & personal ----------
  C('hairsalon', 'Hair Salons & Barbers', 'personal', ['hair', 'salon', 'barber', 'locs', 'braiding', 'weaves'], ['accounting', 'marketing', 'wholesale']),
  C('beauty', 'Beauty & Wellness', 'personal', ['beauty', 'nail', 'spa', 'massage', 'laser', 'eyelash', 'brow', 'aesthetic'], ['accounting', 'marketing', 'wholesale']),
  C('medical', 'Medical & Dental', 'health', ['medical', 'doctor', 'dental', 'dentist', 'clinic', 'optom', 'physio', 'chiropract', 'practice'], ['cleaning', 'accounting', 'security', 'wholesale']),
  C('fitness', 'Fitness & Sport', 'personal', ['gym', 'fitness', 'personal train', 'crossfit', 'yoga', 'martial art', 'boxing', 'soccer academy', 'sport'], ['marketing', 'accounting', 'cleaning']),
  C('vet', 'Veterinary & Pet', 'health', ['vet', 'animal hospital', 'pet groom', 'pet care', 'dog walk', 'kennel'], ['cleaning', 'wholesale']),
  C('funeral', 'Funeral Services', 'health', ['funeral', 'undertaker', 'mortuary', 'tombstone'], ['printing', 'transport', 'accounting']),

  // ---------- logistics & industry ----------
  C('transport', 'Transport & Logistics', 'logistics', ['transport', 'logistic', 'trucking', 'freight', 'shuttle', 'taxi association', 'haulage'], ['accounting', 'mechanic', 'tyres']),
  C('courier', 'Courier & Delivery', 'logistics', ['courier', 'delivery service', 'parcel', 'messenger'], ['transport', 'accounting']),
  C('manufacturing', 'Manufacturing', 'industry', ['manufactur', 'factory', 'assembly', 'fabricat', 'machining', 'injection mould', 'food process'], ['wholesale', 'transport', 'accounting', 'hiring']),
  C('packaging', 'Packaging & Supplies', 'industry', ['packag', 'carton', 'bottle supply', 'container'], ['manufacturing', 'transport', 'accounting']),
  C('wholesale', 'Wholesale & Distribution', 'industry', ['wholesal', 'distribut', 'import', 'export', 'trading company', 'supplier'], ['transport', 'accounting', 'courier']),
  C('agri', 'Farming & Agriculture', 'industry', ['farm', 'agri', 'produce', 'nursery', 'plant', 'hydropon', 'poultry', 'egg', 'dairy', 'abattoir'], ['transport', 'packaging', 'wholesale', 'accounting']),
  C('security', 'Security & Armed Response', 'security', ['security', 'guard', 'armed response', 'alarm', 'cctv', 'access control', 'tracking company', 'patrol'], ['it', 'accounting', 'hiring']),
  C('travel', 'Travel & Tourism', 'hospitality', ['travel', 'tour', 'safari', 'holiday', 'accommodation booking', 'shuttle service', 'adventure'], ['marketing', 'transport', 'guesthouse']),
]

const BY_KEY = new Map(TRADES.map((t) => [t.key, t]))

/** normKey is shared with the pool: lowercase letters and digits only. */
function nz(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Resolve a category from a chunk of text: an alias hit wins, longest match
 * first so "coffee roastery" never collapses into the plain cafe shelf.
 */
export function resolveTrade(text: string | null | undefined): TradeCategory | null {
  const norm = ` ${nz(text || '')} `
  if (norm.trim().length < 3) return null
  let best: { cat: TradeCategory; len: number } | null = null
  for (const cat of TRADES) {
    for (const a of cat.aliases) {
      const alias = nz(a)
      // substring on purpose: aliases are stems ("plumb" must hit "plumber",
      // "drainage and pipe repair" hits "drain"), longest alias wins
      if (alias && norm.includes(alias)) {
        if (!best || alias.length > best.len) best = { cat, len: alias.length }
      }
    }
  }
  return best?.cat ?? null
}

/** Resolve every category a longer text (a seller's whole offering paragraph) names. */
export function resolveTrades(text: string | null | undefined): string[] {
  const norm = ` ${nz(text || '')} `
  if (norm.trim().length < 3) return []
  const hits: { key: string; len: number }[] = []
  for (const cat of TRADES) {
    for (const a of cat.aliases) {
      const alias = nz(a)
      if (alias && norm.includes(alias)) hits.push({ key: cat.key, len: alias.length })
    }
  }
  // keep one key per category, prefer nothing else; keys stay unique by construction
  const seen = new Set<string>()
  hits.sort((a, b) => b.len - a.len)
  const out: string[] = []
  for (const h of hits) {
    if (!seen.has(h.key)) {
      seen.add(h.key)
      out.push(h.key)
    }
  }
  return out.slice(0, 6)
}

/**
 * How naturally a LEAD of trade `leadKey` buys from a SELLER whose offering
 * maps to `sellerKeys`. 100 = the lead is the seller's exact market, 0 = no
 * graph path at all. Directed: a plumber buys accounting services, an
 * accountant rarely buys plumbing.
 */
export function taxonomyFit(sellerKeys: string[], leadKey: string | null | undefined): number {
  if (!leadKey) return 45 // unknown trade: neutral, the rest of the score decides
  const lead = BY_KEY.get(leadKey)
  if (!lead) return 45
  if (sellerKeys.length === 0) return 45
  let best = 0
  for (const sk of sellerKeys) {
    const seller = BY_KEY.get(sk)
    if (!seller) continue
    if (sk === leadKey) best = Math.max(best, 82) // same trade: peers sometimes buy, mostly not
    else if (lead.buys.includes(sk)) best = 100 // the lead buys exactly what the seller sells
    else if (seller.buys.includes(leadKey)) best = Math.max(best, 42) // the lead supplies the seller
    else if (seller.group === lead.group) best = Math.max(best, 30) // same family, loose
    else {
      // one hop: the seller serves a trade that serves the lead ("supplier of my supplier")
      for (const up of seller.buys) {
        const upCat = BY_KEY.get(up)
        if (upCat && upCat.buys.includes(leadKey)) best = Math.max(best, 25)
      }
    }
    if (best === 100) break
  }
  return best
}

/** Trades that nearly every SME buys: the seller's own trade stops narrowing the field. */
const UNIVERSAL_CUT = 0.5
const UNIVERSAL = (() => {
  const count = new Map<string, number>()
  for (const t of TRADES) for (const b of new Set(t.buys)) count.set(b, (count.get(b) || 0) + 1)
  return new Set([...count.entries()].filter(([, n]) => n / TRADES.length >= UNIVERSAL_CUT).map(([k]) => k))
})()

/**
 * The seller side: resolve the whole description, then drop universal trades
 * (everyone buys marketing, cleaning, security, accounting) when a more
 * specific trade rode along, so a "marketing agency for plumbers" keeps the
 * plumber bias instead of matching the whole map.
 */
export function sellerTradeKeys(text: string | null | undefined): string[] {
  const all = resolveTrades(text)
  if (all.length <= 1) return all
  const specific = all.filter((k) => !UNIVERSAL.has(k))
  return specific.length ? specific : all
}
