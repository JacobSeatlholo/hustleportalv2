import { db } from '@/lib/db'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import { sendSystemMail } from '@/lib/mailer'
import { isExecEmail } from '@/lib/admin'
import { isProbeEmail, isInternalEmail } from '@/lib/probe'
import { formatRands } from '@/lib/wallet'
import { clientCampaignBrief, runClientCampaign } from '@/lib/campaign'

/**
 * The owner's email side of the credit story.
 *
 * When a client loads credit, the owner gets one email with everything needed
 * to act: who paid, how much, their wallet state, and the campaign brief for
 * that client. If the top-up clears the campaign threshold, the campaign runs
 * right away and a second short email reports where the fresh leads landed.
 * Every send is best effort: a mail hiccup must never touch the payment flow.
 */

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://www.hustleportal.online'

function execInbox(): string | null {
  const first = EXEC_INBOX_FALLBACK
  return first || null
}

const EXEC_INBOX_FALLBACK = 'ceo@businesshustle.co.za'

function execLink(userId: string): string {
  return `${APP_ORIGIN}/?view=admin&client=${userId}`
}

function lines(parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join('\n')
}

/**
 * The single hook point after a top-up turns PAID (Yoco webhook or sandbox).
 * Called through after(), so it never delays the payment response.
 */
export async function onPaidTopUp(topUpId: string): Promise<void> {
  try {
    const topUp = await db.topUp.findUnique({ where: { id: topUpId } })
    if (!topUp || topUp.status !== 'PAID') return
    const user = await db.user.findUnique({
      where: { id: topUp.userId },
      select: { id: true, name: true, businessName: true, email: true },
    })
    if (!user) return
    // The owner's own top-ups are not news to the owner.
    if (isExecEmail(user.email)) return

    const wallet = await db.wallet.findUnique({ where: { userId: user.id }, select: { balance: true } })
    const brief = await clientCampaignBrief(user.id)
    const thresholdRaw = Number((await getConfig(CONFIG_KEYS.CAMPAIGN_AUTO_CENTS)) || '50000')
    const autoRun = topUp.amountCents >= (Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 50000)

    await notifyExecTopUp({ user, topUp, walletBalance: wallet?.balance ?? 0, brief: brief ?? null, campaignStarted: autoRun })

    if (autoRun) {
      const result = await runClientCampaign(user.id, { auto: true })
      if (result) {
        await notifyExecCampaignResult({
          sellerName: user.name,
          execHref: execLink(user.id),
          mode: result.mode,
          added: result.added,
          served: result.served,
          skipped: result.skipped,
          balance: result.balance,
          note: result.note,
        })
      }
    }
  } catch (e) {
    console.error('[execnotify] paid top-up flow failed (payment itself is safe):', e)
  }
}

async function notifyExecTopUp(info: {
  user: { id: string; name: string; businessName: string | null; email: string }
  topUp: { amountCents: number; creditCents: number; reference: string; provider: string; packageId: string }
  walletBalance: number
  brief: { industry: string | null; city: string | null; offerings: string | null; targetMarket: string | null; definition: string } | null
  campaignStarted: boolean
}): Promise<void> {
  const to = execInbox()
  if (!to) return
  const name = info.user.name
  const subject = `Credit loaded: ${name} just added ${formatRands(info.topUp.amountCents)} to their wallet`

  const body = lines([
    `A client just put money in. Their next campaign is already taken care of.`,
    ``,
    `Client: ${name}${info.user.businessName ? ` (${info.user.businessName})` : ''}`,
    `Email: ${info.user.email}`,
    `Paid: ${formatRands(info.topUp.amountCents)} via ${info.topUp.provider === 'YOCO' ? 'Yoco' : info.topUp.provider}`,
    `Wallet credit added: ${formatRands(info.topUp.creditCents)}`,
    `Wallet balance now: ${formatRands(info.walletBalance)}`,
    `Reference: ${info.topUp.reference}`,
    ``,
    info.brief ? `Their campaign brief` : `Their campaign brief comes the moment they fill in their business profile.`,
    ...(info.brief
      ? [
          `They sell: ${info.brief.offerings || info.brief.industry || 'their core offer'}`,
          `Where: ${info.brief.city || 'South Africa wide'}`,
          `Who they want as customers: ${info.brief.targetMarket || 'ready to buy locals'}`,
        ]
      : []),
    ``,
    info.campaignStarted
      ? `A lead campaign just started for them. Fresh leads land in their lead pool on your Exec Dashboard. Review them and add the best ones to their pipeline in one tap.`
      : `This top-up sits under your campaign threshold, so no campaign fired. You can run one any time from their card on the Exec Dashboard.`,
    ``,
    `Open their desk: ${execLink(info.user.id)}`,
  ])

  try {
    const r = await sendSystemMail({ to, subject, body })
    if (!r.ok) console.error('[execnotify] top-up email failed:', r.error)
  } catch (e) {
    console.error('[execnotify] top-up email threw:', e)
  }
}

async function notifyExecCampaignResult(info: {
  sellerName: string
  execHref: string
  mode: 'EXPLEE' | 'POOL' | 'SKIPPED'
  added: number
  served: number
  skipped: number
  balance?: number
  note?: string
}): Promise<void> {
  const to = execInbox()
  if (!to) return

  if (info.mode === 'SKIPPED') {
    // Quiet skip: a campaign ran minutes ago. Not worth a second email.
    return
  }

  const engineLine =
    info.mode === 'EXPLEE'
      ? `Explee live search found ${info.served} candidate${info.served === 1 ? '' : 's'}`
      : `The verified HustlePortal pool served ${info.served} fresh face${info.served === 1 ? '' : 's'} (Explee key missing or quiet${info.note ? `: ${info.note}` : ''})`

  const subject =
    info.added > 0
      ? `Fresh leads ready: ${info.added} waiting in ${info.sellerName}'s pool`
      : `Campaign done: ${info.sellerName} (no new faces this round)`

  const body = lines([
    `The campaign for ${info.sellerName} just finished.`,
    ``,
    engineLine + '.',
    info.added > 0
      ? `${info.added} new lead${info.added === 1 ? '' : 's'} landed on their bench. ${info.skipped} duplicate${info.skipped === 1 ? '' : 's'} skipped.`
      : `Nothing new landed: every face this round was already in their pipeline or on their bench.`,
    ...(info.balance !== undefined ? [`Explee credit balance left: ${info.balance}`] : []),
    ``,
    info.added > 0
      ? `Review the pool and add the winners to their pipeline in one tap.`
      : `Run it again any time from their card, or widen the search words for a bigger net.`,
    ``,
    `Open their desk: ${info.execHref}`,
  ])

  try {
    const r = await sendSystemMail({ to, subject, body })
    if (!r.ok) console.error('[execnotify] campaign email failed:', r.error)
  } catch (e) {
    console.error('[execnotify] campaign email threw:', e)
  }
}

/**
 * The till bell: a real human just started a subscription checkout. The owner
 * hears within seconds, because a checkout that goes cold in the next hour is
 * the most expensive silence on the platform. One email per checkout attempt;
 * probes, house accounts and the owner's own tests never ring the bell.
 */
export async function onCheckoutStarted(subscriptionId: string): Promise<void> {
  try {
    const sub = await db.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: { select: { id: true, name: true, businessName: true, email: true } } },
    })
    if (!sub || sub.status !== 'PENDING') return
    const u = sub.user
    if (!u || isExecEmail(u.email) || isProbeEmail(u.email) || isInternalEmail(u.email)) return

    const planName = sub.plan === 'BOSS' ? 'Boss' : 'Operator'
    const to = execInbox()
    if (!to) return
    const subject = `Someone is at the till: ${u.name} started ${planName} checkout`
    const body = lines([
      `${u.name}${u.businessName ? ` (${u.businessName})` : ''} just opened a ${planName} checkout.`,
      ``,
      `Plan: ${planName} · R${(sub.amountCents / 100).toFixed(0)} · ${sub.billingCycle === 'ANNUAL' ? 'annual' : 'monthly'}${sub.npoNumber ? ` · NPO ${sub.npoNumber}` : ''}`,
      `Reference: ${sub.reference}`,
      ``,
      `The clock is the leak: most checkouts that never finish go cold within the hour.`,
      `If the payment lands, Yoco confirms it on its own. If it does not land soon, one human message now is worth a week of ads.`,
      ``,
      `Open their desk: ${execLink(u.id)}`,
    ])
    const r = await sendSystemMail({ to, subject, body })
    if (!r.ok) console.error('[execnotify] checkout bell failed:', r.error)
  } catch (e) {
    console.error('[execnotify] checkout bell threw:', e)
  }
}
