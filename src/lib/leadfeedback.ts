/**
 * leadfeedback.ts, the lead quality loop.
 *
 * The finder ships leads; the seller presses one of two buttons on each:
 * "Good fit" or "Not a fit" (+ one tap reason). That single verdict does
 * FOUR jobs at once:
 *
 *   1. THE SELLER'S TASTE PROFILE (leadsignal.ts): good fit = SAVE, not a
 *      fit = DISMISS with the reason. Their future scans lean the way they
 *      leaned, and a face they rejected never serves to them again.
 *   2. THE SHARED POOL (LeadPool.feedbackGood / feedbackBad): the humans'
 *      verdicts pool on the face itself. Serving steers by these counters,
 *      so a released lead drifts toward sellers whose taste says it fits,
 *      and a face the field keeps rejecting stops wasting everyone's time.
 *      That is "reassigned to a better fit", as a system, not a promise.
 *   3. THE RELEASE: a bad-fit PLATFORM lead (pool, team, web, map) is handed
 *      back to the pool the moment the verdict lands. The seller's pipeline
 *      stays clean, the face stays available for someone it actually suits.
 *      A seller's OWN rows (MANUAL / CSV) never leave their pipeline: their
 *      data stays theirs, the verdict is still recorded for the lens.
 *   4. THE OWNER'S LENS: the Executive Dashboard reads the verdicts raw, so
 *      "are the leads any good" is a number per source, not a feeling.
 *
 * Every side effect is best effort. The verdict itself must NEVER fail
 * because a signal row or a pool bump hiccupped.
 */

import { db } from '@/lib/db'
import { normKey } from '@/lib/leadpool'
import { resolveTrade } from '@/lib/taxonomy'
import { SIGNAL_SAVE, SIGNAL_DISMISS } from '@/lib/leadsignal'

export const FEEDBACK_GOOD = 'GOOD_FIT'
export const FEEDBACK_BAD = 'BAD_FIT'
export const FEEDBACK_CLEAR = 'CLEAR'

/** The one tap reasons a seller can file with a verdict. GOOD rides a good fit. */
export const FEEDBACK_REASONS = [
  'GOOD',
  'WRONG_INDUSTRY',
  'TOO_FAR',
  'TOO_BIG',
  'TOO_SMALL',
  'ALREADY_CLIENT',
  'BAD_CONTACT',
  'NOT_NOW',
] as const
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]

const VERDICTS = new Set([FEEDBACK_GOOD, FEEDBACK_BAD, FEEDBACK_CLEAR])
const REASONS = new Set<string>(FEEDBACK_REASONS)

/** Sources the PLATFORM produced (fair game to hand back to the pool). A seller's own imports stay theirs. */
const PLATFORM_SOURCES = new Set(['POOL', 'TEAM', 'EXPLEE', 'WEB', 'OSM', 'ZAI', 'GEMINI'])

export interface ApplyFeedbackResult {
  ok: boolean
  released: boolean
  poolMatched: boolean
  message: string
}

/**
 * Record the verdict and fire every loop it feeds. The lead must already be
 * authorized by the route; this function only writes.
 */
export async function applyLeadFeedback(opts: {
  leadId: string
  feedback: string
  reason?: string | null
  note?: string | null
}): Promise<ApplyFeedbackResult> {
  const feedback = String(opts.feedback || '').toUpperCase()
  if (!VERDICTS.has(feedback)) {
    return { ok: false, released: false, poolMatched: false, message: 'Unknown verdict.' }
  }
  const lead = await db.lead.findUnique({ where: { id: opts.leadId } })
  if (!lead) return { ok: false, released: false, poolMatched: false, message: 'Lead not found.' }

  // ---------- normalize the input ----------
  const isClear = feedback === FEEDBACK_CLEAR
  const isGood = feedback === FEEDBACK_GOOD
  let reason: string | null = null
  if (!isClear && opts.reason) {
    const r = String(opts.reason).toUpperCase()
    if (REASONS.has(r)) {
      // a good fit may only file GOOD; a bad fit never files GOOD
      if (isGood && r === 'GOOD') reason = r
      else if (!isGood && r !== 'GOOD') reason = r
    }
  }
  const note = isClear ? null : String(opts.note || '').trim().slice(0, 300) || null
  const now = new Date()

  // ---------- 1) the verdict itself, always first ----------
  const updated = await db.lead.update({
    where: { id: lead.id },
    data: isClear
      ? { qualityFeedback: null, feedbackReason: null, feedbackNote: null, feedbackAt: null, releasedAt: null }
      : {
          qualityFeedback: isGood ? FEEDBACK_GOOD : FEEDBACK_BAD,
          feedbackReason: reason,
          feedbackNote: note,
          feedbackAt: now,
          // Release only platform-sourced rows on a bad verdict; a seller's own
          // imports never leave their pipeline. Re-rating good clears a release.
          releasedAt: !isGood && PLATFORM_SOURCES.has(String(lead.source || '').toUpperCase()) ? now : null,
        },
  })

  // ---------- 2) the taste profile (best effort) ----------
  try {
    if (isClear) {
      // an undone verdict must not keep teaching: nothing to retract cleanly
      // (the profile saturates and decays), so we simply stop adding.
    } else if (isGood) {
      await recordSignal(lead.userId, {
        signal: SIGNAL_SAVE,
        company: lead.company,
        industry: lead.industry,
        city: lead.city,
        source: 'PIPELINE',
      })
    } else {
      await recordSignal(lead.userId, {
        signal: SIGNAL_DISMISS,
        reason: reason || 'NOT_NOW',
        company: lead.company,
        industry: lead.industry,
        city: lead.city,
        source: 'PIPELINE',
      })
    }
  } catch {
    /* the profile must never break the verdict */
  }

  // ---------- 3) the pool's verdict counters + the release hand-back ----------
  let poolMatched = false
  try {
    poolMatched = await bumpPoolVerdict(lead.company, lead.city, isClear ? null : isGood, lead)
  } catch {
    /* the pool must never break the verdict */
  }

  const released = Boolean(updated.releasedAt)
  const message = isClear
    ? 'Verdict cleared.'
    : isGood
      ? 'Logged as a good fit. The finder will bring more like this one.'
      : released
        ? poolMatched
          ? 'Reported. This one went back to the pool to find a better-fit seller, and your future scans skip it.'
          : 'Reported. Your future scans skip it, and the quality lens on our side just got sharper.'
        : 'Reported. It stays in your pipeline (your own capture, your data) — the finder still learned from it.'

  return { ok: true, released, poolMatched, message }
}

/** The signal writer, shaped for this loop. Never throws. */
async function recordSignal(
  userId: string,
  input: { signal: string; reason?: string; company: string; industry?: string | null; city?: string | null; source?: string | null }
): Promise<void> {
  const trade = resolveTrade(`${input.industry || ''} ${input.company}`)
  await db.leadSignal.create({
    data: {
      userId,
      signal: input.signal,
      reason: input.reason || null,
      companyKey: normKey(input.company),
      categoryKey: trade?.key ?? null,
      city: input.city?.slice(0, 80) || null,
      industry: input.industry?.slice(0, 120) || null,
      source: input.source || 'PIPELINE',
    },
  })
}

/**
 * Pool the verdict onto the shared face: find the pool row this lead came
 * from (company key, city as the tiebreak, freshest wins) and bump its
 * counters. A released platform lead whose pool row was lost (engine lane
 * that never pooled) lands back as a fresh row, so "back to the pool" is
 * always literally true. Returns whether the face was found on file.
 */
async function bumpPoolVerdict(
  company: string,
  city: string | null,
  verdict: boolean | null, // null = clear (no counter move)
  lead: { company: string; city: string | null; industry: string | null; email: string | null; phone: string | null; website: string | null; contactName: string | null; source: string; releasedAt: Date | null }
): Promise<boolean> {
  const key = normKey(company)
  if (!key) return false
  // Precise first: the pool's identity is fingerprint = normKey(company)|normKey(city),
  // and the unique index makes the company-half prefix scan exact and cheap.
  const sameCompany = await db.leadPool
    .findMany({ where: { fingerprint: { startsWith: `${key}|` } }, orderBy: { lastSeenAt: 'desc' }, take: 5 })
    .catch(() => [])
  const row = sameCompany.find((r) => city && normKey(r.city || '') === normKey(city)) || sameCompany[0]
  if (!row) {
    // The face is not on file and this is a fresh release: land it so the
    // hand-back is real. Own imports (MANUAL/CSV) never reach here, the
    // caller only releases platform rows.
    if (verdict === false && lead.releasedAt) {
      const fp = `${key}|${normKey(city || '')}`
      const exists = await db.leadPool.findUnique({ where: { fingerprint: fp } }).catch(() => null)
      if (!exists) {
        await db.leadPool.create({
          data: {
            fingerprint: fp,
            company: company.slice(0, 160),
            industry: lead.industry?.slice(0, 120) || null,
            city: city?.slice(0, 120) || null,
            phone: lead.phone || null,
            phoneRaw: lead.phone || null,
            email: lead.email || null,
            website: lead.website || null,
            contactName: lead.contactName || null,
            source: 'ZAI', // the web lane: honest, no badge overpromises
            poolTag: 'member-release',
            confirmCount: 1,
            verifyScore: 40, // real source only: the member met this business in the field
            verifyState: 'listed',
            feedbackBad: 1,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          },
        }).catch(() => false)
        return false
      }
    }
    return false
  }
  if (verdict === true) {
    await db.leadPool.update({ where: { id: row.id }, data: { feedbackGood: { increment: 1 } } })
  } else if (verdict === false) {
    await db.leadPool.update({ where: { id: row.id }, data: { feedbackBad: { increment: 1 } } })
  }
  return true
}

// ---------- the owner's lens ----------

export interface QualitySummary {
  rated: number
  good: number
  bad: number
  goodPct: number
  rated30: number
  good30: number
  bad30: number
  released: number
  poolFacesJudged: number
  reasons: { reason: string; count: number }[]
  bySource: { source: string; rated: number; good: number; bad: number }[]
  recent: {
    id: string
    company: string
    city: string | null
    source: string
    verdict: string
    reason: string | null
    note: string | null
    member: string
    memberBusiness: string | null
    at: string
  }[]
}

/**
 * The Executive Dashboard's quality lens: is the finder shipping fits?
 * Verdicts read raw (humans only would need the probe filter, but probes
 * never file verdicts — they never reach a pipeline they feel about), per
 * source so the owner sees WHICH door ships quality, plus the freshest
 * verdicts with the seller's own words.
 */
export async function qualitySummary(): Promise<QualitySummary> {
  const d30 = new Date(Date.now() - 30 * 86_400_000)
  const [all, recent30, releasedCount, poolJudged, reasonRows, sourceRows, recentRows] = await Promise.all([
    db.lead.groupBy({ by: ['qualityFeedback'], where: { qualityFeedback: { not: null } }, _count: { _all: true } }),
    db.lead.groupBy({ by: ['qualityFeedback'], where: { qualityFeedback: { not: null }, feedbackAt: { gte: d30 } }, _count: { _all: true } }),
    db.lead.count({ where: { releasedAt: { not: null } } }),
    db.leadPool.count({ where: { OR: [{ feedbackGood: { gt: 0 } }, { feedbackBad: { gt: 0 } }] } }),
    db.lead.groupBy({ by: ['feedbackReason'], where: { qualityFeedback: 'BAD_FIT', feedbackReason: { not: null } }, _count: { _all: true } }),
    db.lead.groupBy({ by: ['source', 'qualityFeedback'], where: { qualityFeedback: { not: null } }, _count: { _all: true } }),
    db.lead.findMany({
      where: { qualityFeedback: { not: null } },
      orderBy: { feedbackAt: 'desc' },
      take: 15,
      select: {
        id: true, company: true, city: true, source: true,
        qualityFeedback: true, feedbackReason: true, feedbackNote: true, feedbackAt: true, updatedAt: true,
        user: { select: { name: true, businessName: true } },
      },
    }),
  ])

  const pick = (rows: { qualityFeedback: string | null; _count: { _all: number } }[], v: string) =>
    rows.find((r) => r.qualityFeedback === v)?._count._all || 0

  const good = pick(all, 'GOOD_FIT')
  const bad = pick(all, 'BAD_FIT')
  const rated = good + bad
  const good30 = pick(recent30, 'GOOD_FIT')
  const bad30 = pick(recent30, 'BAD_FIT')

  const srcMap = new Map<string, { rated: number; good: number; bad: number }>()
  for (const r of sourceRows) {
    const s = r.source || 'MANUAL'
    const e = srcMap.get(s) || { rated: 0, good: 0, bad: 0 }
    e.rated += r._count._all
    if (r.qualityFeedback === 'GOOD_FIT') e.good += r._count._all
    if (r.qualityFeedback === 'BAD_FIT') e.bad += r._count._all
    srcMap.set(s, e)
  }

  return {
    rated,
    good,
    bad,
    goodPct: rated > 0 ? Math.round((good / rated) * 100) : 0,
    rated30: good30 + bad30,
    good30,
    bad30,
    released: releasedCount,
    poolFacesJudged: poolJudged,
    reasons: reasonRows
      .map((r) => ({ reason: r.feedbackReason as string, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    bySource: [...srcMap.entries()]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.rated - a.rated),
    recent: recentRows.map((r) => ({
      id: r.id,
      company: r.company,
      city: r.city,
      source: r.source,
      verdict: r.qualityFeedback as string,
      reason: r.feedbackReason,
      note: r.feedbackNote,
      member: r.user.name,
      memberBusiness: r.user.businessName,
      at: (r.feedbackAt || r.updatedAt).toISOString(),
    })),
  }
}
