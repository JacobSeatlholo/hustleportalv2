/**
 * Currency localizer — one rule, legally sound:
 *   Billing ALWAYS happens in South African Rand (ZAR). Yoco settles in ZAR.
 *   Visitors inside South Africa (and anyone whose country we cannot prove)
 *   see Rand only — a South African must never be served a dollar figure.
 *   Proven visitors from other countries see an honest converted estimate,
 *   labelled as an estimate, with the Rand amount never hidden.
 */
export type Currency = 'ZAR' | 'USD'

/** Conversion guide for display only. Update here when the rate moves meaningfully. */
export const ZAR_PER_USD = 18.5

export function currencyForCountry(country: string | null | undefined): Currency {
  return (country || 'ZA').toUpperCase() === 'ZA' ? 'ZAR' : 'USD'
}

/** Format a ZAR cents amount as the local display price. */
export function formatPrice(centsZar: number, currency: Currency): string {
  if (currency === 'ZAR') {
    const r = centsZar / 100
    return `R${r.toLocaleString('en-ZA', { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
  }
  const usd = centsZar / 100 / ZAR_PER_USD
  // round to a clean dollar figure, never a fake .99
  return `$${Math.max(1, Math.round(usd))}`
}

/** The one honest line shown wherever a converted price appears. */
export function conversionNote(currency: Currency): string | null {
  return currency === 'ZAR'
    ? null
    : 'Prices are converted from South African Rand for guidance. Your card is charged in Rand (ZAR) at the day\'s exchange rate.'
}
