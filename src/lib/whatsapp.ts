/**
 * WhatsApp toolkit — South-Africa-first phone normalization, contact-list
 * parsing (paste / VCF / CSV) and wa.me deep links.
 *
 * Pure functions only — safe to import on client (live preview) and server.
 *
 * Honest constraint this module is built around: Meta does NOT expose any API
 * to read the contact list inside someone's WhatsApp Business app. The
 * "connect and auto-add my list" flow therefore ships as (a) 1-click bulk
 * import of a pasted/exported list + (b) Cloud-API auto-capture of everyone
 * who messages the business number.
 */

export interface NormalizedPhone {
  e164: string | null // digits only, no "+", e.g. "27821234567" (wa.me format)
  display: string // "+27 82 123 4567" or raw fallback
  valid: boolean
  invalidReason?: string
}

export interface ParsedContact {
  name?: string
  phone: string // raw as found — normalize before trusting
  email?: string
  raw: string
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
// candidate phone spans inside arbitrary text: +27…, 082…, bare 9-12 digit runs
const PHONE_SPAN_RE = /(\+?\d[\d\s()./\u2013\u2014-]{6,}\d)/g

/** Normalize a single phone string for South Africa (default) or other intl. */
export function normalizePhone(rawInput: string): NormalizedPhone {
  const raw = (rawInput || '').trim()
  if (!raw) return { e164: null, display: '', valid: false, invalidReason: 'empty' }
  const plus = raw.trimStart().startsWith('+')
  const digits = raw.replace(/\D/g, '')

  if (!digits) return { e164: null, display: raw, valid: false, invalidReason: 'no digits' }

  // Explicit international (+…) — trust the caller's country code.
  if (plus || digits.startsWith('27') || (raw.startsWith('00') && digits.length >= 11)) {
    let d = digits.startsWith('00') ? digits.slice(2) : digits
    // 0027… / +27 with a stray leading 0 after the country code (027 082 …)
    if (d.startsWith('27') && d.length === 12 && d[2] === '0') d = '27' + d.slice(3)
    if (d.startsWith('27') && d.length === 11) {
      return { e164: d, display: saDisplay(d), valid: true }
    }
    if (plus && d.length >= 8 && d.length <= 15 && !d.startsWith('27')) {
      return { e164: d, display: '+' + d, valid: true }
    }
    return { e164: null, display: raw, valid: false, invalidReason: `not a valid SA number (${d.length} digits)` }
  }

  // Local formats: 0821234567 / 82 123 4567 / 011 123 4567
  if (digits.startsWith('0') && digits.length === 10) {
    const d = '27' + digits.slice(1)
    return { e164: d, display: saDisplay(d), valid: true }
  }
  if (digits.length === 9 && '678'.includes(digits[0])) {
    const d = '27' + digits
    return { e164: d, display: saDisplay(d), valid: true }
  }
  return {
    e164: null,
    display: raw,
    valid: false,
    invalidReason: `expect 10 digits starting 0 (got ${digits.length})`,
  }
}

function saDisplay(e164: string): string {
  // 27 82 123 4567
  const n = e164.slice(2) // 9 digits
  return `+27 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`
}

/** Extract every plausible phone candidate from a line of text. */
function phoneSpans(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(PHONE_SPAN_RE)) {
    const span = m[1].trim()
    // reject spans that are mostly non-digits (dates like 2024-01-05, amounts)
    const digits = span.replace(/\D/g, '')
    if (digits.length >= 8 && digits.length <= 13) out.push(span)
  }
  return out
}

function cleanName(line: string, phoneSpan: string, email?: string): string | undefined {
  let s = line
  if (phoneSpan) s = s.replace(phoneSpan, ' ')
  if (email) s = s.replace(email, ' ')
  s = s
    // drop timestamps like 12:34 or 2024/01/05 left over at edges
    .replace(/\b\d{1,2}[:/.]\d{2}(:\d{2})?\b/g, ' ')
    .replace(/[-–—|:;,.•·=*_~>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // must contain at least two letters to count as a name
  if (!s || (s.match(/[A-Za-z\u00C0-\u024F]/g)?.length ?? 0) < 2) return undefined
  if (s.length > 60) s = s.slice(0, 60).trim()
  return s
}

/**
 * Parse a pasted contact list in (almost) any shape:
 *  - one per line:  "Thandi — 082 123 4567", "+27 82 123 4567", "Thandi, 0821234567, thandi@gmail.com"
 *  - WhatsApp group-participant / broadcast-list copies
 *  - vCard (.vcf) exports (BEGIN:VCARD blocks)
 *  - CSV with a phone-ish header row (comma / semicolon / tab)
 * Dedupes within the batch by normalized number.
 */
export function parseContactList(text: string): ParsedContact[] {
  const clean = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!clean.trim()) return []
  if (/BEGIN:VCARD/i.test(clean)) return dedupeBatch(parseVcf(clean))
  if (looksLikeCsv(clean)) return dedupeBatch(parsePhoneCsv(clean))
  return dedupeBatch(parseFreeText(clean))
}

function dedupeBatch(contacts: ParsedContact[]): ParsedContact[] {
  const byE164 = new Map<string, ParsedContact>()
  for (const c of contacts) {
    const norm = normalizePhone(c.phone)
    const key = norm.e164 || `raw:${c.phone.replace(/\D/g, '')}`
    const existing = byE164.get(key)
    if (!existing) {
      byE164.set(key, { ...c, phone: norm.valid ? norm.e164! : c.phone })
    } else if (!existing.name && c.name) {
      existing.name = c.name
    }
  }
  return [...byE164.values()]
}

// ---------- free text ----------

function parseFreeText(text: string): ParsedContact[] {
  const out: ParsedContact[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const spans = phoneSpans(line)
    if (spans.length === 0) continue
    const email = line.match(EMAIL_RE)?.[0]
    const name = cleanName(line, spans[0], email)
    for (const span of spans) {
      out.push({ name, phone: span, email, raw: line.trim().slice(0, 120) })
    }
  }
  return out
}

// ---------- vCard ----------

export function parseVcf(text: string): ParsedContact[] {
  const out: ParsedContact[] = []
  const cards = text.split(/BEGIN:VCARD/i).slice(1)
  for (const card of cards) {
    const body = card.split(/END:VCARD/i)[0]
    const lines = body.split('\n')
    let name: string | undefined
    let tel: string | undefined
    let telFallback: string | undefined
    let email: string | undefined
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!name && /^FN[^:]*:/i.test(line)) {
        name = line.slice(line.indexOf(':') + 1).trim() || undefined
      } else if (!name && /^N[^:]*:/i.test(line)) {
        const parts = line.slice(line.indexOf(':') + 1).split(';')
        const joined = [parts[1]?.trim(), parts[0]?.trim()].filter(Boolean).join(' ')
        if (joined) name = joined
      } else if (/^item\d*\.?TEL[^:]*:/i.test(line) || /^TEL[^:]*:/i.test(line)) {
        const value = line.slice(line.indexOf(':') + 1).trim()
        const isCell = /CELL|MOBILE|WHATSAPP|iPhone/i.test(line)
        if (isCell && !tel) tel = value
        else if (!telFallback) telFallback = value
      } else if (!email && /^EMAIL[^:]*:/i.test(line)) {
        email = line.slice(line.indexOf(':') + 1).trim() || undefined
      }
    }
    const phone = tel || telFallback
    if (phone) out.push({ name, phone, email, raw: name || phone })
  }
  return out
}

// ---------- CSV ----------

const PHONE_HEADER_ALIASES = ['phone', 'mobile', 'cell', 'cellphone', 'telephone', 'tel', 'number', 'contact number', 'phone number', 'whatsapp', 'msisdn']
const NAME_HEADER_ALIASES = ['name', 'full name', 'contact', 'contact name', 'client', 'client name', 'first name', 'firstname', 'customer']
const COMPANY_HEADER_ALIASES = ['company', 'business', 'business name', 'organisation', 'organization', 'surname', 'last name', 'lastname']

function looksLikeCsv(text: string): boolean {
  const first = text.split('\n')[0] || ''
  if (!/[,;\t]/.test(first)) return false
  const head = first.toLowerCase()
  return PHONE_HEADER_ALIASES.some((h) => head.includes(h))
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === delim) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

function parsePhoneCsv(text: string): ParsedContact[] {
  const delim = text.includes('\t') ? '\t' : text.includes(';') && !text.includes(',') ? ';' : ','
  const rows = text.split('\n').filter((r) => r.trim())
  if (rows.length < 2) return []
  const headers = splitCsvLine(rows[0], delim).map((h) => h.trim().toLowerCase())
  const phoneIdx = headers.findIndex((h) => PHONE_HEADER_ALIASES.some((a) => h === a || h.includes(a)))
  if (phoneIdx === -1) return []
  const nameIdx = headers.findIndex((h) => NAME_HEADER_ALIASES.some((a) => h === a || h.includes(a)))
  const companyIdx = headers.findIndex((h) => COMPANY_HEADER_ALIASES.some((a) => h === a || h.includes(a)))
  const emailIdx = headers.findIndex((h) => h.includes('email') || h.includes('e-mail'))
  const out: ParsedContact[] = []
  for (const row of rows.slice(1)) {
    const cells = splitCsvLine(row, delim)
    const phone = (cells[phoneIdx] || '').trim()
    if (!phone) continue
    const first = nameIdx >= 0 ? (cells[nameIdx] || '').trim() : ''
    const company = companyIdx >= 0 ? (cells[companyIdx] || '').trim() : ''
    const name = [first, company].filter(Boolean).join(first && company ? ' — ' : '') || undefined
    out.push({ name, phone, email: emailIdx >= 0 ? (cells[emailIdx] || '').trim() || undefined : undefined, raw: row.trim().slice(0, 120) })
  }
  return out
}

// ---------- links ----------

/** Click-to-chat deep link. e164 = digits only (wa.me requires full intl format). */
export function waLink(e164: string, message?: string): string {
  const base = `https://wa.me/${e164.replace(/\D/g, '')}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

/** Prefilled greeting for a client row. */
export function waGreeting(name: string, businessName?: string | null): string {
  const first = (name || '').split(' ')[0] || 'there'
  const from = businessName ? ` — ${businessName}` : ''
  return `Hi ${first}!${from}`
}

export const MAX_IMPORT_BATCH = 500
