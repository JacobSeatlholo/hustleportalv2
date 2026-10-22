import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'

// POST /api/admin/exec/campaign/import, load the owner's contact list from a
// sister product (BlackBiz etc.) into THEIR OWN pipeline so the campaign and
// the follow-up live in one place. Exec seat only.
//
// body: { targetEmail, projectName?, teamName?, leads: [{ email, company?, notes? }] }
// - targetEmail: the account that owns the project (the boss's own login)
// - project: created if missing, reused if there (default "Simple Eternity Holdings")
// - team: the owner's existing team is used; otherwise one is created so the
//   contacts sit "with the team"
// - dedupe: an email already on the owner's pipeline is skipped, never doubled
// Returns the email -> leadId mapping the campaign sender links to.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(req: Request) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({}))
  const targetEmail = String(body?.targetEmail || '').trim().toLowerCase()
  const projectName = String(body?.projectName || 'Simple Eternity Holdings').trim().slice(0, 80)
  const incoming: { email?: string; company?: string; notes?: string }[] =
    Array.isArray(body?.leads) ? body.leads.slice(0, 300) : []

  if (!EMAIL_RE.test(targetEmail)) {
    return NextResponse.json({ error: 'A valid targetEmail is required.' }, { status: 400 })
  }
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'Give me at least one contact with an email.' }, { status: 400 })
  }
  if (!incoming.some((l) => EMAIL_RE.test(String(l.email || '').trim().toLowerCase()))) {
    return NextResponse.json({ error: 'Each contact needs a valid email.' }, { status: 400 })
  }

  const owner = await db.user.findUnique({ where: { email: targetEmail }, select: { id: true, name: true } })
  if (!owner) return NextResponse.json({ error: 'No account matches targetEmail.' }, { status: 404 })

  // Project: reuse or create. isDefault stays untouched, never disturb the
  // owner's existing default workspace.
  let project = await db.project.findFirst({
    where: { userId: owner.id, name: projectName },
    select: { id: true, name: true },
  })
  if (!project) {
    project = await db.project.create({
      data: { userId: owner.id, name: projectName, description: 'Contacts from the Business Hustle ecosystem, BlackBiz members.' },
      select: { id: true, name: true },
    })
  }

  // Team: the owner's first team if they have one, else create it so the
  // contacts literally sit with the team.
  let team = await db.team.findFirst({ where: { ownerId: owner.id }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })
  let teamCreated = false
  if (!team) {
    team = await db.team.create({
      data: { name: String(body?.teamName || projectName).slice(0, 80), ownerId: owner.id },
      select: { id: true, name: true },
    })
    teamCreated = true
  }

  // Dedupe against the owner's pipeline by email.
  const emails = incoming.map((l) => String(l.email || '').trim().toLowerCase()).filter((e) => EMAIL_RE.test(e))
  const existing = await db.lead.findMany({
    where: { userId: owner.id, email: { in: emails } },
    select: { email: true },
  })
  const existingSet = new Set(existing.map((l) => (l.email || '').toLowerCase()))

  let created = 0
  const skipped: string[] = []
  const mapping: { email: string; leadId: string }[] = []

  for (const l of incoming) {
    const email = String(l.email || '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) continue
    if (existingSet.has(email)) {
      skipped.push(email)
      continue
    }
    existingSet.add(email)
    const lead = await db.lead.create({
      data: {
        userId: owner.id,
        teamId: team.id,
        projectId: project.id,
        company: String(l.company || email.split('@')[1].split('.')[0]).slice(0, 120),
        email,
        source: 'CSV',
        stage: 'NEW',
        notes: String(l.notes || 'BlackBiz member, ecosystem intro campaign').slice(0, 500),
      },
      select: { id: true },
    })
    mapping.push({ email, leadId: lead.id })
    created++
  }

  return NextResponse.json({
    ok: true,
    project: { id: project.id, name: project.name },
    team: { id: team.id, name: team.name, created: teamCreated },
    created,
    skippedCount: skipped.length,
    skipped,
    mapping,
  })
}
