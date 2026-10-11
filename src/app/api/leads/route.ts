import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'

// GET /api/leads?stage=&team=&q=  → list leads (own + team)
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') || 'all' // all | mine | team
  const q = url.searchParams.get('q') || ''

  const memberships = await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })
  const teamIds = memberships.map((m) => m.teamId)

  const where: Record<string, unknown> = {}
  if (scope === 'mine') where.userId = userId
  else if (scope === 'team') {
    if (teamIds.length === 0) return NextResponse.json({ leads: [] })
    where.teamId = { in: teamIds }
  } else if (teamIds.length > 0) {
    where.OR = [{ userId }, { teamId: { in: teamIds } }]
  } else where.userId = userId
  if (q) where.company = { contains: q }

  const leads = await db.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return NextResponse.json({ leads })
}

// POST /api/leads → create (manual / from discover)
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { company, contactName, email, phone, website, industry, city, country, source, teamId, value, notes, externalId, unlocked, score, why } = body
  if (!company || !String(company).trim()) {
    return NextResponse.json({ error: 'Company name is required.' }, { status: 400 })
  }
  // verify team membership if teamId provided
  if (teamId) {
    const member = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member of that team.' }, { status: 403 })
  }
  const lead = await db.lead.create({
    data: {
      userId,
      teamId: teamId || null,
      company: String(company).trim(),
      contactName: contactName || null,
      email: email || null,
      phone: phone || null,
      website: website || null,
      industry: industry || null,
      city: city || null,
      country: country || 'South Africa',
      source: source || 'MANUAL',
      value: Number(value) || 0,
      notes: notes || why || null, // AI scout's "why they need you" lands as the first note
      externalId: externalId || null,
      unlocked: Boolean(unlocked),
      score: score ?? null,
    },
  })
  await bumpChallenge(userId, 'add_lead')
  return NextResponse.json({ lead })
}
