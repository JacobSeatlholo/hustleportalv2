import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { spendCredits } from '@/lib/wallet'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import { demoReveal } from '@/lib/explee'
import { bumpChallenge } from '@/lib/gamification'

// POST /api/leads/reveal — spend credits to unlock contact details
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leadId } = await req.json()
  if (!leadId) return NextResponse.json({ error: 'leadId required.' }, { status: 400 })

  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
  if (lead.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (lead.unlocked) return NextResponse.json({ lead })

  const price = parseInt(await getConfig(CONFIG_KEYS.LEAD_PRICE)) || 1500
  const result = await spendCredits(userId, price, `Lead reveal: ${lead.company}`)
  if (!result) {
    return NextResponse.json(
      { error: 'Insufficient credits. Top up your wallet to reveal this lead.', code: 'INSUFFICIENT_CREDITS', price },
      { status: 402 }
    )
  }

  let contact = { email: lead.email, phone: lead.phone, website: lead.website, contactName: lead.contactName }
  // For demo-mode leads with no stored contact, generate deterministic demo contact info
  if (!contact.email && !contact.phone) {
    contact = { ...contact, ...demoReveal(lead.company, lead.city || undefined, lead.contactName || undefined) }
  }

  const updated = await db.lead.update({
    where: { id: leadId },
    data: {
      unlocked: true,
      email: contact.email || lead.email,
      phone: contact.phone || lead.phone,
      website: contact.website || lead.website,
      contactName: contact.contactName || lead.contactName,
    },
  })
  await bumpChallenge(userId, 'reveal_lead')
  return NextResponse.json({ lead: updated, wallet: result.wallet, spent: price })
}
