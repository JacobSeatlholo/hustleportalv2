/**
 * Email sending, PLUG & PLAY.
 * Resolution order:
 *   1. USER'S OWN Gmail (optional, Integrations hub), their voice, replies land in their inbox.
 *      Skipped automatically for 10 minutes after an auth failure (circuit breaker) so one
 *      bad password never blocks sends.
 *   2. PLATFORM sending via Resend (server env RESEND_API_KEY), works for everyone, zero setup.
 *      Sends from the branded address (noreply@hustleportal.online) and falls back to the
 *      Resend test sender while the domain is still verifying, no RESEND_FROM env needed.
 *      Replies go to the user's account email via Reply-To.
 * HustlePortal never forces users to create app passwords or OAuth grants.
 */
import { createHash, createHmac } from 'node:crypto'
import { db } from '@/lib/db'
import { campaignHtml, flattenMarkdownLinks, renderTextBlocks } from '@/lib/campaignhtml'
import { themedEmailHtml, sanitizeBrand, type MailBrand, type MailThemeId } from '@/lib/mailthemes'

/**
 * Member mail carries NO ads, NO product pitch and NO referral link, ever.
 * The email belongs to the member's business and their client, not to our
 * growth loop. A platform delivered send adds one quiet delivery line and
 * mail sent through the member's own Gmail adds nothing at all. (A public
 * reviewer nailed us on this: a two line business email used to ship with
 * a HustlePortal advert plus a referral code. Never again.) Full legal
 * footers stay on platform ORIGINATED mail: campaign and lifecycle sends
 * append them in their own send paths.
 */
export function memberFooter(): string {
  return '\n\nDelivered by HustlePortal (hustleportal.online)'
}

export type MailCreds = { user: string; appPassword: string }

export type MailSendResult =
  | { ok: true; provider: 'GMAIL' | 'PLATFORM'; notice?: string; from?: string }
  | { ok: false; error: string }

/** The mail payload every path understands. cc is a sanitized list; fromLocal
 *  is the sender's own pick of the part BEFORE the @ on our sending domain —
 *  the domain itself never moves (it is the one Resend signs). */
export type OutgoingMail = {
  to: string
  cc?: string[]
  fromLocal?: string
  subject: string
  body: string
  attachments?: MailAttachment[]
  /** The workspace the sender picked in the composer's "Sending from" row.
   *  The pick decides the display name AND the local part on our sending
   *  domain, and it forces the engine lane: Gmail always sends as the
   *  connected account, it can never wear another business's name. */
  projectId?: string
  /** Open-tracking pixel for engine sends — the read receipts the mail log
   *  shows. Engine lane only; a send from their own Gmail carries no tracker. */
  pixelUrl?: string
  /** The mail look the sender picked in the composer. Undefined/'plain' sends
   *  exactly as always (text only); a branded look rides the same body as html
   *  alongside the plain text, on BOTH member lanes (their Gmail + the engine). */
  theme?: MailThemeId
  /** Optional sender brand (their uploaded campaign logo + business name) —
   *  dresses the themed chrome on member lanes. The appointment invite rides
   *  this so a client gets mail that looks like it came from THAT business. */
  brand?: MailBrand
}

/**
 * The themed html for a member send: the look the sender chose frames THEIR
 * words, nothing else. No legal footer, no unsubscribe, no pitch — the member
 * law holds (this is their business email to their contact; the platform adds
 * only the quiet "Delivered by HustlePortal" line on engine sends, which is
 * part of the body text and renders as the closing block). Pure function.
 */
export function memberThemedHtml(body: string, theme?: MailThemeId, standardCharacter = true, brand?: MailBrand): string | undefined {
  if (!theme || theme === 'plain') return undefined
  // Member sends ride the standard character law: blank-shirt badger, neutral
  // HP chip — the BH vest only rides HustlePortal's own mail and the boss's
  // own unbranded sends, never a member's. The replay path passes the flag
  // through so an exec's own rows replay the BH chrome they actually wore.
  // A member WITH an uploaded campaign logo may pass their brand: their client
  // then gets mail that looks like it came from THEIR business (the Task 185
  // brand law, applied to the member lane), never our mark.
  return themedEmailHtml(body, { theme, footerLines: [], standardCharacter, ...(brand ? { brand } : {}) })
}

/** The 1x1 open-tracker img, appended inside the html body when present. */
function appendOpenPixel(html: string, pixelUrl: string): string {
  const img = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}</body>`) : html + img
}

/**
 * The html side of a member ENGINE send: the picked look frames their words,
 * and when a read-receipt pixel rides along (mail log read stamps), the html
 * carries it. A plain look with a pixel renders as clean minimal html — text
 * alone can never fire an image, so the pixel needs a page to live in. The
 * words stay word-for-word the same; only the wrapper is new. Pure function.
 */
function memberHtmlWithPixel(mail: OutgoingMail): string | undefined {
  const themed = memberThemedHtml(mail.body, mail.theme, true, mail.brand)
  if (themed) return mail.pixelUrl ? appendOpenPixel(themed, mail.pixelUrl) : themed
  if (!mail.pixelUrl) return undefined
  return (
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9">' +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:640px;margin:0 auto;background:#ffffff;padding:28px;border:1px solid #e3e5e8">` +
    `${renderTextBlocks(mail.body)}` +
    `<img src="${mail.pixelUrl}" width="1" height="1" alt="" style="display:none" />` +
    '</div></body></html>'
  )
}

/**
 * Replay the exact html a SENT email wore, from its EmailLog row alone.
 *
 * The log stores the words (body) plus the look (theme) — the html the
 * recipient actually saw is rebuilt deterministically from those:
 *   - member Gmail send → their words in the picked look, nothing added;
 *   - member engine send → the quiet "Delivered by HustlePortal" line was part
 *     of the text at send time, so the replay appends it again;
 *   - campaign row → the full bulk chrome (unsub line + legal footer + branded
 *     frame), reconstructed with the signed link from the row id. The open
 *     pixel is deliberately left OUT — a preview must never count as a read.
 * 'plain' and legacy rows return undefined: the honest answer that the send
 * was text only, and the preview shows the words as they went.
 */
export function replaySentHtml(opts: {
  body: string
  theme?: string | null
  provider?: string | null
  campaign?: string | null
  /** Campaign rows only: the signed one-tap unsubscribe link of that row. */
  unsubUrl?: string | null
  /** Campaign rows only: the sender brand the send rode (from the queue state).
   *  Absent on an exec blast = the BH chrome, exactly as it went out. */
  brand?: MailBrand | null
  /** Campaign rows only: true when the send rode the standard character
   *  (member-owned or branded queue) — the replay must match the send. */
  standardCharacter?: boolean
}): string | undefined {
  const bodyText = String(opts.body || '')
  if (!bodyText.trim()) return undefined
  // Rows that already store full html (defensive: nothing writes that today,
  // but a preview must never escape-render html as text).
  if (/<html[\s>]|<!doctype\s+html/i.test(bodyText)) return bodyText
  const theme = (opts.theme || undefined) as MailThemeId | undefined
  if (opts.campaign) {
    // Legacy 'plain' campaign rows shipped text + pixel only; the replay has
    // no pixel (a preview must not fire the read receipt), so plain = text.
    if (!theme || theme === 'plain') return undefined
    // The tail matches what the send actually carried: branded queues credit
    // the sender, unbranded ones keep the legal block.
    const tail = campaignTail(opts.unsubUrl || undefined, opts.brand || undefined)
    return campaignMailHtml(
      {
        body: flattenMarkdownLinks(bodyText),
        theme,
        brand: opts.brand || undefined,
        standardCharacter: opts.standardCharacter,
      },
      tail,
    )
  }
  if (!theme || theme === 'plain') return undefined
  // Non-campaign rows: member sends rode the standard chrome, exec rows the
  // BH one — the caller (preview API) passes the requester's law so the
  // replay shows exactly what landed.
  return memberThemedHtml(bodyText + (opts.provider === 'PLATFORM' ? memberFooter() : ''), theme, opts.standardCharacter ?? true)
}

const EMAIL_ADDRESS_RE = /^[\w.+-]+@[\w.-]+\.\w+$/

/** "a@x.co.za, b@y.co; c@z.com" → up to five valid, de-duplicated addresses. */
export function sanitizeCcInput(raw: string): string[] {
  return Array.from(
    new Set(
      String(raw || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => EMAIL_ADDRESS_RE.test(s)),
    ),
  ).slice(0, 5)
}

/** Only the part before the @ is the user's to edit. "accounts", or even a
 *  full address they pasted, collapses to a clean local part on our domain. */
export function sanitizeFromLocal(raw: string): string | null {
  let s = String(raw || '').trim().toLowerCase()
  const at = s.indexOf('@')
  if (at > 0) s = s.slice(0, at)
  const local = s
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '')
  return local || null
}

/** Branded sender, works the moment hustleportal.online verifies in Resend. */
const BRANDED_FROM = 'HustlePortal <noreply@hustleportal.online>'
/** Resend's test sender, delivers to the account's own inbox while the domain verifies. */
const SANDBOX_FROM = 'HustlePortal <onboarding@resend.dev>'

/**
 * The legal footer every email leaving hustleportal.online carries. Short by
 * design, one confidentiality line, the company behind the send, the live
 * legal links (Terms, Privacy & POPIA, Cookie Policy, PAIA Manual) and the
 * copyright. Plain text, no images, quiet and professional.
 */
/**
 * The legal footer lines, shared by the plain text side and the themed html
 * side so both stays word-for-word the same.
 */
export function legalFooterLines(): string[] {
  const year = new Date().getFullYear()
  return [
    'HustlePortal · Simple Eternity Holdings (Pty) Ltd · businesshustle.co.za',
    'This email is confidential. If it reached you in error, notify team@businesshustle.co.za and delete it.',
    'Terms: https://businesshustle.co.za/terms',
    'Privacy & POPIA: https://businesshustle.co.za/privacy',
    'Cookie Policy: https://businesshustle.co.za/cookies',
    'PAIA Manual: https://app.businesshustle.co.za/wp-content/uploads/2025/12/BHW-PAIA-Manual-Integrated-with-POPIA.pdf',
    `© ${year} Simple Eternity Holdings (Pty) Ltd. All rights reserved.`,
  ]
}

function legalFooter(): string {
  return ['', '', ...legalFooterLines()].join('\n')
}

/** The plain-text tail of a campaign: the one-click unsubscribe line, then —
 *  branded sends — the SENDER'S name as the sign-off (their client mail must
 *  read as their business, with the platform credited once), or — unbranded
 *  sends — the full HustlePortal legal block exactly as it has always been.
 *  Shared by both transports so they stay word-for-word identical. */
function campaignTail(unsub: string | undefined, brand?: MailBrand): string {
  const un = unsub ? `\n\nPrefer not to hear from us again? One tap and you are out: ${unsub}` : ''
  const credit = brand ? `\n\n${brand.name} · sent via HustlePortal` : legalFooter()
  return un + credit
}

/**
 * Per-user sending identity, every business mails from ITS OWN address on our domain:
 * "Nkosi Brands" → nkosi-brands@hustleportal.online. The domain is verified, Resend
 * accepts any local part on it, and DKIM/SPF sign the send. Reply-To stays the user's
 * real account email, so replies land in THEIR inbox (set in resendSend).
 */
/** Build the from/address pair for a display label: "Avenzara" →
 *  "Avenzara via HustlePortal <avenzara@hustleportal.online>". Pure, shared
 *  by the identity resolver and the composer's sender-profile list. */
export function identityFromLabel(rawLabel: string): { from: string; address: string; label: string } {
  const label = (rawLabel || 'HustlePortal').trim().slice(0, 40) || 'HustlePortal'
  const slug =
    label
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
      .replace(/-+$/, '') || 'owner'
  return {
    from: `${label} via HustlePortal <${slug}@hustleportal.online>`,
    address: `${slug}@hustleportal.online`,
    label,
  }
}

export async function userSendingIdentity(userId: string, projectId?: string): Promise<{ from: string; address: string; label: string }> {
  try {
    // An explicit pick (the composer's "Sending from" row) is the sender's
    // choice and wins whole — but ONLY a workspace they own, never one
    // guessed from an id that happens to exist.
    if (projectId) {
      const picked = await db.project.findFirst({ where: { id: projectId, userId }, select: { name: true } })
      if (picked) return identityFromLabel(picked.name)
    }
    const [user, project] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { name: true, businessName: true } }),
      db.project.findFirst({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { name: true },
      }),
    ])
    // The ACCOUNT's business name leads when nothing was picked. Workspaces
    // get created, renamed and abandoned; the business on the account is who
    // every send should introduce by default (the wrong-workspace name
    // leaking onto mail is exactly the bug this order fixes).
    return identityFromLabel(user?.businessName || project?.name || user?.name || 'HustlePortal')
  } catch {
    return { from: BRANDED_FROM, address: 'noreply@hustleportal.online', label: 'HustlePortal' }
  }
}

/** The domain sends are labelled from (RESEND_FROM wins if the operator set one). */
export function sendingDomain(): string {
  const from = process.env.RESEND_FROM?.trim()
  const m = from?.match(/<[^>]*@([^>]+)>|@([\w.-]+)\s*$/)
  return (m && (m[1] || m[2])) || 'hustleportal.online'
}

// ---------------------------------------------------------------- status

export type MailDomainRow = { name: string; status: string }
export type MailStatus = {
  platformConfigured: boolean
  fromAddress: string
  /** The user's own address on our domain, e.g. nkosi-brands@hustleportal.online */
  sendingAs?: string
  sendingDomain: string
  domainStatus: 'verified' | 'pending' | 'not_started' | 'failed' | 'unknown'
  domains: MailDomainRow[]
  gmailConfigured: boolean
}

let domainCache: { at: number; rows: MailDomainRow[] } | null = null
const DOMAIN_TTL_MS = 60_000

// --- durable domain proof ---------------------------------------------------
// A sending-restricted Resend key can never read /domains (403 → status shows
// "unknown" forever). But every ACCEPTED branded send IS proof the domain is
// verified in the key's account. Stamp it in PlatformConfig so the status UI
// reflects reality instead of nagging about verification that already happened.
const DOMAIN_PROOF_KEY = 'MAIL_DOMAIN_VERIFIED_AT'
const DOMAIN_PROOF_TTL_MS = 30 * 24 * 60 * 60_000

async function stampDomainProof(): Promise<void> {
  try {
    await db.platformConfig.upsert({
      where: { key: DOMAIN_PROOF_KEY },
      create: { key: DOMAIN_PROOF_KEY, value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    })
  } catch {
    // proof is best-effort, never let it break a send
  }
}

async function readDomainProof(): Promise<boolean> {
  try {
    const row = await db.platformConfig.findUnique({ where: { key: DOMAIN_PROOF_KEY } })
    if (!row?.value) return false
    return Date.now() - new Date(row.value).getTime() < DOMAIN_PROOF_TTL_MS
  } catch {
    return false
  }
}

const LAST_SEND_KEY = 'MAIL_LAST_SYSTEM_SEND'

/**
 * Durable record of the last system email (password resets etc.): recipient, subject,
 * time, outcome. This is how we answer "the email never arrived" without a full-access
 * Resend key, the send either fired (with the exact address it went to) or it didn't.
 */
async function stampLastSystemSend(entry: { to: string; subject: string; ok: boolean; via?: string; error?: string }): Promise<void> {
  try {
    await db.platformConfig.upsert({
      where: { key: LAST_SEND_KEY },
      create: { key: LAST_SEND_KEY, value: JSON.stringify({ ...entry, at: new Date().toISOString() }) },
      update: { key: LAST_SEND_KEY, value: JSON.stringify({ ...entry, at: new Date().toISOString() }) },
    })
  } catch {
    // best-effort, never break a send over bookkeeping
  }
}

export async function readLastSystemSend(): Promise<{ to: string; subject: string; ok: boolean; via?: string; error?: string; at: string } | null> {
  try {
    const row = await db.platformConfig.findUnique({ where: { key: LAST_SEND_KEY } })
    if (!row?.value) return null
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

/**
 * A reset was requested for an email that matches NO account, the most common
 * "the email never arrived" cause. Stamp it so diagnostics show the request
 * happened and nothing was sent (admin-only view). Never reveals whether an
 * account exists to the requester, the API response stays identical.
 */
export async function recordNoAccountReset(email: string): Promise<void> {
  await stampLastSystemSend({
    to: email,
    subject: 'Password reset requested',
    ok: false,
    via: 'no-account',
    error: 'No HustlePortal account matches this address. Nothing was sent. Check for a typo or a different signup email.',
  })
}

async function fetchResendDomains(apiKey: string): Promise<MailDomainRow[]> {
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return domainCache?.rows || []
    const json = (await res.json()) as { data?: { name?: string; status?: string }[] }
    const rows = (json.data || [])
      .filter((d) => d.name)
      .map((d) => ({ name: d.name as string, status: d.status || 'unknown' }))
    domainCache = { at: Date.now(), rows }
    return rows
  } catch {
    return domainCache?.rows || []
  }
}

/** One-call status for the Mail UI, engine state, sender address, live Resend domain verification. */
export async function getMailStatus(userId: string): Promise<MailStatus> {
  const apiKey = process.env.RESEND_API_KEY?.trim() || ''
  const rows = apiKey ? await fetchResendDomains(apiKey) : []
  const domain = sendingDomain()
  const own = rows.find((r) => r.name === domain)
  // Accepted branded send = the domain verified, even when the key can't read
  // the domains list (sending-restricted key). Trust live Resend rows first,
  // then our own send-proof, then guess from whatever rows exist.
  const proved = own ? false : await readDomainProof()
  const status: MailStatus['domainStatus'] = own
    ? (own.status as MailStatus['domainStatus'])
    : proved
      ? 'verified'
      : rows.some((r) => r.status === 'verified')
        ? 'verified'
        : rows.length
          ? 'pending'
          : 'unknown'
  const creds = await getUserMailCreds(userId)
  const identity = await userSendingIdentity(userId)
  return {
    platformConfigured: !!apiKey,
    fromAddress: process.env.RESEND_FROM?.trim() || identity.from,
    sendingAs: process.env.RESEND_FROM?.trim() ? undefined : identity.address,
    sendingDomain: domain,
    domainStatus: status,
    domains: rows,
    gmailConfigured: !!creds,
  }
}

// ------------------------------------------------------- gmail circuit breaker

/** After an auth rejection, stop retrying Gmail for 10 min, platform engine takes over. */
const gmailBlockedUntil = new Map<string, number>()
const GMAIL_COOLDOWN_MS = 10 * 60_000

export function flagGmailFailure(userId: string): void {
  gmailBlockedUntil.set(userId, Date.now() + GMAIL_COOLDOWN_MS)
}
export function clearGmailFailure(userId: string): void {
  gmailBlockedUntil.delete(userId)
}
function gmailOnCooldown(userId: string): boolean {
  const until = gmailBlockedUntil.get(userId) || 0
  if (until && Date.now() >= until) {
    gmailBlockedUntil.delete(userId)
    return false
  }
  return until > 0
}

/** Trim Google SMTP's debug wall to one readable line. */
function firstLine(s: string): string {
  const cut = s.split(/https:\/\/|\s-\s+gsmtp|\n/)[0].trim()
  return (cut || s.trim()).slice(0, 180)
}

/** Auth-class Gmail failure (normal password instead of an App Password, etc.). */
const GMAIL_AUTH_RE = /535|BadCredentials|Username and Password not accepted|Invalid login|EAUTH/i
export function isGmailAuthError(msg: string): boolean {
  return GMAIL_AUTH_RE.test(msg)
}

/**
 * Translate raw SMTP/transport failures into one actionable line.
 * The classic case: 535 BadCredentials, Gmail refuses NORMAL passwords for
 * sending; only App Passwords work (2-Step Verification required).
 */
export function classifyGmailError(msg: string): string {
  if (GMAIL_AUTH_RE.test(msg)) {
    return 'Gmail rejected your login. It needs an App Password, not your normal password. Integrations → Gmail → Test connection walks you through it in about a minute.'
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|socket|timeout/i.test(msg)) {
    return 'Could not reach Gmail\'s mail servers from here. Check this deployment\'s outbound network, or remove your Gmail under Integrations to let the HustlePortal engine send instead.'
  }
  return `Gmail rejected the send: ${firstLine(msg)}`
}

/** Resend's sandbox restricts sends until the sender domain is verified. */
function classifyPlatformError(msg: string, domainVerified = false): string {
  const domain = sendingDomain()
  if (domainVerified && /422|validation|invalid/i.test(msg)) {
    return 'The email service rejected the recipient address as undeliverable. Check it for typos, or try a different address.'
  }
  if (/testing emails|only send.*own email|403/i.test(msg)) {
    return `${domain} is still verifying in Resend. Until it completes, sends can only reach your own account inbox. Nothing to configure: it opens up automatically the moment you hit Verify at resend.com/domains.`
  }
  if (/422|"from"|validation/i.test(msg)) {
    return `The sending address isn't accepted yet. ${domain} must finish verifying at resend.com/domains (DNS can take up to a few hours).`
  }
  return `HustlePortal engine error: ${firstLine(msg)}`
}

export async function getUserMailCreds(userId: string): Promise<MailCreds | null> {
  const rows = await db.userSetting.findMany({
    where: { userId, key: { in: ['GMAIL_USER', 'GMAIL_APP_PASSWORD'] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  if (!map.GMAIL_USER || !map.GMAIL_APP_PASSWORD) return null
  return { user: map.GMAIL_USER, appPassword: map.GMAIL_APP_PASSWORD }
}

/** A mail attachment rides as base64; decoded size is capped in sendMail. */
export interface MailAttachment {
  filename: string
  content: string // base64
}

const MAX_ATTACHMENTS_TOTAL = 8 * 1024 * 1024 // decoded bytes across all files

/** Keep honest, small, decodable attachments only. Invalid entries are dropped, never fatal. */
function sanitizeAttachments(list?: MailAttachment[]): MailAttachment[] | undefined {
  if (!Array.isArray(list)) return undefined
  const clean: MailAttachment[] = []
  let total = 0
  for (const a of list) {
    const filename = String(a?.filename || 'attachment').slice(0, 120).replace(/[\r\n]/g, '')
    const content = typeof a?.content === 'string' ? a.content.replace(/\s/g, '') : ''
    if (!content || !/^[A-Za-z0-9+/=]+$/.test(content)) continue
    const bytes = Math.floor(content.length * 0.75)
    total += bytes
    if (total > MAX_ATTACHMENTS_TOTAL) break
    clean.push({ filename: filename || 'attachment', content })
  }
  return clean.length ? clean.slice(0, 3) : undefined
}

async function sendViaUserGmail(
  creds: MailCreds,
  mail: OutgoingMail,
): Promise<{ ok: true; provider: 'GMAIL'; from: string } | { ok: false; error: string }> {
  try {
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: creds.user, pass: creds.appPassword },
    })
    const themed = memberThemedHtml(mail.body, mail.theme, true, mail.brand)
    await transport.sendMail({
      from: `"HustlePortal" <${creds.user}>`,
      to: mail.to,
      ...(mail.cc?.length ? { cc: mail.cc } : {}),
      subject: mail.subject,
      text: mail.body,
      ...(themed ? { html: themed } : {}),
      ...(mail.attachments?.length
        ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, 'base64') })) }
        : {}),
    })
    return { ok: true, provider: 'GMAIL', from: creds.user }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to send email'
    return { ok: false, error: classifyGmailError(msg) }
  }
}

async function resendPost(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; id?: string } | { ok: false; raw: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      return { ok: false, raw: `Email service error ${res.status}: ${detail}` }
    }
    // The provider id is how bounce and complaint webhooks find their row.
    const j = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, id: j?.id }
  } catch (e) {
    return { ok: false, raw: e instanceof Error ? e.message : 'Failed to send email' }
  }
}

async function resendSend(
  apiKey: string,
  from: string,
  userId: string,
  mail: OutgoingMail,
): Promise<{ ok: true } | { ok: false; raw: string }> {
  // Reply-To the sender's real account so client responses reach THEM
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
  const themed = memberHtmlWithPixel(mail)
  return resendPost(apiKey, {
    from,
    to: [mail.to],
    ...(mail.cc?.length ? { cc: mail.cc } : {}),
    subject: mail.subject,
    text: mail.body,
    ...(themed ? { html: themed } : {}),
    ...(mail.attachments?.length ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content })) } : {}),
    ...(user?.email ? { reply_to: user.email } : {}),
  })
}

/**
 * Platform engine, zero-config:
 *   attempt 1 → branded from (noreply@hustleportal.online), works once the domain verifies;
 *   attempt 2 → Resend test sender, keeps own-inbox delivery working while DNS is pending.
 * No RESEND_FROM env var is ever required.
 */
async function sendViaPlatform(
  userId: string,
  mail: OutgoingMail,
): Promise<{ ok: true; provider: 'PLATFORM'; viaFallback?: boolean; from: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Email is not switched on yet. HustlePortal mail is warming up. Try again soon, or connect your Gmail under Integrations to send from your own address.',
    }
  }
  // USER mail goes out from the business's own identity on our domain. The
  // composer's "Sending from" pick (projectId) decides the identity when set —
  // label AND local part, one consistent sender. A per-send fromLocal pick
  // still wins over everything for the address; the operator RESEND_FROM env
  // is the last fallback. The domain never moves: only the part before the @
  // is theirs to edit, and that is the part Resend's verified domain signs for.
  const identity = await userSendingIdentity(userId, mail.projectId)
  const local = mail.fromLocal ? sanitizeFromLocal(mail.fromLocal) : null
  const branded = local
    ? `${identity.label} <${local}@${sendingDomain()}>`
    : process.env.RESEND_FROM?.trim() || identity.from
  // Member and team sends from our domain carry one quiet delivery line.
  const payload = { ...mail, body: mail.body + memberFooter() }
  const first = await resendSend(apiKey, branded, userId, payload)
  if (first.ok) {
    // Branded from accepted → the domain IS verified at Resend. Prime the status
    // cache so the UI flips to LIVE even if the domains API can't be read.
    const d = sendingDomain()
    domainCache = {
      at: Date.now(),
      rows: [{ name: d, status: 'verified' }, ...(domainCache?.rows || []).filter((r) => r.name !== d)],
    }
    await stampDomainProof()
    return { ok: true, provider: 'PLATFORM', from: branded }
  }
  // From-domain rejection (unverified) → retry once with the test sender
  if (/from|domain|verif|422|403/i.test(first.raw)) {
    const second = await resendSend(apiKey, SANDBOX_FROM, userId, payload)
    if (second.ok) return { ok: true, provider: 'PLATFORM', viaFallback: true, from: SANDBOX_FROM }
    return { ok: false, error: classifyPlatformError(second.raw, await readDomainProof()) }
  }
  return { ok: false, error: classifyPlatformError(first.raw, await readDomainProof()) }
}

/**
 * One-call send used by /api/emails.
 * Tries the user's own Gmail first (their voice), unless it just failed auth
 * (10-min circuit breaker). Falls back to the platform engine so the send still
 * happens, and says so honestly via `notice`. When BOTH fail, the error names
 * the two causes + their fixes.
 */
export async function sendMail(
  userId: string,
  mail: OutgoingMail,
): Promise<MailSendResult> {
  const attachments = sanitizeAttachments(mail.attachments)
  const payload = { ...mail, attachments } // no signature: the sender's voice stays theirs
  const creds = await getUserMailCreds(userId)
  // A chosen sender on our domain can ONLY come from the platform engine —
  // Gmail always sends as the connected account, no masquerading. When the
  // user picked their From in the composer (fromLocal, or a workspace profile),
  // the pick wins and Gmail waits.
  if (creds && !gmailOnCooldown(userId) && !mail.fromLocal && !mail.projectId) {
    const r = await sendViaUserGmail(creds, payload)
    if (r.ok) {
      clearGmailFailure(userId)
      return r
    }
    if (isGmailAuthError(r.error)) flagGmailFailure(userId)
    // their Gmail failed, fall through to platform so the send still happens
    const fb = await sendViaPlatform(userId, payload)
    if (fb.ok) {
      return {
        ok: true,
        provider: 'PLATFORM',
        from: fb.from,
        notice: fb.viaFallback
          ? 'Sent via HustlePortal\'s test sender. Your Gmail login was rejected and the sending domain is still verifying, so replies route to your account email. Both fixes are one tap: Integrations (Gmail) + resend.com/domains.'
          : 'Sent via the HustlePortal engine. Your Gmail login was rejected, so replies route to your account email. Fix it in about a minute under Integrations → Test Gmail connection.',
      }
    }
    return {
      ok: false,
      error: `${r.error}\n\nThe HustlePortal engine couldn't take over either: ${fb.error}`,
    }
  }
  const fb = await sendViaPlatform(userId, payload)
  if (fb.ok && creds && !mail.fromLocal && fb.viaFallback) {
    return { ...fb, notice: 'Sent via HustlePortal\'s test sender. Your Gmail login is cooling down and the sending domain is still verifying, so this reached only your own account inbox. Both fixes: Integrations (Gmail) + resend.com/domains.' }
  }
  if (fb.ok && creds && (mail.fromLocal || mail.projectId)) {
    // Honest footnote: their Gmail exists but was bypassed on purpose, because
    // the sender they picked can only leave from our verified domain.
    return { ...fb, notice: `Sent from ${fb.from || mail.fromLocal || mail.projectId} — the sender you picked. (Your connected Gmail always sends as its own address, so the engine took this one.)` }
  }
  return fb
}

/** The Business Hustle team inbox (service requests land here). Override with TEAM_INBOX_EMAIL env. */
export const TEAM_INBOX = process.env.TEAM_INBOX_EMAIL?.trim() || 'team@businesshustle.co.za'

/**
 * Internal team notification (e.g. service requests), platform delivery only,
 * NO referral signature, Reply-To the requesting user so the team can answer
 * straight from their inbox.
 */
export async function sendTeamMail(
  userId: string,
  mail: { subject: string; body: string },
): Promise<{ ok: true; provider: 'PLATFORM'; to: string } | { ok: false; error: string; to: string }> {
  const r = await sendViaPlatform(userId, { to: TEAM_INBOX, subject: mail.subject, body: mail.body })
  if (r.ok) return { ...r, to: TEAM_INBOX }
  return { ok: false, error: r.error, to: TEAM_INBOX }
}

// ------------------------------------------------------------- campaign mail

/**
 * Ecosystem campaigns: the owner introducing HustlePortal to the member lists
 * of their OWN other products (BlackBiz etc.). Platform engine only, the
 * campaign identity the owner picked, NO referral signature, Reply-To the team
 * inbox, legal footer attached. The From stays on hustleportal.online by
 * construction, the domain signs the send, anything else gets rejected or
 * lands in spam.
 */
export const CAMPAIGN_FROM_DEFAULT = 'BlackBiz <blackbiz@hustleportal.online>'

/** Accept "local@hustleportal.online" or 'Label <local@hustleportal.online>'; anything else falls back. */
export function normalizeCampaignFrom(raw?: string): string {
  const s = raw?.trim()
  if (!s) return CAMPAIGN_FROM_DEFAULT
  const m = s.match(/<\s*([\w.+-]+)@hustleportal\.online\s*>/i) || s.match(/^([\w.+-]+)@hustleportal\.online$/i)
  if (!m) return CAMPAIGN_FROM_DEFAULT
  const address = `${m[1].toLowerCase()}@hustleportal.online`
  const label = (s.match(/^"?([^"<]+?)"?\s*</)?.[1] || 'HustlePortal').trim().slice(0, 40)
  return `${label} <${address}>`
}

// Campaign HTML rendering (bare URL + phrase links, video poster, open pixel)
// lives in src/lib/campaignhtml.ts — pure and unit testable, shared by every
// lane that sends html. The branded chrome lives in src/lib/mailthemes.ts.

/** The look fields a campaign send can carry, on top of the letter itself. */
type ThemedCampaignFields = {
  /** Defaults to 'goldrush'. 'plain' restores the legacy unbranded look exactly. */
  theme?: MailThemeId
  /** The sender's own brand: their logo/initials/name replace the BH chrome.
   *  Absent = HustlePortal chrome exactly as it has always been. */
  brand?: MailBrand
  /** The standard-character law: blank-shirt badger + neutral HP chip on
   *  member-owned or branded sends. Absent = BH chrome, as always. */
  standardCharacter?: boolean
  /** Caps accent line under the hero, e.g. "GOOD TO HAVE YOU BACK". */
  headline?: string
  /** Bulletproof CTA button shown after the body. */
  ctaLabel?: string
  ctaUrl?: string
  /** Hidden inbox preview text. */
  preheader?: string
}

/**
 * One html decision for both campaign transports: themed chrome by default so
 * every platform campaign ships branded, the legacy plain look kept as an
 * explicit escape hatch with its exact old behavior (body+tail as blocks,
 * html only when a pixel is present).
 */
function campaignMailHtml(
  mail: ThemedCampaignFields & { body: string; pixelUrl?: string; unsubscribeUrl?: string },
  tail: string,
): string | undefined {
  if (mail.theme === 'plain') {
    return mail.pixelUrl ? campaignHtml(mail.body + tail, mail.pixelUrl) : undefined
  }
  return themedEmailHtml(mail.body, {
    theme: mail.theme ?? 'goldrush',
    brand: mail.brand,
    standardCharacter: mail.standardCharacter,
    headline: mail.headline,
    ctaLabel: mail.ctaLabel,
    ctaUrl: mail.ctaUrl,
    preheader: mail.preheader,
    unsubscribeUrl: mail.unsubscribeUrl,
    // Branded sends carry their own footer credit (inside themedEmailHtml),
    // so our legal block would only print the HustlePortal name twice.
    footerLines: mail.brand ? [] : legalFooterLines(),
    pixelUrl: mail.pixelUrl,
  })
}

export async function sendCampaignMail(
  mail: ThemedCampaignFields & {
    to: string; subject: string; body: string; from?: string; pixelUrl?: string; unsubscribeUrl?: string
    /** Where replies land. Defaults to the team inbox; member campaigns point
     *  it at the member's own account email so their clients answer THEM. */
    replyTo?: string
  },
): Promise<{ ok: boolean; via?: string; error?: string; providerId?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return { ok: false, error: 'Email engine is not configured.' }
  const from = normalizeCampaignFrom(mail.from)
  // Bulk sender law (Gmail, Yahoo, Microsoft): every campaign mail carries a
  // one click unsubscribe header plus a plain link a human can tap.
  const unsub = mail.unsubscribeUrl?.trim()
  const tail = campaignTail(unsub, mail.brand)
  // The text side flattens phrase links ("HustlePortal (https://...)") so no
  // raw markdown ever reaches a plain text reader; the html side renders them
  // as real anchors.
  const body = flattenMarkdownLinks(mail.body) + tail
  const html = campaignMailHtml(mail, tail)
  const res = await resendPost(apiKey, {
    from, to: [mail.to], subject: mail.subject, text: body,
    ...(html ? { html } : {}),
    ...(unsub ? { headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
    reply_to: mail.replyTo?.trim() || TEAM_INBOX,
  })
  if (res.ok) {
    const d = sendingDomain()
    domainCache = {
      at: Date.now(),
      rows: [{ name: d, status: 'verified' }, ...(domainCache?.rows || []).filter((r) => r.name !== d)],
    }
    await stampDomainProof()
    await stampLastSystemSend({ to: mail.to, subject: mail.subject.slice(0, 120), ok: true, via: `campaign:${from}` })
    return { ok: true, via: from, providerId: res.id }
  }
  console.error('[mail] campaign send failed:', res.raw.slice(0, 200))
  await stampLastSystemSend({ to: mail.to, subject: mail.subject.slice(0, 120), ok: false, error: res.raw.slice(0, 160) })
  return { ok: false, error: classifyPlatformError(res.raw, await readDomainProof()) }
}

// ---- SES lane ----
// The second transport for campaign queues. Same body, same open pixel, same
// one-click unsubscribe law, a bigger fuel tank for when the free lane's
// ~100/day ceiling is behind us. Picked per campaign via the queue state;
// nothing here changes how the free lane behaves.
//
// TRANSPORT: SES v2 HTTPS API, NOT SMTP. AWS does not offer an SMTP endpoint
// in Africa (Cape Town) af-south-1, email-smtp.af-south-1.amazonaws.com has
// no DNS record and Node dies on it with "getaddrinfo EBUSY". The API
// endpoint (email.af-south-1.amazonaws.com) is alive in the region and is
// signed with plain IAM keys via SigV4. Bounce/complaint events still flow
// through the same config set -> SNS -> /api/webhooks/ses pipe, and the API
// returns the MessageId directly, which is what the webhook matches.

/** True once the SES API keys exist in the environment. */
export function isSesConfigured(): boolean {
  return Boolean(
    process.env.SES_AWS_KEY?.trim() &&
    process.env.SES_AWS_SECRET?.trim(),
  )
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** SigV4 for a JSON POST, enough of AWS Signature v4 for one SES call, no SDK. */
function sesSigV4Headers(key: string, secret: string, region: string, host: string, path: string, body: string, amzDate: string): Record<string, string> {
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${region}/ses/aws4_request`
  const signedHeaders = 'content-type;host;x-amz-date'
  const canonicalRequest = [
    'POST',
    path,
    '',
    `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    sha256hex(body),
  ].join('\n')
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonicalRequest)}`
  let k = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest()
  k = createHmac('sha256', k).update(region).digest()
  k = createHmac('sha256', k).update('ses').digest()
  k = createHmac('sha256', k).update('aws4_request').digest()
  const signature = createHmac('sha256', k).update(stringToSign).digest('hex')
  return {
    'Content-Type': 'application/json',
    'X-Amz-Date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

export async function sendCampaignMailViaSes(
  mail: ThemedCampaignFields & {
    to: string; subject: string; body: string; from?: string; pixelUrl?: string; unsubscribeUrl?: string
    /** Where replies land. Defaults to the team inbox; member campaigns point
     *  it at the member's own account email so their clients answer THEM. */
    replyTo?: string
  },
): Promise<{ ok: boolean; via?: string; error?: string; providerId?: string }> {
  const key = process.env.SES_AWS_KEY?.trim()
  const secret = process.env.SES_AWS_SECRET?.trim()
  const region = process.env.SES_AWS_REGION?.trim() || 'af-south-1'
  if (!key || !secret) return { ok: false, error: 'SES lane is not configured.' }
  const from = normalizeCampaignFrom(mail.from)
  const unsub = mail.unsubscribeUrl?.trim()
  const tail = campaignTail(unsub, mail.brand)
  // The text side flattens phrase links ("HustlePortal (https://...)") so no
  // raw markdown ever reaches a plain text reader; the html side renders them
  // as real anchors.
  const body = flattenMarkdownLinks(mail.body) + tail
  const html = campaignMailHtml(mail, tail)
  const configSet = process.env.SES_CONFIG_SET?.trim()
  const payload = {
    FromEmailAddress: from,
    ReplyToAddresses: [mail.replyTo?.trim() || TEAM_INBOX],
    Destination: { ToAddresses: [mail.to] },
    ...(configSet ? { ConfigurationSetName: configSet } : {}),
    Content: {
      Simple: {
        Subject: { Data: mail.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: body, Charset: 'UTF-8' },
          ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
        },
        ...(unsub ? {
          Headers: [
            { Name: 'List-Unsubscribe', Value: `<${unsub}>` },
            { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
          ],
        } : {}),
      },
    },
  }
  const payloadStr = JSON.stringify(payload)
  const host = `email.${region}.amazonaws.com`
  const path = '/v2/email/outbound-emails'
  // One quiet retry for transient network/DNS hiccups; API errors (auth,
  // sandbox, unverified identity) are NOT retried, they answer honestly.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
      const res = await fetch(`https://${host}${path}`, {
        method: 'POST',
        headers: sesSigV4Headers(key, secret, region, host, path, payloadStr, amzDate),
        body: payloadStr,
      })
      const json = await res.json().catch(() => null) as { MessageId?: string; message?: string; Type?: string } | null
      if (!res.ok || !json?.MessageId) {
        const msg = json?.message || json?.Type || `SES API answered ${res.status}`
        console.error('[mail] SES campaign send refused:', msg.slice(0, 200))
        await stampLastSystemSend({ to: mail.to, subject: mail.subject.slice(0, 120), ok: false, error: msg.slice(0, 160) })
        return { ok: false, error: msg.slice(0, 300) }
      }
      await stampLastSystemSend({ to: mail.to, subject: mail.subject.slice(0, 120), ok: true, via: `campaign-ses:${from}` })
      return { ok: true, via: from, providerId: json.MessageId }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'SES send failed'
      if (attempt === 1) {
        console.error('[mail] SES network hiccup, one retry:', raw.slice(0, 160))
        await new Promise((r) => setTimeout(r, 600))
        continue
      }
      console.error('[mail] SES campaign send failed:', raw.slice(0, 200))
      await stampLastSystemSend({ to: mail.to, subject: mail.subject.slice(0, 120), ok: false, error: raw.slice(0, 160) })
      return { ok: false, error: raw.slice(0, 300) }
    }
  }
  return { ok: false, error: 'SES send failed' }
}

/**
 * System emails (password resets, receipts, alerts), platform engine only,
 * branded from, NO referral signature, Reply-To the team inbox.
 * Same zero-config ladder as user mail: branded from first, test sender while
 * the domain verifies.
 */
export async function sendSystemMail(
  mail: {
    to: string; subject: string; body: string
    /** Optional structured chrome (PostHog-style): caps eyebrow, big headline, */
    /** highlighted value box, CTA button, hidden preheader.                    */
    headline?: string
    title?: string
    value?: { text: string; caption?: string }
    ctaLabel?: string
    ctaUrl?: string
    preheader?: string
    /** Mascot from the library (mailthemes MASCOTS id) — the picture that */
    /** matches the news. Defaults to the badger waving.                   */
    mascot?: string
    /** Chrome override; system mail rides the full Gold Rush print by default. */
    theme?: MailThemeId
  },
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.error('[mail] system mail skipped, RESEND_API_KEY missing')
    return { ok: false, error: 'Email engine is not configured.' }
  }
  const from = process.env.RESEND_FROM?.trim() || BRANDED_FROM
  const body = mail.body + legalFooter()
  // System mail wears the FULL theme print: banner, badger hero, gold accents —
  // the same voice from welcome to forgot password (boss law: every system
  // email shows the character). No pixel (system sends carry no EmailLog row)
  // and no unsubscribe (a password reset is not bulk mail).
  const html = themedEmailHtml(mail.body, {
    theme: mail.theme ?? 'goldrush',
    footerLines: legalFooterLines(),
    headline: mail.headline,
    title: mail.title,
    value: mail.value,
    ctaLabel: mail.ctaLabel,
    ctaUrl: mail.ctaUrl,
    preheader: mail.preheader,
    mascot: mail.mascot,
  })
  const first = await resendPost(apiKey, { from, to: [mail.to], subject: mail.subject, text: body, html, reply_to: TEAM_INBOX })
  if (first.ok) {
    // Branded from accepted → domain verified; keep the status cache truthful.
    const d = sendingDomain()
    domainCache = {
      at: Date.now(),
      rows: [{ name: d, status: 'verified' }, ...(domainCache?.rows || []).filter((r) => r.name !== d)],
    }
    await stampDomainProof()
    await stampLastSystemSend({ to: mail.to, subject: mail.subject.slice(0, 120), ok: true, via: 'branded' })
    return { ok: true }
  }
  if (/from|domain|verif|422|403/i.test(first.raw)) {
    const second = await resendPost(apiKey, { from: SANDBOX_FROM, to: [mail.to], subject: mail.subject, text: body, html, reply_to: TEAM_INBOX })
    if (second.ok) {
      await stampLastSystemSend({ to: mail.to, subject: mail.subject.slice(0, 120), ok: true, via: 'sandbox-sender' })
      return { ok: true }
    }
    console.error('[mail] system mail failed (both senders):', second.raw.slice(0, 200))
    await stampLastSystemSend({ to: mail.to, subject: mail.subject.slice(0, 120), ok: false, error: second.raw.slice(0, 160) })
    return { ok: false, error: classifyPlatformError(second.raw, await readDomainProof()) }
  }
  console.error('[mail] system mail failed:', first.raw.slice(0, 200))
  await stampLastSystemSend({ to: mail.to, subject: mail.subject.slice(0, 120), ok: false, error: first.raw.slice(0, 160) })
  return { ok: false, error: classifyPlatformError(first.raw, await readDomainProof()) }
}
