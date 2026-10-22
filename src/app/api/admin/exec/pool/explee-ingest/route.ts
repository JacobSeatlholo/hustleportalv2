import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { ingestVerifiedContacts, cityFromText, type RememberLead } from '@/lib/leadpool'
import { expleeHotLeads, projectLabelForCampaign, TRAVEL_PROJECT, HOUSE_PROJECT } from '@/lib/explee'

export const maxDuration = 60

/**
 * The owner's pool feeder: land the contacts the Business Hustle outreach team
 * has ALREADY reached on Explee into the shared Verified Lead Pool, so every
 * new member scans into a floor of credible, verifiable businesses even on a
 * brand new topic.
 *
 * Where these contacts come from:
 *  A. The team's own Explee campaigns (default). A hot lead is a real person
 *     at a real company who REPLIED to our outreach: the strongest quality
 *     signal the team owns. Pulled through the existing hot leads walk, free,
 *     no Explee credits spent.
 *  B. A pasted contact list (body.contacts) for bulk imports the owner curates
 *     by hand (an Explee export, a vetted spreadsheet).
 *
 * Every row lands through the same merge law as scan results: companies
 * dedupe, good facts on file are never erased with blanks, phones normalize
 * to +27, a bounded batch of websites gets pinged live. dryRun:true
 * classifies everything and writes nothing.
 *
 * GUARD: the standard exec gate (the owner's session) OR the cron bearer
 * secret for a scripted feed. Both are server side only; a regular member
 * session hits a 403 wall like every other exec surface.
 */
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
}

function clean(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length ? s : undefined
}

function saneEmail(v?: unknown): string | undefined {
  const s = clean(v)
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined
  if (/example\.(com|org|net)|your(email)?\.|domain\.com/i.test(s)) return undefined
  return s
}

function saneUrl(v?: unknown): string | undefined {
  const s = clean(v)
  if (!s) return undefined
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`
  if (!/^https?:\/\/[^\s]+\.[^\s]{2,}$/i.test(url) || url.length > 300) return undefined
  return url
}

/** The hot leads walk gives people; the pool thinks in companies. Honest mapping: */
function hotLeadToContact(h: {
  campaignName?: string
  name?: string
  email?: string
  jobTitle?: string
  companyName?: string
  companyDomain?: string
  linkedinUrl?: string
  phone?: string
  whyHot?: string
}): RememberLead | null {
  const company = clean(h.companyName)
  if (!company) return null // a person without a company is not a pool row: never fabricated
  const reply = clean(h.whyHot)?.slice(0, 160)
  const campaignLine = h.campaignName ? `our ${h.campaignName} campaign` : 'our outreach'
  const tag = projectLabelForCampaign(h.campaignName)
  // A reply to a city campaign puts the contact in that city's orbit, the
  // honest fill for a pool row with no city on file.
  const cityGuess = cityFromText(h.campaignName)
  return {
    company,
    ...(clean(h.name) ? { contactName: clean(h.name) } : {}),
    ...(clean(h.jobTitle) ? { role: clean(h.jobTitle)!.slice(0, 60) } : {}),
    ...(saneEmail(h.email) ? { email: saneEmail(h.email) } : {}),
    ...(clean(h.phone) ? { phone: clean(h.phone) } : {}),
    ...(h.companyDomain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h.companyDomain) ? { website: `https://${h.companyDomain}` } : {}),
    ...(saneUrl(h.linkedinUrl) ? { profileUrl: saneUrl(h.linkedinUrl) } : {}),
    why: reply ? `Warm reply to ${campaignLine}: ${reply}` : `Warm reply to ${campaignLine}`,
    ...(tag ? { poolTag: tag } : {}),
    ...(cityGuess ? { city: cityGuess } : {}),
  }
}

function pastedToContact(raw: Record<string, unknown>): RememberLead | null {
  const company = clean(raw.company)
  if (!company) return null
  return {
    company,
    ...(clean(raw.contactName) ? { contactName: clean(raw.contactName) } : {}),
    ...(clean(raw.role) ? { role: clean(raw.role)!.slice(0, 60) } : {}),
    ...(saneEmail(raw.email) ? { email: saneEmail(raw.email) } : {}),
    ...(clean(raw.phone) ? { phone: clean(raw.phone) } : {}),
    ...(saneUrl(raw.website) ? { website: saneUrl(raw.website) } : {}),
    ...(clean(raw.industry) ? { industry: clean(raw.industry)!.slice(0, 120) } : {}),
    ...(clean(raw.city) ? { city: clean(raw.city)!.slice(0, 120) } : {}),
    ...(saneUrl(raw.profileUrl) ? { profileUrl: saneUrl(raw.profileUrl) } : {}),
    ...(clean(raw.poolTag) ? { poolTag: clean(raw.poolTag)!.slice(0, 120) } : {}),
    // The curated lists deserve their fit line too: why this business suits the
    // outreach project, exactly like the scan results carry one.
    ...(clean(raw.why) ? { why: clean(raw.why)!.slice(0, 300) } : {}),
    ...(Number.isFinite(Number(raw.score)) ? { score: Math.max(1, Math.min(5, Math.round(Number(raw.score)))) } : {}),
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok && !cronAuthorized(req)) return gate.res

  const [bySource, byTag, activeTotal] = await Promise.all([
    db.leadPool.groupBy({ by: ['source'], _count: { _all: true } }),
    db.leadPool.groupBy({ by: ['poolTag'], where: { source: 'EXPLEE' }, _count: { _all: true } }),
    db.leadPool.count({ where: { active: true, verifyState: { not: 'stale' } } }),
  ])
  const sources: Record<string, number> = {}
  for (const g of bySource) sources[g.source] = g._count._all
  const tags: Record<string, number> = {}
  for (const g of byTag) tags[g.poolTag || 'untagged'] = g._count._all
  return NextResponse.json({
    ok: true,
    pool: { bySource: sources, byTag: tags, activeTotal },
    projects: [TRAVEL_PROJECT, HOUSE_PROJECT],
    note: 'POST here with dryRun true to preview, then dryRun false (or omit it) to land the team verified contacts in the pool. Default pull is the Explee outreach hot leads; pass contacts for a pasted list.',
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok && !cronAuthorized(req)) return gate.res

  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dryRun === true
  const max = Math.min(Math.max(Number(body?.max) || 200, 1), 200)
  const campaignId = Number.isFinite(Number(body?.campaignId)) && Number(body.campaignId) > 0 ? Number(body.campaignId) : undefined
  const maxPings = Math.min(Math.max(Number(body?.maxPings ?? 24) || 24, 0), 60)

  let contacts: RememberLead[] = []
  let pulled = 0
  let source: 'HOT_LEADS' | 'PASTE' = 'HOT_LEADS'
  let note: string | undefined

  if (Array.isArray(body?.contacts) && body.contacts.length > 0) {
    source = 'PASTE'
    const rows = (body.contacts as Record<string, unknown>[]).slice(0, 500)
    contacts = rows.map(pastedToContact).filter((x): x is RememberLead => Boolean(x))
    pulled = contacts.length
  } else {
    const hot = await expleeHotLeads({ limit: max, campaignId })
    if (hot.mode !== 'LIVE') {
      return NextResponse.json(
        { ok: false, error: hot.note || 'Explee is not answering right now. Nothing was written to the pool.' },
        { status: 502 }
      )
    }
    pulled = hot.leads.length
    let noCompany = 0
    for (const h of hot.leads) {
      const c = hotLeadToContact(h)
      if (c) contacts.push(c)
      else noCompany++
    }
    if (noCompany > 0) note = `${noCompany} hot lead${noCompany === 1 ? '' : 's'} had no company name and were left out: the pool only takes real businesses.`
  }

  const summary = await ingestVerifiedContacts({ area: 'South Africa', contacts, maxPings, dryRun })
  return NextResponse.json({
    ok: true,
    dryRun,
    source,
    pulled,
    ...summary,
    ...(note ? { note } : {}),
    message: dryRun
      ? `Preview only, nothing written: ${summary.created} new face${summary.created === 1 ? '' : 's'} would land, ${summary.merged} would merge into records already in the pool. Run again with dryRun false to commit.`
      : `Landed: ${summary.created} new verified face${summary.created === 1 ? '' : 's'} in the shared pool, ${summary.merged} merged into records already there. Members scanning now can meet them.`,
  })
}
