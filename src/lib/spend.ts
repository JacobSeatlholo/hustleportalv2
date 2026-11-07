/**
 * The airtime price list — ONE tunable source of truth.
 *
 * The owner's law: the portal works like prepaid airtime. You load credits
 * once, priced features spend a few cents of them, and you reload when you
 * run dry. Functionality that works is worth paying for; the client never
 * has to think about the machinery, only about the change HustlePortal makes
 * for them ("we lead with what changes because you use HustlePortal").
 *
 * Monetization v1 (Task 169), the shape that survives the next 100 years:
 *  - ONE sticker price per action for everyone — the discount lives in what
 *    plans INCLUDE (monthly send bundles, reveal quotas), never in a second
 *    per-unit rate nobody can mentally reconcile.
 *  - Charge for nerve endings (things that reach the real world or burn real
 *    compute), not for clicks: an invoice CREATED is free, an invoice EMAILED
 *    spends the same airtime as any other email that lands in an inbox.
 *  - Bigger loads earn bonus airtime (TOPUP_BONUS_TIERS below) — the same
 *    ladder the fixed packs ride, so a custom load and a pack of the same
 *    size always earn the same bonus. Small loads are honest: no bonus.
 *
 * This file is CLIENT-SAFE on purpose: no db, no env, no server imports.
 * Both the API routes and the UI (wallet price panel, composer chip) read
 * the exact same numbers, so the price a user sees is the price the server
 * charges. Change a price here and the whole portal follows.
 *
 * HONESTY LAW (unchanged, mirrors the reveal till): a spend point is only
 * ever debited AFTER the feature actually delivered. A failed send, a failed
 * lookup, a bounced message — never a cent. The routes enforce this; the
 * catalog only carries the prices.
 */

export const SPEND_ACTIONS = {
  /** One email sent through the mail engine — outreach, invoices, statements:
   * anything that lands in a real inbox. Created-and-kept drafts and the
   * invoice itself are free; the nerve ending is the delivery. */
  EMAIL_SEND: {
    key: 'EMAIL_SEND',
    cents: 100, // R1.00 — transport costs fractions of a cent; the value is the conversation it starts.
    label: 'Outreach email',
    unit: 'per email sent',
    outcome: 'One real email lands in a real inbox — outreach, an invoice, a statement. The tap that starts or closes every pipeline.',
  },
} as const

export type SpendActionKey = keyof typeof SPEND_ACTIONS

/**
 * On the runway, priced but not yet charging: the catalog grows into these
 * bands the day their spend points ship. Displayed in the wallet as "soon"
 * so users can see where the airtime economy is going. NOTHING debits these
 * today — a SKU only goes live when a route starts charging it.
 */
export const COMING_SOON_SKUS = [
  {
    key: 'AI_DRAFT',
    cents: 500, // R5.00 — medium band: burns tokens
    label: 'AI draft (pay-as-you-go)',
    outcome: 'An AI-written email or pitch draft. Included free on every paid plan.',
  },
  {
    key: 'PITCH_VIDEO',
    cents: 2500, // R25.00 — large band: burns real render compute
    label: 'Pitch video render',
    outcome: 'A rendered video pitch for your business, ready to send or post.',
  },
] as const

/**
 * The top-up bonus ladder — the same curve the fixed packs ride.
 * Below the first tier a load earns nothing (honest small loads), at each
 * tier the bonus steps up. Works on ANY amount, so a custom R2,000 load and
 * a Scale pack of the same size earn the same bonus.
 */
export const TOPUP_MIN_CENTS = 5_00 // R50 — below this Yoco's fee starts eating the load
export const TOPUP_MAX_CENTS = 1_000_000 // R10,000 ceiling per load
export const TOPUP_BONUS_TIERS: { fromCents: number; bonusPct: number }[] = [
  { fromCents: 1_500_00, bonusPct: 10 }, // R1,500+ — the Growth tier
  { fromCents: 5_000_00, bonusPct: 15 }, // R5,000+ — the Scale tier
]

/** Bonus percent a load of `amountCents` earns (0 for honest small loads). */
export function bonusForLoad(amountCents: number): number {
  let bonus = 0
  for (const tier of TOPUP_BONUS_TIERS) {
    if (amountCents >= tier.fromCents) bonus = tier.bonusPct
  }
  return bonus
}

/** Credits (cents) a load actually lands: the load plus its ladder bonus. */
export function creditsForLoad(amountCents: number): number {
  return Math.round(amountCents * (1 + bonusForLoad(amountCents) / 100))
}

/**
 * Paid-plan send bundle: emails included free per ROLLING 30 DAYS — the free
 * minutes that ride along on contract. At the R1.00 sticker a month on
 * Operator carries R150 of sends, Boss R400 — the bundle IS the discount.
 * Beyond the bundle, sends spend airtime like everything else. The free plan
 * keeps its 6 lifetime sample sends (FREE_LIMITS.emailSends); after that it
 * goes straight to airtime too, which is strictly MORE room than the old
 * hard stop, never less.
 */
export const PLAN_SEND_BUNDLES: Record<string, number> = {
  HUSTLER: 150,
  BOSS: 400,
}
/** Sensible fallback if a future plan id ever misses the table. */
export const DEFAULT_SEND_BUNDLE = 150
export const SEND_BUNDLE_WINDOW_DAYS = 30
