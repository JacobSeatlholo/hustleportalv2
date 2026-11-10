/**
 * Campaign queue engine, batch sends paced like a human, not a cannon.
 *
 * Law of the engine:
 *   1. NOTHING sends until the operator presses Start. Queues are born PAUSED.
 *   2. Pacing is counted from the database (sends in the last hour), so any
 *      number of tickers can run at once without doubling the pace.
 *   3. The suppression list is checked before EVERY send. Bounced, complained
 *      or unsubscribed addresses are never touched again.
 *   4. A campaign that runs dry flips itself to DONE.
 *
 * Campaign state lives in platformConfig under `campaign_state:<tag>`:
 *   { status: PAUSED | ACTIVE | DONE | CANCELLED, perHour, from, provider, createdAt, startedAt }
 * `provider` picks the transport lane: RESEND (the free lane, default) or SES
 * (the high-volume lane). Pacing and suppression laws are identical on both.
 * Keeping state out of a new table keeps the deploy additive and the queue
 * auditable from the same config store the rest of the platform uses.
 */
import { db } from '@/lib/db'
import { setConfig } from '@/lib/config'
import { sendCampaignMail, sendCampaignMailViaSes } from '@/lib/mailer'
import type { MailBrand } from '@/lib/mailthemes'
import { planState, FREE_LIMITS } from '@/lib/limits'
import { SPEND_ACTIONS, PLAN_SEND_BUNDLES, DEFAULT_SEND_BUNDLE, SEND_BUNDLE_WINDOW_DAYS } from '@/lib/spend'
import { spendCredits, addCredits } from '@/lib/wallet'

export const APP_BASE = 'https://www.hustleportal.online'
export const CAMPAIGN_STATE_PREFIX = 'campaign_state:'

export interface CampaignState {
  status: 'PAUSED' | 'ACTIVE' | 'DONE' | 'CANCELLED'
  perHour: number
  from?: string
  provider?: 'RESEND' | 'SES'
  /** The mail look the sends ride in (boardroom | goldrush | nightshift | plain).
   *  Undefined = the engine default (goldrush branded). Editable per campaign. */
  theme?: string
  /** The sender's own brand (logo/initials/name) when the queue rides their
   *  chrome instead of the BH one. Absent = HustlePortal chrome, as always. */
  brand?: MailBrand
  /** Member campaigns only: the account that owns the queue. Exec blasts
   *  carry none. Ownership is checked on every control action, so one member
   *  can never start, stop or read another member's campaign. */
  ownerUserId?: string
  /** Where replies land. Member campaigns → the member's account email;
   *  exec blasts → the team inbox (the senders' default). */
  replyTo?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
}

export function campaignStateKey(tag: string): string {
  return `${CAMPAIGN_STATE_PREFIX}${tag}`
}

// The provider's burst law is 10 requests per second; a tick that fires sends
// back to back blows straight through it and drops live mail as FAILED. Every
// send is therefore followed by a short breath, and a 429 gets one patient
// retry after a longer pause before the row is marked failed. Cheap, honest,
// and it keeps the pace under the ceiling no matter how many rows a tick
// grabbed.
const SEND_GAP_MS = 150
const RATE_RETRY_MS = 1_600
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function readCampaignStates(): Promise<Record<string, CampaignState>> {
  const rows = await db.platformConfig.findMany({
    where: { key: { startsWith: CAMPAIGN_STATE_PREFIX } },
    select: { key: true, value: true },
  })
  const out: Record<string, CampaignState> = {}
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value) as CampaignState
      out[row.key.slice(CAMPAIGN_STATE_PREFIX.length)] = parsed
    } catch {
      // corrupt row, ignore, campaign shows as paused
    }
  }
  return out
}

export async function writeCampaignState(tag: string, state: CampaignState): Promise<void> {
  await setConfig(campaignStateKey(tag), JSON.stringify(state))
}

/** One tap unsubscribe link, signed so strangers cannot force it on others. */
export function unsubscribeSig(logId: string): string {
  const salt = process.env.CRON_SECRET?.trim() || process.env.RESEND_API_KEY?.trim() || 'hustle-unsub-v1'
  let h = 0
  const s = `${logId}:${salt}`
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36) + s.length.toString(36)
}

export function unsubscribeUrl(logId: string): string {
  return `${APP_BASE}/api/unsubscribe?c=${logId}&s=${unsubscribeSig(logId)}`
}

export async function verifyUnsubscribe(logId: string, sig: string): Promise<boolean> {
  return sig === unsubscribeSig(logId)
}

export interface TickResult {
  sent: number
  failed: number
  skipped: number
  perCampaign: Record<string, { sent: number; failed: number; skipped: number }>
}

// ---- Opportunistic heartbeat ----
// The Vercel Cron slots on this plan are two daily jobs and both are taken,
// so the queue drinks from the platform's own traffic instead: hot routes
// (health probes, member sessions, campaign open pixels) nudge the engine as
// they flow. A per instance cooldown keeps the nudge cheap, the empty state
// costs one small read, and the database pacing law stays the only clock that
// matters, so extra nudges can never push a queue past its perHour ceiling.
// Wrapped head to toe in try catch: a heartbeat can never break the route
// that carried it.
let lastOpportunisticTick = 0

export async function opportunisticTick(maxSends = 2, minGapMs = 90_000): Promise<void> {
  try {
    const now = Date.now()
    if (now - lastOpportunisticTick < minGapMs) return
    lastOpportunisticTick = now
    const states = await readCampaignStates()
    if (!Object.values(states).some((s) => s.status === 'ACTIVE')) return
    await tickCampaigns(maxSends)
  } catch {
    // the heartbeat stays silent on purpose
  }
}

/**
 * One turn of the engine. Send at most maxSends overall, and per campaign at
 * most perHour minus what that campaign already sent in the last 3600 s.
 * Safe to call from cron, from the UI, or from five places at once, the
 * database is the only clock that matters.
 */
export async function tickCampaigns(maxSends = 30): Promise<TickResult> {
  const result: TickResult = { sent: 0, failed: 0, skipped: 0, perCampaign: {} }
  if (maxSends <= 0) return result

  const states = await readCampaignStates()
  const activeTags = Object.entries(states)
    .filter(([, s]) => s.status === 'ACTIVE')
    .map(([tag]) => tag)
  if (activeTags.length === 0) return result

  // Queued rows for the active campaigns, oldest first (fairness across the day).
  const queuedRows = await db.emailLog.findMany({
    where: { campaign: { in: activeTags }, status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: { id: true, campaign: true },
  })
  if (queuedRows.length === 0) {
    // Every active campaign ran dry, flip them to DONE.
    for (const tag of activeTags) {
      const remaining = await db.emailLog.count({ where: { campaign: tag, status: 'QUEUED' } })
      if (remaining === 0 && states[tag]) {
        await writeCampaignState(tag, { ...states[tag], status: 'DONE', completedAt: new Date().toISOString() })
      }
    }
    return result
  }

  const hourAgo = new Date(Date.now() - 3_600_000)
  for (const row of queuedRows) {
    if (result.sent + result.failed + result.skipped >= maxSends) break
    const tag = row.campaign as string
    const state = states[tag]
    if (!state || state.status !== 'ACTIVE') continue
    const per = (result.perCampaign[tag] ||= { sent: 0, failed: 0, skipped: 0 })

    // Pacing ceiling for this hour, straight from the log.
    const sentLastHour = await db.emailLog.count({
      where: { campaign: tag, provider: 'PLATFORM', sentAt: { gte: hourAgo }, status: { in: ['SENT', 'BOUNCED'] } },
    })
    const allowedThisHour = state.perHour - sentLastHour
    if (allowedThisHour <= 0) continue

    // Suppression is checked at send time, a bounce from an earlier turn of
    // this very campaign still stops the next send to that address.
    const queued = await db.emailLog.findUnique({
      where: { id: row.id },
      select: { id: true, toEmail: true, subject: true, body: true, status: true },
    })
    if (!queued || queued.status !== 'QUEUED') continue // another ticker got it first

    const suppressed = await db.suppression.findUnique({ where: { email: queued.toEmail }, select: { reason: true } })
    if (suppressed) {
      await db.emailLog.update({
        where: { id: queued.id },
        data: { status: 'SKIPPED', error: `Suppressed: ${suppressed.reason}`, sentAt: new Date() },
      })
      per.skipped++
      result.skipped++
      continue
    }

    const mail = {
      to: queued.toEmail,
      subject: queued.subject,
      body: queued.body,
      from: state.from,
      // The campaign's chosen look rides the state, so Edit draft can re-skin
      // a queue without touching a single row. Undefined = engine default.
      theme: (state.theme || undefined) as Parameters<typeof sendCampaignMail>[0]['theme'],
      // Same law for the sender's brand: rides the state, applies to every
      // still-queued email at send time. Undefined = the BH chrome.
      brand: state.brand,
      pixelUrl: `${APP_BASE}/api/mail/open/${queued.id}`,
      unsubscribeUrl: unsubscribeUrl(queued.id),
      // Member campaigns route replies to the member's own inbox; exec blasts
      // keep the team inbox default inside the senders.
      replyTo: state.replyTo || undefined,
    }
    // The campaign's lane decides the pipe. Same mail, same laws, either way.
    // One rate-limit retry: the provider counts requests per second, so a
    // pause and a second try turns a burst drop into a delivered email.
    let r = state.provider === 'SES'
      ? await sendCampaignMailViaSes(mail)
      : await sendCampaignMail(mail)
    if (!r.ok && (r.error || '').includes('429')) {
      await sleep(RATE_RETRY_MS)
      r = state.provider === 'SES'
        ? await sendCampaignMailViaSes(mail)
        : await sendCampaignMail(mail)
    }
    await sleep(SEND_GAP_MS)
    if (r.ok) {
      await db.emailLog.update({
        where: { id: queued.id },
        data: { status: 'SENT', sentAt: new Date(), providerId: r.providerId ?? null, error: null },
      })
      per.sent++
      result.sent++
      // Member campaigns ride the SAME airtime law as every other send: sends
      // inside the plan's bundle are free, sends beyond it spend airtime, and
      // the debit lands only AFTER the email actually went out. A drained
      // wallet never blocks a sent email — the books carry the shortfall and
      // the wallet waits for a top-up (the emails route keeps the same books).
      if (state.ownerUserId) {
        try {
          const owner = await planState(state.ownerUserId)
          const bundle = owner.paid ? (PLAN_SEND_BUNDLES[owner.plan] ?? DEFAULT_SEND_BUNDLE) : FREE_LIMITS.emailSends
          const windowStart = owner.paid ? new Date(Date.now() - SEND_BUNDLE_WINDOW_DAYS * 24 * 60 * 60 * 1000) : null
          const used = await db.emailLog.count({
            where: { userId: state.ownerUserId, status: 'SENT', ...(windowStart ? { createdAt: { gte: windowStart } } : {}) },
          })
          if (used > bundle) {
            const priceCents = SPEND_ACTIONS.EMAIL_SEND.cents
            const spent = await spendCredits(state.ownerUserId, priceCents, `Airtime: campaign email to ${queued.toEmail}`, 'FEATURE_SPEND')
            if (!spent) {
              await addCredits(state.ownerUserId, -priceCents, 'ADJUSTMENT', `Airtime shortfall: campaign email to ${queued.toEmail} already sent — load to clear it`)
            }
          }
        } catch (e) {
          // Billing must never break a delivered send.
          console.error('[campaign-queue] member airtime debit failed:', e instanceof Error ? e.message : e)
        }
      }
    } else {
      await db.emailLog.update({
        where: { id: queued.id },
        data: { status: 'FAILED', error: (r.error || 'send failed').slice(0, 500), sentAt: new Date() },
      })
      per.failed++
      result.failed++
    }
  }

  // Campaigns with nothing left queued are DONE.
  for (const tag of activeTags) {
    const remaining = await db.emailLog.count({ where: { campaign: tag, status: 'QUEUED' } })
    if (remaining === 0 && states[tag]) {
      await writeCampaignState(tag, { ...states[tag], status: 'DONE', completedAt: new Date().toISOString() })
    }
  }
  return result
}
