import { db } from '@/lib/db'
import PostalMime from 'postal-mime'
import { matchLead } from '@/lib/leadMatch'

// ============ INBOUND MAIL CAPTURE ============
//
// The migration door. A company never has to change how it emails: it keeps
// its old mailbox (Gmail, Outlook, the legacy ceo@ box) and simply CCs — or
// BCCs — log@hustleportal.online on mail it was sending anyway. Amazon SES
// receives the copy, SNS posts it to /api/webhooks/ses-inbound, this module
// parses it, and the email lands in the SENDER's HustlePortal email log as a
// LOGGED row. From there the record behaves like any other: read it, click it,
// spin a follow-up task from it. Adoption without migration friction.
//
// Laws this module keeps:
//  - ONE capture address for the whole platform (INBOUND_ADDRESS). The
//    sender's From line is the identity: it resolves through the account's
//    login email first, then through EmailAlias rows (the ceo@ on the legacy
//    domain, an info@ box). An address is owned by exactly one account.
//  - A sender nothing resolves to NEVER enters a tenant's books silently.
//    The mail waits in InboundMail as UNMATCHED for the executive queue —
//    claimed (one click) or ignored (spam, wrong address, junk).
//  - Honesty: captured rows are status LOGGED, provider SES_INBOUND,
//    direction IN. They were never sent by the engine and never pretend to
//    have been. The capture address itself is scrubbed from the displayed
//    To/Cc — the log shows the real audience, not the plumbing.
//  - Idempotent: SES redelivers; the SES messageId is the dedupe key, so a
//    replay never double-logs.

export const INBOUND_ADDRESS = 'log@hustleportal.online'

/** The user-facing log shows real mail, not plumbing — this much body text is kept. */
export const MAX_BODY_CHARS = 40_000

export interface ParsedInbound {
  sesMessageId: string | null
  fromEmail: string
  fromName: string | null
  toEmail: string
  ccEmail: string | null
  subject: string
  text: string
  receivedAt: Date
  spam: boolean
  sizeBytes: number | null
  contentMissing: boolean
}

function normAddress(s: string): string {
  return (s || '').trim().toLowerCase()
}

/** "Name <a@b.c>" → "a@b.c" (also copes with bare addresses). */
function extractAddress(raw: string): string {
  const m = /<([^>]+)>/.exec(raw || '')
  return normAddress(m ? m[1] : raw)
}

function extractName(raw: string): string | null {
  const m = /^\s*"?([^"<]*?)"?\s*</.exec(raw || '')
  const name = (m?.[1] || '').trim()
  return name || null
}

/** The capture address is plumbing, not audience — it never shows in a log row. */
function withoutCapture(list: string[]): string[] {
  return list.map(extractAddress).filter((a) => a && a !== INBOUND_ADDRESS)
}

/** Last-resort text extraction from an html-only email. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function capBody(s: string): string {
  const t = (s || '').trim()
  return t.length > MAX_BODY_CHARS ? `${t.slice(0, MAX_BODY_CHARS)}… [truncated]` : t
}

/**
 * Turn a SES receipt notification into the shape captureInboundEmail stores.
 * `content` is the raw MIME when the SES→SNS action was configured with
 * "include original content"; when it is missing (oversized mail) we still
 * produce an honest metadata row from the SES envelope headers.
 */
export function parseReceiptContent(input: {
  content: string
  commonHeaders?: { from?: string[]; to?: string[]; cc?: string[]; subject?: string; date?: string } | null
  destination?: string[] | null
  timestamp?: string | null
}): ParsedInbound {
  const { content, commonHeaders, destination, timestamp } = input
  const sizeBytes = content ? Buffer.byteLength(content, 'utf8') : null

  // Envelope fallback: SES commonHeaders always carry From/To/Subject even
  // when the MIME body failed to parse (or was never included).
  const headerFrom = (commonHeaders?.from || [])[0] || ''
  const fromEmail = extractAddress(headerFrom)
  const fromName = extractName(headerFrom)
  const toList = withoutCapture(commonHeaders?.to || destination || [])
  const ccList = withoutCapture(commonHeaders?.cc || [])
  const subject = (commonHeaders?.subject || '').trim() || '(no subject)'
  const date = commonHeaders?.date ? new Date(commonHeaders.date) : null

  const parsed: ParsedInbound = {
    sesMessageId: null,
    fromEmail: fromEmail || 'unknown@unknown.invalid',
    fromName,
    toEmail: toList.join(', '),
    ccEmail: ccList.length ? ccList.join(', ') : null,
    subject,
    text: '',
    receivedAt: (date && !isNaN(date.getTime()) ? date : null) || (timestamp ? new Date(timestamp) : null) || new Date(),
    spam: false,
    sizeBytes,
    contentMissing: !content,
  }
  return parsed
}

/**
 * The awaited MIME parse, separate from the sync envelope fallback above so
 * the webhook route can await it: fills in body text (and upgrades the From
 * line with the MIME-authoritative values when the envelope disagreed).
 */
export async function parseReceiptAsync(input: {
  content: string
  commonHeaders?: { from?: string[]; to?: string[]; cc?: string[]; subject?: string; date?: string } | null
  destination?: string[] | null
  timestamp?: string | null
  sesMessageId?: string | null
  spam?: boolean
}): Promise<ParsedInbound> {
  const base = parseReceiptContent(input)
  base.sesMessageId = input.sesMessageId || null
  base.spam = input.spam === true

  if (input.content) {
    try {
      const em = await PostalMime.parse(input.content)
      if (em.from?.address) {
        base.fromEmail = normAddress(em.from.address)
        base.fromName = (em.from.name || '').trim() || null
      }
      const tos = withoutCapture((em.to || []).map((a) => a.address || '').filter(Boolean))
      const ccs = withoutCapture((em.cc || []).map((a) => a.address || '').filter(Boolean))
      if (tos.length) base.toEmail = tos.join(', ')
      if (ccs.length) base.ccEmail = ccs.join(', ')
      if (em.subject && em.subject.trim()) base.subject = em.subject.trim()
      const bodyText = (em.text || '').trim() || stripHtml(em.html || '')
      base.text = capBody(bodyText || '(no body captured)')
    } catch {
      base.text = '(body could not be parsed — the SES headers above still hold who it was from and about)'
    }
  } else {
    base.text = '(content not included by the SES receipt rule — oversized mail; check the note)'
  }
  return base
}

/**
 * Whose mail is this? The From line resolves through the account login email
 * first, then through EmailAlias rows. Returns the owning userId or null —
 * and null ALWAYS means the unmatched queue, never a guess.
 */
export async function resolveInboundOwner(fromEmail: string): Promise<string | null> {
  const addr = normAddress(fromEmail)
  if (!addr || !addr.includes('@')) return null
  try {
    const byLogin = await db.user.findUnique({ where: { email: addr }, select: { id: true } })
    if (byLogin) return byLogin.id
    const byAlias = await db.emailAlias.findUnique({ where: { address: addr }, select: { userId: true } })
    if (byAlias) return byAlias.userId
  } catch (e) {
    console.error('[mailinbound] resolve failed', e)
  }
  return null
}

export type CaptureOutcome = 'LOGGED' | 'UNMATCHED' | 'DUPLICATE' | 'IGNORED'

export interface CaptureResult {
  outcome: CaptureOutcome
  inboundId: string | null
  emailLogId: string | null
}

/**
 * Store one received email: an EmailLog LOGGED row for the resolved owner
 * (plus the InboundMail audit row), or an UNMATCHED InboundMail waiting for
 * the executive queue. Duplicate SES message ids are absorbed silently.
 */
export async function captureInboundEmail(parsed: ParsedInbound): Promise<CaptureResult> {
  // Dedupe first: SES redelivers, webhooks retry, one mail is one row.
  if (parsed.sesMessageId) {
    const existing = await db.inboundMail.findUnique({ where: { sesMessageId: parsed.sesMessageId }, select: { id: true } })
    if (existing) return { outcome: 'DUPLICATE', inboundId: existing.id, emailLogId: null }
  }

  const userId = await resolveInboundOwner(parsed.fromEmail)

  if (!userId) {
    const row = await db.inboundMail.create({
      data: {
        sesMessageId: parsed.sesMessageId,
        fromEmail: parsed.fromEmail,
        fromName: parsed.fromName,
        toEmail: parsed.toEmail,
        ccEmail: parsed.ccEmail,
        subject: parsed.subject,
        textBody: capBody(parsed.text),
        status: 'UNMATCHED',
        spam: parsed.spam,
        sizeBytes: parsed.sizeBytes,
        note: parsed.contentMissing ? 'content not included by the receipt rule (oversized mail)' : null,
        receivedAt: parsed.receivedAt,
      },
      select: { id: true },
    })
    return { outcome: 'UNMATCHED', inboundId: row.id, emailLogId: null }
  }

  // A resolved owner gets the log row immediately. The From address is tried
  // against their pipeline leads (email, exact) so the record carries the
  // relationship when the contact already exists — one match links, zero or
  // many match nothing (never guess in someone's books).
  let leadId: string | null = null
  try {
    const m = await matchLead(userId, parsed.fromEmail, null)
    if (m.kind === 'ONE') leadId = m.lead.id
  } catch { /* linking is a bonus, never a blocker */ }

  const email = await db.emailLog.create({
    data: {
      userId,
      leadId,
      direction: 'IN',
      status: 'LOGGED',
      provider: 'SES_INBOUND',
      fromEmail: parsed.fromEmail,
      toEmail: parsed.toEmail || '(no visible recipients)',
      ccEmail: parsed.ccEmail,
      subject: parsed.subject,
      body: capBody(parsed.text),
      sentAt: parsed.receivedAt,
    },
    select: { id: true },
  })

  const row = await db.inboundMail.create({
    data: {
      sesMessageId: parsed.sesMessageId,
      fromEmail: parsed.fromEmail,
      fromName: parsed.fromName,
      toEmail: parsed.toEmail,
      ccEmail: parsed.ccEmail,
      subject: parsed.subject,
      textBody: capBody(parsed.text),
      status: 'LOGGED',
      spam: parsed.spam,
      sizeBytes: parsed.sizeBytes,
      note: parsed.contentMissing ? 'content not included by the receipt rule (oversized mail)' : null,
      userId,
      leadId,
      emailLogId: email.id,
      receivedAt: parsed.receivedAt,
    },
    select: { id: true },
  })

  return { outcome: 'LOGGED', inboundId: row.id, emailLogId: email.id }
}
