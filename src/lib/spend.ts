/**
 * The airtime price list — ONE tunable source of truth.
 *
 * The owner's law: the portal works like prepaid airtime. You load credits
 * once, priced features spend a few cents of them, and you reload when you
 * run dry. Functionality that works is worth paying for; the client never
 * has to think about the machinery, only about the change HustlePortal makes
 * for them ("we lead with what changes because you use HustlePortal").
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
  /** One outreach email sent through the mail engine (own Gmail or platform). */
  EMAIL_SEND: {
    key: 'EMAIL_SEND',
    cents: 50, // R0.50 — transport costs fractions of a cent; the value is the conversation it starts.
    label: 'Outreach email',
    unit: 'per email sent',
    outcome: 'One personal email lands in a real inbox — the tap that starts every pipeline.',
  },
} as const

export type SpendActionKey = keyof typeof SPEND_ACTIONS

/**
 * Paid-plan send bundle: emails included free per ROLLING 30 DAYS — the free
 * minutes that ride along on contract. Beyond the bundle, sends spend
 * airtime like everything else. The free plan keeps its 6 lifetime sample
 * sends (FREE_LIMITS.emailSends); after that it goes straight to airtime
 * too, which is strictly MORE room than the old hard stop, never less.
 */
export const PLAN_SEND_BUNDLES: Record<string, number> = {
  HUSTLER: 150,
  BOSS: 400,
}
/** Sensible fallback if a future plan id ever misses the table. */
export const DEFAULT_SEND_BUNDLE = 150
export const SEND_BUNDLE_WINDOW_DAYS = 30
