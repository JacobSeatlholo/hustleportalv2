import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { resolveProject } from '@/lib/workspace'
import { deadEmailMap } from '@/lib/reach'

type Ctx = { params: Promise<{ id: string }> }

function normKey(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

interface IncomingLead {
  company?: string
  contactName?: string
  role?: string
  email?: string
  phone?: string
  website?: string
  industry?: string
  city?: string
  country?: string
  value?: number
  notes?: string
  why?: string
  score?: number
  sourceRef?: string
}

// POST /api/admin/exec/client/[id]/leads, drop leads straight into a client's
// pipeline. Body: { leads: IncomingLead[], source?: 'EXPLEE' | 'MANUAL', projectId?, bench? }
// The exec pulls a lead from Explee (or types one) and hands it over; the
// client finds it waiting in their Lead Finder pipeline, stage NEW.
// bench: true loads onto the campaign bench (ClientPoolLead) instead —
// locked staging the member never sees until their own outreach earns it:
// when the member's campaign email to a bench lead gets READ, the open
// tracker promotes that row into the pipeline automatically.
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const body = await req.json().catch(() => ({}))
  const incoming: IncomingLead[] = Array.isArray(body?.leads) ? body.leads.slice(0, 200) : []
  const source = body?.source === 'EXPLEE' ? 'TEAM' : 'MANUAL' // the member sees the neutral face: the team hand picked it
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'Give me at least one lead with a company name.' }, { status: 400 })
  }
  // Only reject if NO lead at all carries a company name.
  if (!incoming.some((l) => String(l.company || '').trim())) {
    return NextResponse.json({ error: 'Each lead needs a company name.' }, { status: 400 })
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

  let skipped = 0

  // ===== THE BENCH LANE ===== exec loads researched leads onto the client's
  // campaign bench (ClientPoolLead), NOT the pipeline. Nothing the member sees
  // changes here — a bench lead only becomes a real pipeline row when the
  // member's own campaign email to it gets READ (the open tracker promotes
  // it, see /api/mail/open/[id]). Locked staging, honest hand: the contact
  // details land exactly as the team verified them, no promises added.
  if (body?.bench === true) {
    const benchRows: {
      userId: string
      fingerprint: string
      company: string
      contactName: string | null
      role: string | null
      email: string | null
      phone: string | null
      website: string | null
      industry: string | null
      city: string | null
      country: string | null
      source: string
      sourceRef: string | null
      why: string | null
      score: number | null
      status: string
    }[] = []
    // Dedup inside the batch + against the bench itself (the @@unique on
    // [userId, fingerprint] is the hard stop; this pre-check counts skips).
    const benchExisting = await db.clientPoolLead.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: { fingerprint: true },
    })
    const benchSeen = new Set(benchExisting.map((r) => r.fingerprint))
    for (const l of incoming) {
      const company = String(l.company || '').trim()
      if (!company) { skipped++; continue }
      const city = l.city ? String(l.city).trim() : null
      const fp = `${normKey(company)}|${normKey(city)}`
      if (benchSeen.has(fp)) { skipped++; continue }
      benchSeen.add(fp)
      const scoreNum = Math.round(Number(l.score))
      benchRows.push({
        userId: id,
        fingerprint: fp,
        company,
        contactName: l.contactName ? String(l.contactName).trim() : null,
        role: l.role ? String(l.role).trim() : null,
        email: l.email ? String(l.email).trim().toLowerCase() : null,
        phone: l.phone ? String(l.phone).trim() : null,
        website: l.website ? String(l.website).trim() : null,
        industry: l.industry ? String(l.industry).trim() : null,
        city,
        country: l.country ? String(l.country).trim() : null,
        source: 'MANUAL',
        sourceRef: l.sourceRef ? String(l.sourceRef).trim().slice(0, 300) : (l.website ? String(l.website).trim() : null),
        why: l.why ? String(l.why).slice(0, 500) : null,
        score: Number.isFinite(scoreNum) && scoreNum >= 1 && scoreNum <= 5 ? scoreNum : null,
        status: 'NEW',
      })
    }
    if (benchRows.length === 0) {
      return NextResponse.json({ ok: true, bench: true, created: 0, skipped, message: 'All of these are already on their bench, nothing double loaded.' })
    }
    // The same reachable promise as the pipeline lane: addresses the mail
    // system can never deliver to are stripped before the batch lands.
    const benchDead = await deadEmailMap(benchRows.map((r) => r.email), 16)
    let benchDeadStripped = 0
    for (const r of benchRows) {
      const e = (r.email || '').trim().toLowerCase()
      if (e && benchDead.has(e)) {
        r.email = null
        benchDeadStripped++
      }
    }
    const benchResult = await db.clientPoolLead.createMany({ data: benchRows })
    return NextResponse.json({
      ok: true,
      bench: true,
      created: benchResult.count,
      skipped,
      ...(benchDeadStripped ? { deadStripped: benchDeadStripped } : {}),
      message: `${benchResult.count} lead${benchResult.count === 1 ? '' : 's'} loaded onto ${target.name}'s campaign bench.${skipped ? ` ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped.` : ''}${benchDeadStripped ? ` ${benchDeadStripped} dead email${benchDeadStripped === 1 ? '' : 's'} stripped so nothing lands that can only bounce.` : ''}`,
    })
  }

  // Workspace: explicit projectId (validated) else the client's default project.
  const project = await resolveProject(id, typeof body?.projectId === 'string' ? body.projectId : null)

  // Dedup inside the batch + against the client's existing pipeline
  // (same company + city fingerprints are skipped, never double-loaded).
  const existing = await db.lead.findMany({
    where: { userId: id },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: { company: true, city: true },
  })
  const seen = new Set(existing.map((l) => `${normKey(l.company)}|${normKey(l.city)}`))

  const rows: {
    userId: string
    projectId: string
    company: string
    contactName: string | null
    role: string | null
    email: string | null
    phone: string | null
    website: string | null
    industry: string | null
    city: string | null
    value: number
    notes: string | null
    source: string
    stage: string
  }[] = []
  skipped = 0

  for (const l of incoming) {
    const company = String(l.company || '').trim()
    if (!company) { skipped++; continue }
    const city = l.city ? String(l.city).trim() : null
    const fp = `${normKey(company)}|${normKey(city)}`
    if (seen.has(fp)) { skipped++; continue }
    seen.add(fp)
    rows.push({
      userId: id,
      projectId: project.id,
      company,
      contactName: l.contactName ? String(l.contactName).trim() : null,
      role: l.role ? String(l.role).trim() : null,
      email: l.email ? String(l.email).trim().toLowerCase() : null,
      phone: l.phone ? String(l.phone).trim() : null,
      website: l.website ? String(l.website).trim() : null,
      industry: l.industry ? String(l.industry).trim() : null,
      city,
      value: Number.isFinite(Number(l.value)) && Number(l.value) > 0 ? Number(l.value) : 0,
      notes: l.notes ? String(l.notes).slice(0, 500) : (source === 'TEAM' ? 'Hand picked for you by the Business Hustle team from our verified contacts.' : 'Loaded for you by the Business Hustle team.'),
      source,
      stage: 'NEW',
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, created: 0, skipped, message: 'All of these are already in their pipeline, nothing double loaded.' })
  }

  // THE REACHABLE PROMISE ON THE HAND-PICKED LANE: the team's promise is the
  // strongest one, it must be the truest. Shape-valid addresses the mail
  // system can never deliver to are stripped before the batch lands, so a
  // member never receives a "hand picked" lead that can only bounce.
  const dead = await deadEmailMap(rows.map((r) => r.email), 16)
  let deadStripped = 0
  for (const r of rows) {
    const e = (r.email || '').trim().toLowerCase()
    if (e && dead.has(e)) {
      r.email = null
      deadStripped++
    }
  }

  const result = await db.lead.createMany({ data: rows })
  return NextResponse.json({
    ok: true,
    created: result.count,
    skipped,
    ...(deadStripped ? { deadStripped } : {}),
    projectName: project.name,
    message: `${result.count} lead${result.count === 1 ? '' : 's'} loaded into ${target.name}'s pipeline (${project.name}).${skipped ? ` ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped.` : ''}${deadStripped ? ` ${deadStripped} dead email${deadStripped === 1 ? '' : 's'} stripped so nothing lands that can only bounce.` : ''}`,
  })
}
