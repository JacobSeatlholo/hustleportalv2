/**
 * Campaign personalization — the greeting law, in one place.
 *
 * The bug this exists to kill (found live: every contact received "Hi Michael"):
 * a queue is built with per-recipient fills, but the Edit-draft editor loaded
 * ONE row's already-filled copy and the save flattened that literal text onto
 * every row. The {name} token was gone the moment the queue was built, so the
 * edit path had nothing to fill — one name spread to the whole audience.
 *
 * The law, once and for all:
 *   1. The MASTER draft (with {name}/{email} tokens) lives in the campaign
 *      state. The editor always opens the master, never a filled row.
 *   2. Any save (build, edit, Start) re-personalizes every QUEUED row from
 *      the master: each row greets its own contact's first name.
 *   3. A flattened letter ("Hi Michael") is healed on save: the greeting name
 *      is re-tokenized to {name} before the per-row fill runs.
 *   4. An explicit opt-out (composer's "Fill {name} and {email} per person"
 *      unticked) is respected: the letter rides byte-identical for everyone.
 *
 * No db import here — pure functions, testable in isolation, safe on any lane.
 */

/** Words that are never a person's name in a greeting (formal/casual static). */
const NOT_A_NAME = new Set([
  'sir', 'sirs', 'madam', 'madame', 'team', 'all', 'everyone', 'folks', 'guys',
  'friend', 'friends', 'people', 'world', 'colleague', 'colleagues',
  'partner', 'partners', 'there',
])

/** Honorifics are skipped when picking the greeting name out of a contact name. */
const HONORIFICS = /^(dr|mr|mrs|ms|miss|mx|prof|professor|adv|hon|rev)\.?$/i

/**
 * The recipient's greeting name: the first usable word of their contact name
 * ("Michael Scott" → "Michael", "Dr Naledi Mokoena" → "Naledi"). Returns ''
 * when there is no usable name — the caller decides the fallback ("there").
 */
export function recipientFirstName(raw?: string | null): string {
  const words = String(raw || '').trim().split(/\s+/).filter(Boolean)
  for (const w of words) {
    const clean = w.replace(/^[("''-]+/, '').replace(/[)"''",.;:!?-]+$/, '')
    if (!clean) continue
    if (HONORIFICS.test(clean)) continue
    if (clean.includes('@')) continue // an email pasted into the name field is not a name
    return clean
  }
  return ''
}

/**
 * Greeting opener words the tokenizer accepts. Multi-word openers first so
 * "Good morning Michael" is not cut at "Good". Deliberately a small, honest
 * list — a tokenizer that reaches too far edits letters it should not touch.
 */
const GREETING_OPENERS = [
  'good morning', 'good afternoon', 'good evening',
  'hi', 'hello', 'hey', 'dear', 'molo', 'sawubona',
]

/** One greeting + one name word, anchored to the start of the text or a line. */
const GREETING_RE = new RegExp(
  `(^|\\n)(${GREETING_OPENERS.map((g) => g.replace(/ /g, '\\s+')).join('|')})\\s+` +
  `([A-Za-z][A-Za-z''’.-]*)`,
  'i',
)

/**
 * Heal a flattened greeting: the salutation's name becomes {name} so the
 * per-row fill can greet every contact properly. Only the FIRST salutation —
 * the one at the top of the letter — is touched; a name mentioned later in
 * the body ("...introducing you to Michael Jordan...") stays exactly as
 * written. Static greetings (Hi team, Dear Sir/Madam) are left alone, and a
 * draft that already carries {name} is returned untouched.
 */
export function tokenizeGreeting(text: string): { text: string; healed: boolean } {
  if (!text || /\{name\}/.test(text)) return { text, healed: false }
  const m = GREETING_RE.exec(text)
  if (!m) return { text, healed: false }
  const name = m[3]
  if (NOT_A_NAME.has(name.toLowerCase())) return { text, healed: false }
  // The match must be the letter's opening line: the greeting starts the text
  // or sits at the top of it (within the first 120 characters). A "hi" buried
  // deep in the body is a word in a sentence, not a salutation.
  if (m.index + m[1].length > 120) return { text, healed: false }
  // Rebuild around the full match (opener + whitespace + name), so whatever
  // spacing or punctuation follows the name survives untouched.
  const start = m.index + m[1].length
  const healed = text.slice(0, start) + m[2] + ' {name}' + text.slice(m.index + m[0].length)
  return { text: healed, healed: true }
}

/** Tokenize subject and body of a master draft. Healed = at least one greeting repaired. */
export function tokenizeDraft(subject: string, body: string): {
  subject: string; body: string; healed: boolean
} {
  const s = tokenizeGreeting(subject || '')
  const b = tokenizeGreeting(body || '')
  return { subject: s.text, body: b.text, healed: s.healed || b.healed }
}

/** Fill the merge tags for one recipient. Same law as audience.fillMergeTags. */
export function fillForRecipient(template: string, name: string, email: string): string {
  return template.replace(/\{name\}/g, name).replace(/\{email\}/g, email)
}

export interface RefillRow {
  id: string
  toEmail: string
}

export interface RefillGroup {
  ids: string[]
  subject: string
  body: string
}

/**
 * Build the per-recipient writes for a master draft: every queued row gets
 * its own filled subject/body, grouped by identical copy so one updateMany
 * per distinct greeting covers the whole queue. `nameForRow` resolves the
 * greeting name for a row (member queues: the lead's contact name; exec
 * queues: the account behind the address) and may return '' — the caller's
 * fallback runs there.
 */
export function groupRefillWrites<T extends RefillRow>(
  rows: T[],
  master: { subject: string; body: string },
  nameForRow: (row: T) => string,
  caps: { subject: number; body: number } = { subject: 180, body: 4000 },
): RefillGroup[] {
  const groups = new Map<string, RefillGroup>()
  for (const row of rows) {
    const nm = nameForRow(row) || 'there'
    const subject = fillForRecipient(master.subject, nm, row.toEmail).slice(0, caps.subject)
    const body = fillForRecipient(master.body, nm, row.toEmail).slice(0, caps.body)
    const key = `${subject}\u0000${body}`
    const g = groups.get(key)
    if (g) g.ids.push(row.id)
    else groups.set(key, { ids: [row.id], subject, body })
  }
  return [...groups.values()]
}
