import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'
import { resolveProject } from '@/lib/workspace'
import { emailReach } from '@/lib/reach'

// GET /api/leads?stage=&team=&q=&projectId=  → list leads (own + team)
// projectId narrows the list to one workspace; projectId=ALL (or omitted) keeps the classic mixed view.
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') || 'all' // all | mine | team
  const q = url.searchParams.get('q') || ''
  const projectId = url.searchParams.get('projectId') || ''

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
  if (projectId && projectId !== 'ALL') {
    const project = await resolveProject(userId, projectId)
    if (project.id !== projectId) return NextResponse.json({ error: 'Unknown project.' }, { status: 404 })
    where.projectId = projectId
  }

  const leads = await db.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  // Who already opened our email? One query for the page, keyed by lead.
  // Rows without an open never appear here: no badge means not opened yet.
  const ids = leads.map((l) => l.id)
  const openRows = ids.length
    ? await db.emailLog.findMany({
        where: { leadId: { in: ids }, openedAt: { not: null } },
        select: { leadId: true, openedAt: true, openCount: true },
      })
    : []
  const opens: Record<string, { openedAt: string; openCount: number }> = {}
  for (const r of openRows) {
    const prev = opens[r.leadId as string]
    if (!prev || (r.openedAt && new Date(r.openedAt) > new Date(prev.openedAt))) {
      opens[r.leadId as string] = { openedAt: (r.openedAt as Date).toISOString(), openCount: r.openCount }
    }
  }
  return NextResponse.json({ leads, opens })
}

// POST /api/leads → create (manual / from discover)
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { company, contactName, role, profileUrl, email, phone, website, industry, city, country, source, teamId, value, notes, externalId, unlocked, score, why, projectId } = body
  if (!company || !String(company).trim()) {
    return NextResponse.json({ error: 'Company name is required.' }, { status: 400 })
  }
  // Where a lead came from, in words a member understands. The internal
  // tooling keeps its own labels in the pool; a member's pipeline only ever
  // carries the neutral face: TEAM, POOL, WEB, MAP, MANUAL, CSV.
  const srcRaw = String(source || '').toUpperCase()
  const NEUTRAL_SOURCES = ['TEAM', 'POOL', 'WEB', 'OSM', 'ZAI', 'GEMINI', 'MANUAL', 'CSV']
  const safeSource = srcRaw === 'EXPLEE' ? 'TEAM' : NEUTRAL_SOURCES.includes(srcRaw) ? srcRaw : 'MANUAL'
  // Every lead belongs to a workspace. Explicit projectId wins (validated against the
  // owner); anything else falls back to the default workspace so no lead is ever orphaned.
  const project = await resolveProject(userId, projectId ?? null)
  // verify team membership if teamId provided
  if (teamId) {
    const member = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member of that team.' }, { status: 403 })
  }
  // THE REACHABLE PROMISE AT CAPTURE, the same law the pool and the reveal obey:
  // an address the mail system can provably never deliver to is not stored.
  // The row still lands (phone, website, the story); only the junk fact goes.
  // DNS only, cached, $0 — no AI quota and no noticeable latency on a save.
  let deadEmailStripped = false
  let cleanEmail: string | null = email || null
  if (cleanEmail && (await emailReach(cleanEmail)) === 'dead') {
    cleanEmail = null
    deadEmailStripped = true
  }
  const lead = await db.lead.create({
    data: {
      userId,
      projectId: project.id,
      teamId: teamId || null,
      company: String(company).trim(),
      contactName: contactName || null,
      role: (role || null) as string | null,
      profileUrl: (profileUrl || null) as string | null,
      email: cleanEmail,
      phone: phone || null,
      website: website || null,
      industry: industry || null,
      city: city || null,
      country: country || 'South Africa',
      source: safeSource,
      value: Number(value) || 0,
      notes: notes || why || null, // AI scout's "why they need you" lands as the first note
      externalId: externalId || null,
      // A card unlocks only when a REAL contact door survived the reach gate:
      // a stripped dead address never masquerades as an unlocked contact.
      unlocked: Boolean(unlocked) && Boolean(cleanEmail || phone),
      score: score ?? null,
    },
  })
  await bumpChallenge(userId, 'add_lead')
  return NextResponse.json({
    lead,
    ...(deadEmailStripped
      ? {
          notice:
            'The email on this capture was removed: its mail domain is dead, every send to it would have bounced. The lead itself is saved with the doors that work.',
        }
      : {}),
  })
}
