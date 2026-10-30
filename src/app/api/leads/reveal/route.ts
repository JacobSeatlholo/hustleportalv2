import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { spendCredits } from '@/lib/wallet'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import { isSuppressed } from '@/lib/suppression'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'
import { zaiGenerate } from '@/lib/zai'
import { bumpChallenge } from '@/lib/gamification'
import { emailReach } from '@/lib/reach'
import { tregVerifyEmail } from '@/lib/tregverify'
import { companyKeyFor, cacheGetContact, cachePutContact, siteContactDoor, bumpRevealStats } from '@/lib/leadlookup'

export const maxDuration = 60

/**
 * POST /api/leads/reveal, spend credits to unlock contact details.
 *
 * HONESTY CONTRACT (no more fabricated contacts):
 *  - Leads with stored (real) contact details: charge and unlock, as before.
 *  - Leads with NO stored contact: Gemini runs a GROUNDED web lookup for the
 *    business's PUBLICLY LISTED details. If verified details are found we charge
 *    and unlock; if not, the user is NOT charged and we say so plainly.
 *  - Fabricated demo contacts (pattern-built emails/phones) were removed,
 *    the reveal is real results or your money stays in your wallet.
 */

function saneEmail(v?: string | null): string | undefined {
  const s = (v || '').trim()
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined
  if (/example\.(com|org|net)|your(email)?\.|domain\.com/i.test(s)) return undefined
  return s
}

function sanePhone(v?: string | null): string | undefined {
  const s = (v || '').trim()
  if (!s) return undefined
  if (s.replace(/\D/g, '').length < 9) return undefined
  return s
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leadId } = await req.json()
  if (!leadId) return NextResponse.json({ error: 'leadId required.' }, { status: 400 })

  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
  if (lead.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (lead.unlocked) return NextResponse.json({ lead })

  // POPIA opt-out: this business asked to leave the lead index. Refuse before
  // the grounded lookup and before any charge, an opt-out must never cost
  // the seller a cent and must never surface as a purchasable contact.
  if (await isSuppressed({ company: lead.company, city: lead.city, externalId: lead.externalId })) {
    return NextResponse.json({
      lead,
      charged: false,
      message: `${lead.company} asked to stay out of the lead index. We honour that. You were NOT charged.`,
    })
  }

  const price = parseInt(await getConfig(CONFIG_KEYS.LEAD_PRICE)) || 1500

  let contact = {
    email: saneEmail(lead.email),
    phone: sanePhone(lead.phone),
    website: lead.website || undefined,
    contactName: lead.contactName || undefined,
  }
  let viaSource: string | undefined
  // DOOR 3C bookkeeping: whether the mailbox gate proved an email dead here,
  // and which memory row (if any) fed this reveal — the gate may prove THAT
  // row's answer dead too, and a memory row must never outlive its proof.
  let verifyStripped = false
  let memoryCacheKey: string | undefined
  const tReveal = Date.now() // the whole chain, doors + gate, shares the 60s ceiling

  // THE REACHABLE CONTRACT AT THE TILL: an address the mail system can
  // provably never deliver to (the domain does not exist or announces no
  // mail path) is not a contact fact, it is a trap. It is stripped BEFORE
  // anything is charged, and the sale rides on the doors that actually
  // work (phone, grounded lookup). DNS only: free, cached, no AI quota.
  let deadEmailStripped = false
  if (contact.email && (await emailReach(contact.email)) === 'dead') {
    contact.email = undefined
    deadEmailStripped = true
  }
  // DOOR 3C ON THE STORED EMAIL: the DNS gate can only prove a domain dead;
  // a live domain can still hold a mailbox that quietly stopped existing, and
  // the test on our own pool caught exactly that (1 in 15). One treg verdict
  // (R0.03, cached platform-wide) either clears the address for sale or — if
  // it is PROVED dead — strips it here, so the doors below go hunting for a
  // real contact instead of the till selling a guaranteed bounce.
  else if (contact.email) {
    const stored = await tregVerifyEmail(contact.email, { timeoutMs: 8_000 })
    await bumpRevealStats(stored.verdict === 'invalid' ? 'verifyDead' : 'verify', stored.costMicro)
    if (stored.verdict === 'invalid') {
      contact.email = undefined
      verifyStripped = true
    }
  }

  // No stored contact → three doors, cheapest first, charged only on success.
  // Door 1 is the shared lookup MEMORY: the first member who verified this
  // business paid the search, every member after them reads the answer free.
  // Door 2 is the business's OWN website, read with a plain fetch — no AI, no
  // quota, no model rotation, the same public-source standard as always.
  // Door 3 is the grounded AI lookup, exactly as before. Google being drained
  // or moody now costs members only the rare third door instead of every
  // reveal — the steady wall between new users and their first paid win.
  if (!contact.email && !contact.phone) {
    const companyKey = companyKeyFor(lead.company, lead.city, lead.website)
    const tChain = Date.now() // the whole door chain shares the 60s function ceiling
    await bumpRevealStats('lookups')

    // DOOR 1: memory. Same gates as everything else: sane shapes, reach check.
    const remembered = await cacheGetContact(companyKey)
    if (remembered) {
      let memEmail = saneEmail(remembered.email)
      if (memEmail && (await emailReach(memEmail)) === 'dead') memEmail = undefined
      const memPhone = sanePhone(remembered.phone)
      if (memEmail || memPhone) {
        contact = {
          ...contact,
          email: memEmail || contact.email,
          phone: memPhone || contact.phone,
          contactName: remembered.contactName || contact.contactName,
        }
        viaSource = remembered.source
        memoryCacheKey = remembered.cacheKey
        await bumpRevealStats('memory')
      } else {
        // The remembered answer rotted (nothing sane survives the gates).
        // Drop it so the next member goes fresh instead of tripping twice —
        // by the row's OWN key: a stem match may live under a sibling identity.
        await db.leadLookupCache
          .delete({ where: { companyKey: remembered.cacheKey || companyKey } })
          .catch(() => {})
      }
    }

    // DOOR 2: their own website. A dead or guarded site just returns null and
    // the chain moves on; the found email wears the same reach gate.
    if (!contact.email && !contact.phone) {
      const site = await siteContactDoor(lead.website)
      if (site) {
        let siteEmail = saneEmail(site.email)
        if (siteEmail && (await emailReach(siteEmail)) === 'dead') siteEmail = undefined
        const sitePhone = sanePhone(site.phone)
        if (siteEmail || sitePhone) {
          contact = {
            ...contact,
            email: siteEmail || contact.email,
            phone: sitePhone || contact.phone,
          }
          viaSource = site.source
          await bumpRevealStats('site')
          await cachePutContact(companyKey, { email: siteEmail, phone: sitePhone, source: site.source })
        }
      }
    }

    // DOOR 3: grounded public lookup (real or nothing). 40s budget so the
    // whole chain of doors always fits inside the 60s function ceiling.
    // purpose 'reveal' rides the dedicated reveal key first when the operator
    // has set one, so drained free scans never starve the paid feature.
    if (!contact.email && !contact.phone) {
    const lookupSystem =
      'You find publicly listed contact details for businesses, grounded in live web search results. Report ONLY details that actually appear in a source you saw (official website, directory, Google Business listing, news, Facebook page). NEVER guess, NEVER construct an email from a name@domain pattern. If you cannot verify real details, say so.'
    const lookupPrompt =
      `Find the publicly listed contact details for the business "${lead.company}"` +
      (lead.city ? ` in ${lead.city}` : '') +
      (lead.website ? ` (website: ${lead.website})` : '') +
      `, South Africa. Return ONLY JSON: {"found":true|false,"contactName":"","email":"","phone":"","source":"where you found it"}`
    const lookup = await geminiGenerate(userId, {
      search: true,
      json: true,
      timeoutMs: 40_000,
      purpose: 'reveal',
      system: lookupSystem,
      prompt: lookupPrompt,
    })
    let found = false
    let via = ''
    if (lookup.ok) {
      const parsed = parseJsonLoose<{ found?: boolean; contactName?: string; email?: string; phone?: string; source?: string }>(lookup.text)
      let email = saneEmail(parsed?.email)
      // The lookup must never sell back a dead address either: a found email
      // that cannot receive mail does not count as found.
      if (email && (await emailReach(email)) === 'dead') email = undefined
      const phone = sanePhone(parsed?.phone)
      if (parsed?.found && (email || phone)) {
        contact = {
          ...contact,
          email: email || contact.email,
          phone: phone || contact.phone,
          contactName: (parsed.contactName || '').trim() || contact.contactName,
        }
        found = true
        via = (parsed.source || '').trim() || 'public web'
      }
    }
    if (!found) {
      // The lookup itself failing (daily search allowance drained, key trouble,
      // network) must never read as "no contact exists". Different message, same
      // promise: nothing was charged. And the engine's OWN reason rides along —
      // a per-minute wall, a day drain and busy-hour shedding each have a
      // different fix, and one blanket "allowance may be stretched" hides which.
      if (!lookup.ok) {
        console.warn('[reveal] grounded lookup failed:', {
          leadId,
          company: lead.company,
          reason: lookup.error,
        })
        await bumpRevealStats('engineFail')
        // DOOR 3b: the GLM engine's own web search, a DIFFERENT index and a
        // different quota pocket from Google's. When Google's search day is
        // drained the paid reveal does not have to die with it. The seller's
        // own z.ai key rides first (their credits, their control), the platform
        // GLM pool second the day its search balance is funded. Same grounded
        // contract, same sane + reach gates, or nothing is charged.
        const left = 55_000 - (Date.now() - tChain)
        if (left > 9_000) {
          const glm = await zaiGenerate(userId, {
            search: true,
            json: true,
            maxTokens: 900,
            timeoutMs: Math.min(22_000, left),
            system: lookupSystem,
            prompt: lookupPrompt,
          })
          if (glm.ok) {
            const parsed = parseJsonLoose<{ found?: boolean; contactName?: string; email?: string; phone?: string; source?: string }>(glm.text)
            let gEmail = saneEmail(parsed?.email)
            if (gEmail && (await emailReach(gEmail)) === 'dead') gEmail = undefined
            const gPhone = sanePhone(parsed?.phone)
            if (parsed?.found && (gEmail || gPhone)) {
              contact = {
                ...contact,
                email: gEmail || contact.email,
                phone: gPhone || contact.phone,
                contactName: (parsed?.contactName || '').trim() || contact.contactName,
              }
              found = true
              viaSource = (parsed?.source || '').trim() || 'GLM web search'
              await bumpRevealStats('glm')
              await cachePutContact(companyKey, {
                email: contact.email,
                phone: contact.phone,
                contactName: contact.contactName,
                source: viaSource,
              })
            }
          } else {
            console.warn('[reveal] glm fallback failed:', { leadId, company: lead.company, reason: glm.error })
          }
        }
      }
      if (!found) {
      // Only a TRUTHFUL not-found counts as 'fail': an engine failure already
      // counted itself as engineFail above, and one event must never sit in
      // two buckets on the operator's lens.
      if (lookup.ok) await bumpRevealStats('fail')
      const searchMessage = !lookup.ok
        ? `The live contact search could not run just now. ${lookup.error} You were NOT charged.`
        : `No verified public contact found for ${lead.company}, you were NOT charged.` +
          (lead.website ? ` Try their website directly: ${lead.website}` : ' Try searching for them directly.')
      return NextResponse.json({
        lead,
        charged: false,
        message: searchMessage,
      })
      }
    }
    // A fresh verified answer becomes everyone's memory: the next member never
    // pays Google for this business again. (The GLM door records itself where
    // it succeeded; `via` is only non-empty for the Gemini find.)
    if (via) {
    await bumpRevealStats('gemini')
    await cachePutContact(companyKey, {
      email: contact.email,
      phone: contact.phone,
      contactName: contact.contactName,
      source: via,
    })
    viaSource = via
    }
    }
  }

  // DOOR 3C AT THE TILL: every email any door just found wears one last gate
  // before money moves. The provider either PROVES the mailbox exists (the
  // sale proceeds on solid ground) or PROVES it dead — and a proved-dead
  // address is stripped like any dead thing at this till. A phone standing on
  // its own still sells; an email with nothing else standing leaves the
  // member's wallet shut and the truth on the counter: found, but dead.
  if (contact.email) {
    const left = 58_000 - (Date.now() - tReveal)
    if (left > 3_000) {
      const gate = await tregVerifyEmail(contact.email, { timeoutMs: Math.min(8_000, left) })
      await bumpRevealStats(gate.verdict === 'invalid' ? 'verifyDead' : 'verify', gate.costMicro)
      if (gate.verdict === 'invalid') {
        contact.email = undefined
        verifyStripped = true
      }
    }
  }

  // The gate just proved the MEMORY row's only sellable fact dead. Keep the
  // row and every member after this one trips the same corpse; drop it and
  // the next reveal goes fresh through the doors, same as the rot rule above.
  if (verifyStripped && !contact.phone && memoryCacheKey) {
    await db.leadLookupCache.delete({ where: { companyKey: memoryCacheKey } }).catch(() => {})
  }
  if (!contact.email && !contact.phone && verifyStripped) {
    return NextResponse.json({
      lead,
      charged: false,
      message:
        `We found a publicly listed email for ${lead.company}, but its mailbox no longer accepts mail and no working phone was found. You were NOT charged.` +
        (lead.website ? ` Their website: ${lead.website}` : ' Try searching for them directly.'),
    })
  }

  const result = await spendCredits(userId, price, `Lead reveal: ${lead.company}`)
  if (!result) {
    return NextResponse.json(
      { error: 'Insufficient credits. Top up your wallet to reveal this lead.', code: 'INSUFFICIENT_CREDITS', price },
      { status: 402 }
    )
  }

  const updated = await db.lead.update({
    where: { id: leadId },
    data: {
      unlocked: true,
      // a provably dead address is removed from the row, not kept to trap
      // the seller's first campaign send
      email: contact.email || (deadEmailStripped ? null : lead.email),
      phone: contact.phone || lead.phone,
      website: contact.website || lead.website,
      contactName: contact.contactName || lead.contactName,
    },
  })
  await bumpChallenge(userId, 'reveal_lead')
  return NextResponse.json({
    lead: updated,
    wallet: result.wallet,
    spent: price,
    ...(typeof viaSource !== 'undefined' && viaSource ? { sourceNote: `Found via: ${viaSource}` } : {}),
    ...(deadEmailStripped || verifyStripped
      ? {
          notice: verifyStripped
            ? 'The email we found was removed before you paid: its mailbox no longer accepts mail, so every send to it would have bounced. You were charged only for what works.'
            : 'The email address on file was removed: its mail domain is dead, every send to it would have bounced. You were charged only for the doors that work.',
        }
      : {}),
  })
}
