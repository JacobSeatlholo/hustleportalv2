import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { resolveProject } from '@/lib/workspace'

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
  value?: number
  notes?: string
}

// POST /api/admin/exec/client/[id]/leads — drop leads straight into a client's
// pipeline. Body: { leads: IncomingLead[], source?: 'EXPLEE' | 'MANUAL', projectId? }
// The exec pulls a lead from Explee (or types one) and hands it over; the
// client finds it waiting in their Lead Finder pipeline, stage NEW.
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const { id } = await ctx.params

  const body = await req.json().catch(() => ({}))
  const incoming: IncomingLead[] = Array.isArray(body?.leads) ? body.leads.slice(0, 200) : []
  const source = body?.source === 'EXPLEE' ? 'EXPLEE' : 'MANUAL'
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'Give me at least one lead with a company name.' }, { status: 400 })
  }
  // Only reject if NO lead at all carries a company name.
  if (!incoming.some((l) => String(l.company || '').trim())) {
    return NextResponse.json({ error: 'Each lead needs a company name.' }, { status: 400 })
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })
  if (!target) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

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
  let skipped = 0

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
      notes: l.notes ? String(l.notes).slice(0, 500) : (source === 'EXPLEE' ? 'Loaded by HustlePortal exec from Explee.' : 'Loaded by HustlePortal exec.'),
      source,
      stage: 'NEW',
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, created: 0, skipped, message: 'All of these are already in their pipeline — nothing double loaded.' })
  }

  const result = await db.lead.createMany({ data: rows })
  return NextResponse.json({
    ok: true,
    created: result.count,
    skipped,
    projectName: project.name,
    message: `${result.count} lead${result.count === 1 ? '' : 's'} loaded into ${target.name}'s pipeline (${project.name}).${skipped ? ` ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped.` : ''}`,
  })
}
