/**
 * leadscore.ts, the Tinder math.
 *
 * One number per lead, 0 to 100, built the same way a dating app ranks a
 * deck: who they are (fit), can we reach them (verified), are they alive
 * (fresh), and what this seller taught us about their own taste (behavior).
 * The engine serves only the faces that clear the bar, and says so honestly
 * when the deck runs thin. Five strong beats thirty hopeless, every time.
 */

import { resolveTrade, taxonomyFit, sellerTradeKeys } from '@/lib/taxonomy'

/** The relevance bar. A face below it never reaches a seller. */
export const FIT_THRESHOLD = 55

/** The relevance floor: the fit verdict alone must clear this before the
 * plumbing (verification, freshness, contact richness) is allowed to carry a
 * face over the bar. A coin laundrette with a verified phone and a live
 * website is still a coin laundrette, not a cleaning client. */
export const RELEVANCE_FLOOR = 45

/** Where the composite parts sit when we simply do not know. */
const NEUTRAL_VERIFY = 45
const NEUTRAL_FRESH = 85

export interface ScoreableLead {
  company?: string | null
  industry?: string | null
  city?: string | null
  why?: string | null
  score?: number | null // the AI ranker's 1 to 5, when an engine ranked it
  contactName?: string | null
  email?: string | null
  phone?: string | null
  website?: string | null
  verifyScore?: number | null
  lastSeenAt?: Date | string | null
}

export interface ScoredLead extends ScoreableLead {
  categoryKey?: string | null
  fitScore?: number // the composite, 0..100
  relevanceFit?: number // the fit verdict alone (graph + ranker), before verify/fresh/richness stack in
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** LLM 1 to 5 stretched onto the same 0..100 ruler the taxonomy speaks. */
function llmFit(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || !isFinite(score)) return null
  const s = clamp(Math.round(score), 1, 5)
  return 20 + ((s - 1) / 4) * 80
}

/** Pool freshness on a 45 day glide from 100 to 20, never below. */
function freshness(lastSeenAt: Date | string | null | undefined): number {
  if (!lastSeenAt) return NEUTRAL_FRESH
  const t = typeof lastSeenAt === 'string' ? new Date(lastSeenAt).getTime() : lastSeenAt.getTime()
  if (!isFinite(t)) return NEUTRAL_FRESH
  const days = Math.max(0, (Date.now() - t) / 86_400_000)
  return clamp(100 - days * (80 / 45), 20, 100)
}

/** Reachability: a named human, a phone, an email, a site. Each opens a door. */
function richness(l: ScoreableLead): number {
  let n = 0
  if (l.contactName) n += 34
  if (l.phone) n += 28
  if (l.email) n += 24
  if (l.website) n += 14
  return clamp(n, 0, 100)
}

export interface ScoreContext {
  /** The seller's offering description, already enriched with profile context. */
  definition: string
  /** Per trade multipliers from the learning loop. */
  weights?: Map<string, number>
}

/**
 * Score one lead. The trade resolves from industry + company + why, the fit
 * blends the graph answer with the AI ranker's opinion (the graph guards
 * against a chatty model, the model catches what the graph cannot name),
 * behavior multiplies the fit part, everything else stacks linearly.
 */
export function scoreLead(l: ScoreableLead, ctx: ScoreContext): ScoredLead {
  const sellerKeys = sellerTradeKeys(ctx.definition)
  const leadText = `${l.industry || ''} ${l.company || ''} ${l.why || ''}`
  const cat = resolveTrade(leadText)
  const taxFit = taxonomyFit(sellerKeys, cat?.key ?? null)
  const model = llmFit(l.score)
  const baseFit = model != null ? 0.6 * model + 0.4 * taxFit : taxFit
  const weight = (cat && ctx.weights?.get(cat.key)) || 1
  const fit = clamp(baseFit * weight, 0, 100)
  const verify = typeof l.verifyScore === 'number' && isFinite(l.verifyScore) ? clamp(l.verifyScore, 0, 100) : NEUTRAL_VERIFY
  const fresh = freshness(l.lastSeenAt)
  const rich = richness(l)
  const composite = 0.45 * fit + 0.2 * verify + 0.15 * fresh + 0.2 * rich
  return {
    ...l,
    categoryKey: cat?.key ?? null,
    fitScore: Math.round(clamp(composite, 5, 100)),
    relevanceFit: Math.round(clamp(fit, 0, 100)),
  }
}

/** Score a batch, strongest first. */
export function scoreLeads<T extends ScoreableLead>(leads: T[], ctx: ScoreContext): (T & ScoredLead)[] {
  return leads
    .map((l) => scoreLead(l, ctx) as T & ScoredLead)
    .sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0))
}

/**
 * The honest deck: keep only faces that clear the bar, cap the count, and
 * write the scarcity line when the net came back lighter than the ask.
 */
export function curate<T extends ScoredLead>(
  scored: T[],
  cap: number,
  area: string
): { deck: T[]; scarcity?: string } {
  // Two locks on the door: the composite bar AND the relevance floor. The
  // composite can be carried over 55 by verification and freshness alone; the
  // floor says the fit verdict itself must also earn its place.
  const strong = scored
    .filter((l) => (l.fitScore || 0) >= FIT_THRESHOLD && (l.relevanceFit ?? 0) >= RELEVANCE_FLOOR)
    .slice(0, cap)
  if (strong.length >= cap || scored.length === 0) return { deck: strong }
  if (strong.length === 0) {
    return {
      deck: [],
      scarcity:
        `Nothing cleared the relevance bar for this ask in ${area} this scan. Name the trade and area a little differently, or scan again tomorrow, the pool grows every day.`,
    }
  }
  return {
    deck: strong,
    scarcity: `Only ${strong.length} strong match${strong.length === 1 ? '' : 'es'} this scan, the other${scored.length - strong.length === 1 ? '' : 's'} did not clear the relevance bar. A wider trade or another city finds more, and the pool grows every day.`,
  }
}
