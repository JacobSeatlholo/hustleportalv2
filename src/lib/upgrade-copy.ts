/**
 * Upgrade moments — one voice for every free-plan ceiling.
 * Brand rules: simple english, high level power words, outcome phrasing with
 * empathy, legally sound, zero elaborative nonsense claims, no dashes.
 *
 * Pure copy module: safe to import from the server AND the client.
 */

export interface UpgradeCopy {
  /** One-line reason shown in toasts and the server 402 body. */
  notice: string
  /** Dialog headline. */
  title: string
  /** Dialog body: what is happening and what Operator changes. */
  body: string
  /** What Operator unlocks, as honest bullets. */
  perks: string[]
}

export const UPGRADE_COPY: Record<string, UpgradeCopy> = {
  discover: {
    notice: 'Free finds 5 real leads per search. Operator widens the net to 30.',
    title: 'Operator finds more of your next customers',
    body:
      'The free search returns 5 real businesses per run, and it always will. Operator widens the net: up to 30 real leads per search, matched to what your website actually sells, straight into your pipeline.',
    perks: [
      'Up to 30 real leads per search',
      'Leads matched to your own website',
      'Ready to call, ready to close',
    ],
  },
  inventory: {
    notice: 'Free tracks 3 stock items. Operator tracks your whole stockroom.',
    title: 'Track your whole stockroom on Operator',
    body:
      'The free plan keeps an eye on 3 items so you can feel how it works. Operator watches every item on your shelf, warns you before you run out, and shows what your stock is worth today.',
    perks: [
      'Unlimited stock items',
      'Low stock alerts before you run out',
      'Live stock and retail value',
    ],
  },
  email: {
    notice: 'Free sends 6 emails from your account. Operator sends unlimited.',
    title: 'Keep the conversations going',
    body:
      'The free plan sends 6 emails, enough to feel the engine work. Operator sends unlimited emails with your business name on every message, so follow ups never wait for a new month.',
    perks: [
      'Unlimited email sends',
      'Your business name on every send',
      'AI drafts grounded in your profile',
    ],
  },
  logo: {
    notice: 'Your logo on every invoice lives on Operator.',
    title: 'Put your name on every invoice',
    body:
      'An invoice with your logo reads as established and gets taken seriously. Upload it once and every invoice you print or email carries your brand. This one lives on Operator.',
    perks: [
      'Your logo on every invoice',
      'Set once, always printed',
      'Print and email ready',
    ],
  },
  default: {
    notice: 'This one lives on Operator. Choose a plan under Grow to unlock it.',
    title: 'This one lives on Operator',
    body:
      'Operator unlocks the full Business OS: deeper AI lead searches, unlimited emails, your whole stockroom and your logo on every invoice.',
    perks: [],
  },
}

export function upgradeCopyFor(feature?: string): UpgradeCopy {
  if (feature && UPGRADE_COPY[feature]) return UPGRADE_COPY[feature]
  return UPGRADE_COPY.default
}
