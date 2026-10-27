import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { spendCredits } from '@/lib/wallet'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import { isSuppressed } from '@/lib/suppression'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'
import { bumpChallenge } from '@/lib/gamification'
import { emailReach } from '@/lib/reach'

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

  // No stored contact → grounded public lookup (real or nothing). Charged only on success.
  if (!contact.email && !contact.phone) {
    const lookup = await geminiGenerate(userId, {
      search: true,
      json: true,
      system:
        'You find publicly listed contact details for businesses, grounded in live Google Search results. Report ONLY details that actually appear in a source you saw (official website, directory, Google Business listing, news, Facebook page). NEVER guess, NEVER construct an email from a name@domain pattern. If you cannot verify real details, say so.',
      prompt:
        `Find the publicly listed contact details for the business "${lead.company}"` +
        (lead.city ? ` in ${lead.city}` : '') +
        (lead.website ? ` (website: ${lead.website})` : '') +
        `, South Africa. Return ONLY JSON: {"found":true|false,"contactName":"","email":"","phone":"","source":"where you found it"}`,
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
        via = (parsed.source || '').trim()
      }
    }
    if (!found) {
      // The lookup itself failing (daily search allowance drained, key trouble,
      // network) must never read as "no contact exists". Different message, same
      // promise: nothing was charged.
      const searchMessage = !lookup.ok
        ? `The contact search could not run just now (the daily AI search allowance may be stretched). You were NOT charged. Try ${lead.company} again in a minute.`
        : `No verified public contact found for ${lead.company}, you were NOT charged.` +
          (lead.website ? ` Try their website directly: ${lead.website}` : ' Try searching for them directly.')
      return NextResponse.json({
        lead,
        charged: false,
        message: searchMessage,
      })
    }
    viaSource = via
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
    ...(deadEmailStripped
      ? {
          notice:
            'The email address on file was removed: its mail domain is dead, every send to it would have bounced. You were charged only for the doors that work.',
        }
      : {}),
  })
}
