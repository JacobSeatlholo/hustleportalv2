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
function memberFooter(): string {
  return '\n\nDelivered by HustlePortal (hustleportal.online)'
}

export type MailCreds = { user: string; appPassword: string }

export type MailSendResult =
  | { ok: true; provider: 'GMAIL' | 'PLATFORM'; notice?: string }
  | { ok: false; error: string }

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
function legalFooter(): string {
  const year = new Date().getFullYear()
  return [
    '',
    '',
    'HustlePortal · Simple Eternity Holdings (Pty) Ltd · businesshustle.co.za',
    'This email is confidential. If it reached you in error, notify team@businesshustle.co.za and delete it.',
    '',
    'Terms: https://businesshustle.co.za/terms',
    'Privacy & POPIA: https://businesshustle.co.za/privacy',
    'Cookie Policy: https://businesshustle.co.za/cookies',
    'PAIA Manual: https://app.businesshustle.co.za/wp-content/uploads/2025/12/BHW-PAIA-Manual-Integrated-with-POPIA.pdf',
    '',
    `© ${year} Simple Eternity Holdings (Pty) Ltd. All rights reserved.`,
  ].join('\n')
}

/**
 * Per-user sending identity, every business mails from ITS OWN address on our domain:
 * "Nkosi Brands" → nkosi-brands@hustleportal.online. The domain is verified, Resend
 * accepts any local part on it, and DKIM/SPF sign the send. Reply-To stays the user's
 * real account email, so replies land in THEIR inbox (set in resendSend).
 */
export async function userSendingIdentity(userId: string): Promise<{ from: string; address: string; label: string }> {
  try {
    const [user, project] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { name: true, businessName: true } }),
      db.project.findFirst({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { name: true },
      }),
    ])
    const label = (project?.name || user?.businessName || user?.name || 'HustlePortal').trim().slice(0, 40)
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
  mail: { to: string; subject: string; body: string; attachments?: MailAttachment[] },
): Promise<{ ok: true; provider: 'GMAIL' } | { ok: false; error: string }> {
  try {
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: creds.user, pass: creds.appPassword },
    })
    await transport.sendMail({
      from: `"HustlePortal" <${creds.user}>`,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
      ...(mail.attachments?.length
        ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, 'base64') })) }
        : {}),
    })
    return { ok: true, provider: 'GMAIL' }
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
  mail: { to: string; subject: string; body: string; attachments?: MailAttachment[] },
): Promise<{ ok: true } | { ok: false; raw: string }> {
  // Reply-To the sender's real account so client responses reach THEM
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
  return resendPost(apiKey, {
    from,
    to: [mail.to],
    subject: mail.subject,
    text: mail.body,
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
  mail: { to: string; subject: string; body: string; attachments?: MailAttachment[] },
): Promise<{ ok: true; provider: 'PLATFORM'; viaFallback?: boolean } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Email is not switched on yet. HustlePortal mail is warming up. Try again soon, or connect your Gmail under Integrations to send from your own address.',
    }
  }
  // USER mail goes out from the business's own identity on our domain; the
  // RESEND_FROM env (operator override) still wins when explicitly set.
  const branded = process.env.RESEND_FROM?.trim() || (await userSendingIdentity(userId)).from
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
    return { ok: true, provider: 'PLATFORM' }
  }
  // From-domain rejection (unverified) → retry once with the test sender
  if (/from|domain|verif|422|403/i.test(first.raw)) {
    const second = await resendSend(apiKey, SANDBOX_FROM, userId, payload)
    if (second.ok) return { ok: true, provider: 'PLATFORM', viaFallback: true }
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
  mail: { to: string; subject: string; body: string; attachments?: MailAttachment[] },
): Promise<MailSendResult> {
  const attachments = sanitizeAttachments(mail.attachments)
  const payload = { ...mail, attachments } // no signature: the sender's voice stays theirs
  const creds = await getUserMailCreds(userId)
  if (creds && !gmailOnCooldown(userId)) {
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
  if (fb.ok && creds && fb.viaFallback) {
    return { ...fb, notice: 'Sent via HustlePortal\'s test sender. Your Gmail login is cooling down and the sending domain is still verifying, so this reached only your own account inbox. Both fixes: Integrations (Gmail) + resend.com/domains.' }
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

/**
 * Campaign HTML: the plain text body rendered as clean readable mail (short
 * lines, clickable links, no images that can break) plus the invisible 1x1
 * open tracker. The marker line "See it in motion: <url>" renders as a big
 * clickable video thumbnail instead of a text line, email clients refuse
 * inline <video>, so the poster opens the clip in the browser. Reading clients
 * that load images fire the pixel; plain-text only readers do not, so open
 * counts are a floor, never a ceiling.
 */
const CAMPAIGN_VIDEO_POSTER = 'https://www.hustleportal.online/campaign/blackbiz-intro-video.jpg'

function campaignHtml(text: string, pixelUrl: string): string {
  const blocks: string[] = []
  for (const line of text.split('\n')) {
    const video = line.match(/^See it in motion: (https:\/\/\S+)$/)
    if (video) {
      blocks.push(
        `<a href="${video[1]}" target="_blank" style="text-decoration:none">` +
        `<img src="${CAMPAIGN_VIDEO_POSTER}" width="640" alt="Watch: HustlePortal in motion. Tap to play." ` +
        `style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:10px;margin:18px 0" /></a>`,
      )
      continue
    }
    const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    blocks.push(esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0b57d0">$1</a>'))
  }
  const brd = blocks.join('<br>\n')
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:640px;margin:0 auto;background:#ffffff;padding:28px;border:1px solid #e3e5e8">${brd}<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" /></div></body></html>`
}

export async function sendCampaignMail(
  mail: { to: string; subject: string; body: string; from?: string; pixelUrl?: string; unsubscribeUrl?: string },
): Promise<{ ok: boolean; via?: string; error?: string; providerId?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return { ok: false, error: 'Email engine is not configured.' }
  const from = normalizeCampaignFrom(mail.from)
  // Bulk sender law (Gmail, Yahoo, Microsoft): every campaign mail carries a
  // one click unsubscribe header plus a plain link a human can tap.
  const unsub = mail.unsubscribeUrl?.trim()
  const body = mail.body + (unsub ? `\n\nPrefer not to hear from us again? One tap and you are out: ${unsub}` : '') + legalFooter()
  const html = mail.pixelUrl ? campaignHtml(body, mail.pixelUrl) : undefined
  const res = await resendPost(apiKey, {
    from, to: [mail.to], subject: mail.subject, text: body,
    ...(html ? { html } : {}),
    ...(unsub ? { headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
    reply_to: TEAM_INBOX,
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
  mail: { to: string; subject: string; body: string; from?: string; pixelUrl?: string; unsubscribeUrl?: string },
): Promise<{ ok: boolean; via?: string; error?: string; providerId?: string }> {
  const key = process.env.SES_AWS_KEY?.trim()
  const secret = process.env.SES_AWS_SECRET?.trim()
  const region = process.env.SES_AWS_REGION?.trim() || 'af-south-1'
  if (!key || !secret) return { ok: false, error: 'SES lane is not configured.' }
  const from = normalizeCampaignFrom(mail.from)
  const unsub = mail.unsubscribeUrl?.trim()
  const body = mail.body + (unsub ? `\n\nPrefer not to hear from us again? One tap and you are out: ${unsub}` : '') + legalFooter()
  const html = mail.pixelUrl ? campaignHtml(body, mail.pixelUrl) : undefined
  const configSet = process.env.SES_CONFIG_SET?.trim()
  const payload = {
    FromEmailAddress: from,
    ReplyToAddresses: [TEAM_INBOX],
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
  mail: { to: string; subject: string; body: string },
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.error('[mail] system mail skipped, RESEND_API_KEY missing')
    return { ok: false, error: 'Email engine is not configured.' }
  }
  const from = process.env.RESEND_FROM?.trim() || BRANDED_FROM
  const body = mail.body + legalFooter()
  const first = await resendPost(apiKey, { from, to: [mail.to], subject: mail.subject, text: body, reply_to: TEAM_INBOX })
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
    const second = await resendPost(apiKey, { from: SANDBOX_FROM, to: [mail.to], subject: mail.subject, text: body, reply_to: TEAM_INBOX })
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
