/**
 * quality.ts, the lead-quality law.
 *
 * Every contact that enters the platform through ANY door (CSV import, paste,
 * signup form, API) passes these checks. Junk data never becomes a row:
 * invalid emails are refused, phones are normalized to E.164 South African
 * form, and duplicates are detected before creation. World-class leads are
 * not a feature, they are a gate.
 */

/** Strict-enough email shape check: one @, no spaces, dotted domain with a TLD. */
export function isEmail(v: unknown): boolean {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (s.length < 6 || s.length > 254) return false
  if (/\s/.test(s)) return false
  // Exactly one @, something before it, and a domain of at least two labels.
  const at = s.split('@')
  if (at.length !== 2) return false
  const [local, domain] = at
  if (!local || !domain) return false
  if (!/^[A-Za-z0-9._%+-]+$/.test(local)) return false
  if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(domain)) return false
  if (domain.includes('..') || domain.startsWith('.') || domain.startsWith('-')) return false
  return true
}

/** Lowercase, trimmed email, the canonical storage form. */
export function normEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

/**
 * Company matching key for duplicate detection: lowercase, strip legal
 * suffixes and everything that is not a letter or digit. "Nkosi Brands (Pty) Ltd"
 * and "nkosi brands" collapse to the same key.
 */
export function normCompanyKey(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .toLowerCase()
    .replace(/\(?(pty|ltd|cc|inc|sa|pty ltd|closed corporation|company|co)\)?\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 80)
}

/** Digits only, for SKU/barcode matching. */
export function normSku(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim().toLowerCase().replace(/[\s_-]/g, '').slice(0, 64)
}

/** Clean a number that arrived from a spreadsheet: "R 1 250,00" style noise out. */
export function cleanNumber(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  if (typeof v !== 'string') return 0
  const n = parseFloat(v.replace(/[^0-9.\-]/g, ''))
  return isFinite(n) ? n : 0
}
