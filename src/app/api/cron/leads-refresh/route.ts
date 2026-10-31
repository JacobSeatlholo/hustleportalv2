import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pingWebsite, hostOf, scoreFor, parseChecksSource, ingestVerifiedContacts, cityFromText, type RememberLead } from '@/lib/leadpool'
import { expleeHotLeads, projectLabelForCampaign } from '@/lib/explee'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import { globalCooldown } from '@/lib/ratelimit'
import { sweepPendingWelcome } from '@/lib/welcomesweep'

export const maxDuration = 60

/**
 * Daily lead pool refresh, Vercel Cron hits this once a day (off peak).
 *
 * The freshness contract of the Verified Lead Pool lives here:
 *  1. DEMOTE: any business unseen on a scan for 60 days is marked stale and
 *     never surfaces in a fresh pool serve again. Dead listings do not come back.
 *  2. RE-CHECK: the stalest website bearing records get their site pinged
 *     again. A live site upgrades the record to "active"; a dead one drops the
 *     website badge honestly. No AI quota is spent, plain HTTP checks only.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return true // no secret configured, cooldown below keeps abuse bounded
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Same cooldown law as daily-reminders: the scheduled pinger passes, a
  // hammering stranger gets honest "already ran" answers instead of repeated
  // external API walks (Explee pulls + website pings cost real credits).
  const cooldown = globalCooldown('cron:leads-refresh', 30 * 60 * 1000)
  if (!cooldown.ran) {
    return NextResponse.json({ ok: true, skipped: 'cooldown', retryAfterSec: cooldown.retryAfterSec })
  }
  const t0 = Date.now()

  // 1) Demote the long unseen: 60 days without a scan re confirming it.
  const staleCut = new Date(Date.now() - 60 * 86_400_000)
  const demoted = await db.leadPool.updateMany({
    where: { active: true, verifyState: { not: 'stale' }, lastSeenAt: { lt: staleCut } },
    data: { verifyState: 'stale' },
  })

  // 2) Re-check the stalest website bearing records (skip anything verified in
  //    the last 2 days so the batch always works on the oldest first).
  const freshCut = new Date(Date.now() - 2 * 86_400_000)
  const batch = await db.leadPool.findMany({
    where: {
      active: true,
      verifyState: { not: 'stale' },
      website: { not: null },
      OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: freshCut } }],
    },
    orderBy: [{ lastVerifiedAt: { sort: 'asc', nulls: 'first' } }, { lastSeenAt: 'desc' }],
    take: 60,
  })

  let live = 0
  let dead = 0
  for (let i = 0; i < batch.length; i += 8) {
    await Promise.all(
      batch.slice(i, i + 8).map(async (r) => {
        const host = hostOf(r.website || '')
        if (!host) return
        const ok = await pingWebsite(host)
        const prev = parseChecksSource(r.verifyChecks)
        // A website ping says nothing about the mailbox: carry the email
        // verdicts forward untouched. Rebuilding this object from scratch is
        // what silently demoted verified / catch-all rows back to pending
        // (seen 2026-10-31: two catch-all rows lost their verdict here).
        const checks = { ...prev, phoneOk: prev.phoneOk, websiteOk: ok, checkedAt: new Date().toISOString() }
        const score = scoreFor(checks, r.confirmCount, true)
        await db.leadPool.update({
          where: { id: r.id },
          data: {
            verifyChecks: JSON.stringify(checks),
            lastVerifiedAt: new Date(),
            verifyScore: score,
            verifyState: ok ? 'active' : r.verifyState === 'active' ? 'listed' : r.verifyState,
          },
        })
        if (ok) live++
        else dead++
      })
    )
  }

  // 3) PRUNE: scan logs older than 45 days leave. The cooldown, the daily
  //    allowance and the warm window all live within a single day, so old rows
  //    are pure ballast, without this the table grows one row per scan,
  //    forever, on a platform whose promise is scans every day at scale.
  const pruned = await db.scanRun.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 45 * 86_400_000) } },
  })

  // 4) FEED: the pool drinks from the team's own outreach. Every day the
  //    newest Explee hot leads (real people at real companies who REPLIED to
  //    a Business Hustle campaign) land in the shared Verified Lead Pool, so
  //    every member scans into a floor of credible, verifiable businesses,
  //    even on a topic no scan has ever warmed. Free read, bounded (one page,
  //    ten website pings), idempotent (the merge law dedupes repeats). A
  //    failure here never breaks the freshness work above.
  let feed: { pulled: number; created: number; merged: number; skipped: number } | { error: string } | null = null
  try {
    if (Date.now() - t0 < 30_000) {
      const apiKey = (await getConfig(CONFIG_KEYS.EXPLEE_API_KEY)).trim()
      if (apiKey.length > 5) {
        const hot = await expleeHotLeads({ limit: 200, pages: 1 })
        if (hot.mode === 'LIVE' && hot.leads.length > 0) {
          const contacts: RememberLead[] = []
          for (const h of hot.leads) {
            const company = h.companyName?.trim()
            if (!company) continue // a person without a company is not a pool row
            const reply = h.whyHot?.trim().slice(0, 160)
            const campaignLine = h.campaignName ? `our ${h.campaignName} campaign` : 'our outreach'
            const tag = projectLabelForCampaign(h.campaignName)
            // A reply to a city campaign puts the contact in that city's
            // orbit, the honest fill for a pool row with no city on file.
            const cityGuess = cityFromText(h.campaignName)
            contacts.push({
              company,
              ...(h.name?.trim() ? { contactName: h.name.trim() } : {}),
              ...(h.jobTitle?.trim() ? { role: h.jobTitle.trim().slice(0, 60) } : {}),
              ...(h.email?.trim() ? { email: h.email.trim() } : {}),
              ...(h.phone?.trim() ? { phone: h.phone.trim() } : {}),
              ...(h.companyDomain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h.companyDomain) ? { website: `https://${h.companyDomain}` } : {}),
              ...(h.linkedinUrl && /^https?:\/\//i.test(h.linkedinUrl) ? { profileUrl: h.linkedinUrl } : {}),
              why: reply ? `Warm reply to ${campaignLine}: ${reply}` : `Warm reply to ${campaignLine}`,
              ...(tag ? { poolTag: tag } : {}),
              ...(cityGuess ? { city: cityGuess } : {}),
            })
          }
          const summary = await ingestVerifiedContacts({ area: 'South Africa', contacts, maxPings: 10 })
          feed = { pulled: summary.total, created: summary.created, merged: summary.merged, skipped: summary.skipped }
        } else {
          feed = { pulled: 0, created: 0, merged: 0, skipped: 0 }
        }
      }
    }
  } catch (e) {
    feed = { error: e instanceof Error ? e.message.slice(0, 160) : 'feed failed' }
  }

  // 5) WHITELABEL SWEEP: a member's pipeline carries neutral labels only.
  //    Historic rows still wearing the internal outreach tag get the neutral
  //    face (TEAM), and any note that ever named the internal tool or quoted
  //    a campaign reply is rewritten in the platform's own words, the
  //    seller's notes stay clean. Idempotent, bounded, silent.
  let swept = 0
  try {
    const relabeled = await db.lead.updateMany({ where: { source: 'EXPLEE' }, data: { source: 'TEAM' } })
    swept += relabeled.count
    const tainted = await db.lead.findMany({
      where: { OR: [{ notes: { contains: 'Explee' } }, { notes: { contains: 'Warm reply to' } }] },
      select: { id: true, notes: true },
      take: 200,
    })
    for (const t of tainted) {
      await db.lead
        .update({
          where: { id: t.id },
          data: {
            notes: (t.notes || '')
              .replace(/Fit: Warm reply to [^.]*\.?/gi, '')
              .replace(/Warm reply to [^.]*\.?/gi, '')
              .replace(/HustlePortal exec from Explee/gi, 'the Business Hustle team')
              .replace(/Explee/gi, 'the team')
              .replace(/\s{2,}/g, ' ')
              .trim(),
          },
        })
        .catch(() => {})
      swept++
    }
  } catch {
    /* the sweep never blocks the freshness work */
  }

  // 4) WELCOME SWEEP SAFETY NET: brand-new accounts whose signup-time sweep
  //    came back empty (drained engines, refusing mirrors) get one more turn
  //    while the engines are fresh. Bounded (3 accounts), self-guarded
  //    (eligibility, idempotence and the relevance gates all live inside the
  //    sweep). A failure here never breaks the freshness work above.
  let welcomeSwept: Array<{ email: string; shipped: number; reason?: string }> = []
  try {
    const results = await sweepPendingWelcome(3)
    welcomeSwept = results.map((r) => ({ email: r.email, shipped: r.result.shipped, reason: r.result.reason || r.result.skipped }))
  } catch (e) {
    console.error('[leads-refresh] welcome sweep net failed', e)
  }

  return NextResponse.json({
    ok: true,
    demoted: demoted.count,
    rechecked: batch.length,
    live,
    dead,
    prunedScans: pruned.count,
    whitelabelSwept: swept,
    welcomeSwept,
    ...(feed ? { feed } : {}),
  })
}
