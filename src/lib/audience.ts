import { db } from '@/lib/db'

/**
 * The system blast audience: every real person on the platform, one law,
 * two consumers (the preview endpoint and the queue staging) so the count
 * the boss reads is exactly the count that queues. No segment hiding in
 * either side.
 *
 * Who is in: MEMBER accounts in good standing.
 * Who is never in:
 *   - exec seats (the master account and the internal operator, role ADMIN
 *     or platformAdmin) — the platform never pitches its own staff
 *   - the internal QA domain (@hustleqa.example.com, probes and smoke seats)
 *   - suspended accounts (the boss paused those deliberately)
 * Who is reported and left out, with the number always shown:
 *   - the kloofstreet.online crew: they already had their mail (the welcome
 *     pass and the kloofstreet blast), the boss excluded them by name
 *   - unsubscribed, bounced or complained addresses: the suppression list,
 *     the queue engine refuses them at send time anyway, this just counts
 *   - paying subscribers: already converted, and a "come try it free" pitch
 *     landing in a paying customer's inbox reads like we do not know them.
 *     The composer carries a toggle to put them back in, boss's call.
 */

/** Domains that never belong in a member blast, with the reason kept for the readout. */
export const BLAST_EXCLUDED_DOMAINS: ReadonlyArray<{ domain: string; reason: 'KLOOFSTREET' | 'INTERNAL' }> = [
  { domain: 'kloofstreet.online', reason: 'KLOOFSTREET' },
  { domain: 'hustleqa.example.com', reason: 'INTERNAL' },
]

export interface AudienceSegments {
  /** Every MEMBER account on the platform, before any exclusion. */
  total: number
  excluded: {
    kloofstreet: number
    internal: number
    suspended: number
    suppressed: number
    paying: number
  }
  /** Eligible accounts that have never signed in — the activation frontier. */
  neverLoggedIn: number
  eligible: number
  /** First eligible account, for the composer's draft preview fill. */
  sample: { name: string; email: string } | null
}

export interface AudienceRow {
  email: string
  firstName: string
}

export interface SystemAudienceResult {
  rows: AudienceRow[]
  segments: AudienceSegments
}

function firstNameOf(name: string | null, businessName: string | null): string {
  return (name || '').trim().split(/\s+/)[0] || (businessName || '').trim() || 'there'
}

export async function systemBlastAudience(opts: { skipPaying?: boolean } = {}): Promise<SystemAudienceResult> {
  const skipPaying = opts.skipPaying !== false

  const [users, suppressedRows] = await Promise.all([
    db.user.findMany({
      where: { role: 'MEMBER' },
      select: {
        email: true,
        name: true,
        businessName: true,
        accountStatus: true,
        lastLoginAt: true,
        platformAdmin: true,
        subscription: { select: { status: true } },
      },
    }),
    db.suppression.findMany({ select: { email: true } }),
  ])
  const suppressed = new Set(suppressedRows.map((r) => r.email.toLowerCase().trim()))

  const excluded = { kloofstreet: 0, internal: 0, suspended: 0, suppressed: 0, paying: 0 }
  let neverLoggedIn = 0
  const rows: AudienceRow[] = []
  let sample: AudienceSegments['sample'] = null

  for (const u of users) {
    const email = u.email.toLowerCase().trim()
    const domain = email.split('@')[1] || ''
    const excludedDomain = BLAST_EXCLUDED_DOMAINS.find((d) => domain === d.domain)
    if (excludedDomain || u.platformAdmin === true) {
      if (excludedDomain?.reason === 'KLOOFSTREET') excluded.kloofstreet++
      else excluded.internal++
      continue
    }
    if (u.accountStatus !== 'ACTIVE') { excluded.suspended++; continue }
    if (suppressed.has(email)) { excluded.suppressed++; continue }
    const paying = u.subscription?.status === 'ACTIVE'
    if (paying) excluded.paying++
    if (paying && skipPaying) continue
    // Counted only for accounts that actually receive the mail, so the number
    // the boss reads describes the audience he is about to blast.
    if (!u.lastLoginAt) neverLoggedIn++
    if (!sample) sample = { name: firstNameOf(u.name, u.businessName), email }
    rows.push({ email, firstName: firstNameOf(u.name, u.businessName) })
  }

  return {
    rows,
    segments: {
      total: users.length,
      excluded,
      neverLoggedIn,
      eligible: rows.length,
      sample,
    },
  }
}

/** Fill the merge tags: every accepted name token ({first_name}, {firstName},
 *  {name}) becomes the person, {email} becomes their address. Same law as
 *  campaignpersonal.fillForRecipient. */
export function fillMergeTags(template: string, name: string, email: string): string {
  return template
    .replace(/\{first_name\}/g, name)
    .replace(/\{firstName\}/g, name)
    .replace(/\{name\}/g, name)
    .replace(/\{email\}/g, email)
}
