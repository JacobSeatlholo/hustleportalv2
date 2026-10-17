/**
 * Campaign queue engine — batch sends paced like a human, not a cannon.
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
 *   { status: PAUSED | ACTIVE | DONE | CANCELLED, perHour, from, createdAt, startedAt }
 * Keeping state out of a new table keeps the deploy additive and the queue
 * auditable from the same config store the rest of the platform uses.
 */
import { db } from '@/lib/db'
import { setConfig } from '@/lib/config'
import { sendCampaignMail } from '@/lib/mailer'

export const APP_BASE = 'https://www.hustleportal.online'
export const CAMPAIGN_STATE_PREFIX = 'campaign_state:'

export interface CampaignState {
  status: 'PAUSED' | 'ACTIVE' | 'DONE' | 'CANCELLED'
  perHour: number
  from?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
}

export function campaignStateKey(tag: string): string {
  return `${CAMPAIGN_STATE_PREFIX}${tag}`
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
      // corrupt row — ignore, campaign shows as paused
    }
  }
  return out
}

export async function writeCampaignState(tag: string, state: CampaignState): Promise<void> {
  await setConfig(campaignStateKey(tag), JSON.stringify(state))
}

/** One tap unsubscribe link — signed so strangers cannot force it on others. */
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

/**
 * One turn of the engine. Send at most maxSends overall, and per campaign at
 * most perHour minus what that campaign already sent in the last 3600 s.
 * Safe to call from cron, from the UI, or from five places at once — the
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
    // Every active campaign ran dry — flip them to DONE.
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

    // Suppression is checked at send time — a bounce from an earlier turn of
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

    const r = await sendCampaignMail({
      to: queued.toEmail,
      subject: queued.subject,
      body: queued.body,
      from: state.from,
      pixelUrl: `${APP_BASE}/api/mail/open/${queued.id}`,
      unsubscribeUrl: unsubscribeUrl(queued.id),
    })
    if (r.ok) {
      await db.emailLog.update({
        where: { id: queued.id },
        data: { status: 'SENT', sentAt: new Date(), providerId: r.providerId ?? null, error: null },
      })
      per.sent++
      result.sent++
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
