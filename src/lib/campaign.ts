import { db } from '@/lib/db'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import {
  normKey,
  normalizeSaPhone,
  topicFingerprint,
  serveFromPool,
  rememberScanResults,
  logScanRun,
} from '@/lib/leadpool'
import { expleeSearchCompanies } from '@/lib/explee'

/**
 * Client lead campaigns, run on behalf of a seller by the business owner.
 *
 * The money story: a client loads credit, the owner is told by email, and a
 * campaign fires through the Explee API the moment it lands. Every face the
 * campaign finds goes to the client's OWN bench on the Exec Dashboard (the
 * exec lead pool) and waits there. Nothing touches the client's pipeline
 * until the owner reviews and adds it. That keeps the owner the gatekeeper
 * and keeps the client's pipeline clean of anything they did not ask for.
 *
 * Explee first, the platform's verified pool second: if the Explee key is
 * missing, drained or unreachable, the campaign serves fresh verified faces
 * from the shared LeadPool instead, free, and says so honestly.
 */

export interface CampaignBrief {
  sellerName: string
  businessName: string | null
  email: string
  industry: string | null
  city: string | null
  offerings: string | null
  targetMarket: string | null
  valueProp: string | null
  definition: string
}

/** Read the seller's profile + default workspace and phrase the campaign search. */
export async function clientCampaignBrief(userId: string): Promise<CampaignBrief | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, businessName: true, email: true, industry: true, city: true },
  })
  if (!user) return null
  const project = await db.project.findFirst({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { industry: true, targetMarket: true, offerings: true, valueProp: true },
  })
  const industry = user.industry || project?.industry || null
  const city = user.city || null
  const offerings = project?.offerings || null
  const targetMarket = project?.targetMarket || null
  const valueProp = project?.valueProp || null

  const who = targetMarket || 'new customers'
  const what = offerings || industry || 'what they sell'
  const where = city ? ` in ${city}` : ' in South Africa'
  const definition = `${who}${where} that would pay for ${what}${valueProp ? `. What makes it worth it: ${valueProp}` : ''}`

  return {
    sellerName: user.name,
    businessName: user.businessName,
    email: user.email,
    industry,
    city,
    offerings,
    targetMarket,
    valueProp,
    definition,
  }
}

export interface CampaignResult {
  mode: 'EXPLEE' | 'POOL' | 'SKIPPED'
  added: number
  refreshed: number
  skipped: number
  served: number
  topicFp: string
  balance?: number
  note?: string
}

interface PoolInput {
  company: string
  contactName?: string
  role?: string
  profileUrl?: string
  email?: string
  phone?: string
  website?: string
  industry?: string
  city?: string
  country?: string
  why?: string
  score?: number
  source: 'EXPLEE' | 'POOL' | 'MANUAL'
  sourceRef?: string
}

/**
 * Land campaign results on the client's bench.
 * Dedup rules, in order:
 *  1. already in their pipeline (same company) → skipped, never double loaded
 *  2. already on their bench with status ADDED or DISMISSED → skipped
 *  3. already on their bench with status NEW → refresh empty facts only
 *  4. new face → created with status NEW
 */
async function landOnBench(
  userId: string,
  area: string,
  inputs: PoolInput[]
): Promise<{ added: number; refreshed: number; skipped: number }> {
  if (inputs.length === 0) return { added: 0, refreshed: 0, skipped: 0 }
  const [savedCompanies, existingRows] = await Promise.all([
    db.lead.findMany({ where: { userId }, select: { company: true }, take: 5000 }),
    db.clientPoolLead.findMany({
      where: { userId },
      select: { id: true, fingerprint: true, status: true, contactName: true, email: true, phone: true, website: true, industry: true, city: true },
    }),
  ])
  const saved = new Set(savedCompanies.map((l) => normKey(l.company)))
  const benchByFp = new Map(existingRows.map((r) => [r.fingerprint, r]))

  let added = 0
  let refreshed = 0
  let skipped = 0

  for (const l of inputs) {
    const company = l.company.trim()
    if (!company) { skipped++; continue }
    if (saved.has(normKey(company))) { skipped++; continue }
    const city = l.city || area || null
    const fp = `${normKey(company)}|${normKey(city || '')}`
    const prev = benchByFp.get(fp)
    if (prev) {
      if (prev.status === 'NEW') {
        await db.clientPoolLead.update({
          where: { id: prev.id },
          data: {
            contactName: prev.contactName || l.contactName || null,
            email: prev.email || l.email || null,
            phone: prev.phone || l.phone || null,
            website: prev.website || l.website || null,
            industry: prev.industry || l.industry || null,
            role: l.role || null,
            profileUrl: l.profileUrl || null,
            why: l.why || null,
            score: l.score ?? undefined,
          },
        })
        refreshed++
      } else {
        skipped++
      }
      continue
    }
    try {
      await db.clientPoolLead.create({
        data: {
          userId,
          fingerprint: fp,
          company,
          contactName: l.contactName || null,
          role: l.role || null,
          profileUrl: l.profileUrl || null,
          email: l.email || null,
          phone: l.phone || null,
          website: l.website || null,
          industry: l.industry || null,
          city,
          country: l.country || 'South Africa',
          source: l.source,
          sourceRef: l.sourceRef || null,
          why: l.why || null,
          score: l.score ?? null,
        },
      })
      benchByFp.set(fp, { id: 'tmp', fingerprint: fp, status: 'NEW', contactName: null, email: null, phone: null, website: null, industry: null, city: null })
      added++
    } catch {
      skipped++ // lost a unique race — the face is already on the bench
    }
  }
  return { added, refreshed, skipped }
}

/**
 * Run a campaign for one client. Explee live search when the key allows it,
 * verified pool serve when it does not. Results land on the bench, never
 * straight in the pipeline. Every run is logged as a ScanRun so the exec
 * drawer can show the campaign history.
 */
export async function runClientCampaign(
  userId: string,
  opts: { definition?: string; city?: string; limit?: number; auto?: boolean } = {}
): Promise<CampaignResult | null> {
  const brief = await clientCampaignBrief(userId)
  if (!brief) return null

  const definition = (opts.definition || '').trim() || brief.definition
  const city = (opts.city || '').trim() || brief.city || ''
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50)
  const topicFp = topicFingerprint(definition, city)

  // Guard for automatic runs: a campaign that fired minutes ago already owns
  // this topic. Manual runs from the Exec Dashboard always go through.
  if (opts.auto) {
    const recent = await db.scanRun.findFirst({
      where: { userId, mode: { in: ['EXPLEE', 'POOL'] }, createdAt: { gte: new Date(Date.now() - 3 * 60_000) } },
      select: { id: true },
    })
    if (recent) {
      return { mode: 'SKIPPED', added: 0, refreshed: 0, skipped: 0, served: 0, topicFp, note: 'A campaign just ran for this client. Their bench is already stocked.' }
    }
  }

  const apiKey = (await getConfig(CONFIG_KEYS.EXPLEE_API_KEY)).trim()
  let mode: 'EXPLEE' | 'POOL' = apiKey.length > 5 ? 'EXPLEE' : 'POOL'
  let balance: number | undefined
  let note: string | undefined
  let inputs: PoolInput[] = []

  if (mode === 'EXPLEE') {
    const r = await expleeSearchCompanies({ definition, city: city || undefined, limit, apiKey })
    balance = r.meta?.remainingBalance
    if (r.mode === 'LIVE' && r.leads.length > 0) {
      inputs = r.leads.map((l) => ({
        company: l.company,
        contactName: l.contactName,
        email: l.email,
        phone: normalizeSaPhone(l.phone).e164 || l.phone,
        website: l.website,
        industry: l.industry,
        city: l.city || city || undefined,
        country: l.country,
        source: 'EXPLEE' as const,
        sourceRef: l.sourceRef,
      }))
    } else {
      // Honest downgrade: no live faces → free verified pool, and say why.
      mode = 'POOL'
      note = r.note || 'Explee had nothing to give this round, so we served verified faces from your own pool.'
    }
  }

  if (mode === 'POOL') {
    const saved = new Set(
      (await db.lead.findMany({ where: { userId }, select: { company: true }, take: 5000 })).map((l) => normKey(l.company))
    )
    const served = await serveFromPool({ topicFp, cap: limit, excludeKeys: saved, city: city || undefined })
    inputs = served.map((p) => ({
      company: p.company,
      contactName: p.contactName,
      role: p.role,
      profileUrl: p.profileUrl,
      email: p.email,
      phone: p.phone,
      website: p.website,
      industry: p.industry,
      city: p.city || city || undefined,
      score: p.score,
      source: 'POOL' as const,
      sourceRef: p.sourceRef,
    }))
  }

  // The verified pool grows from every Explee answer too (free reuse later).
  if (inputs.length > 0) {
    try {
      await rememberScanResults({
        topicFp,
        area: city || 'South Africa',
        source: mode === 'EXPLEE' ? 'EXPLEE' : 'OSM',
        leads: inputs.slice(0, 30).map((l) => ({
          company: l.company,
          contactName: l.contactName,
          role: l.role,
          profileUrl: l.profileUrl,
          email: l.email,
          phone: l.phone,
          website: l.website,
          industry: l.industry,
          city: l.city,
          why: l.why,
          score: l.score,
          externalId: l.source === 'EXPLEE' ? l.sourceRef : undefined,
        })),
      })
    } catch {
      /* capture is best effort, the bench is already fed */
    }
  }

  const landed = await landOnBench(userId, city, inputs)
  // Campaign runs are the platform working on the client's behalf (they paid
  // for this) so they log under their own CAMPAIGN mode: the scan allowance
  // gate ignores them and the client's own daily quota stays untouched.
  await logScanRun(userId, topicFp, 'CAMPAIGN', landed.added, mode === 'POOL').catch(() => {})

  return {
    mode,
    added: landed.added,
    refreshed: landed.refreshed,
    skipped: landed.skipped,
    served: inputs.length,
    topicFp,
    ...(balance !== undefined ? { balance } : {}),
    ...(note ? { note } : {}),
  }
}
