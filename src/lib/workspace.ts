import { db } from '@/lib/db'

export type ProjectShape = {
  id: string
  name: string
  industry: string | null
  valueProp: string | null
  targetMarket: string | null
  offerings: string | null
  tone: string | null
  website: string | null
  contactEmail: string | null
  contactPhone: string | null
  salesPitch: string | null
  isDefault: boolean
}

/** List the user's company workspaces, default first. */
export async function listProjects(userId: string) {
  const projects = await db.project.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })
  const counts = await Promise.all(
    projects.map(async (p) => ({
      id: p.id,
      leads: await db.lead.count({ where: { projectId: p.id } }),
      clients: await db.client.count({ where: { projectId: p.id } }),
      invoices: await db.invoice.count({ where: { projectId: p.id } }),
    })),
  )
  return projects.map((p) => ({
    ...p,
    counts: counts.find((c) => c.id === p.id) ?? { id: p.id, leads: 0, clients: 0, invoices: 0 },
  }))
}

/**
 * Resolve the user's active project. Every user always has at least the
 * default "My Business" workspace, created on demand.
 */
export async function resolveProject(userId: string, projectId?: string | null) {
  if (projectId) {
    const p = await db.project.findFirst({ where: { id: projectId, userId } })
    if (p) return p
  }
  return getOrCreateDefaultProject(userId)
}

/** The default "My Business" workspace — created on first use, never deleted. */
export async function getOrCreateDefaultProject(userId: string) {
  const existing = await db.project.findFirst({
    where: { userId, isDefault: true },
  })
  if (existing) return existing
  const user = await db.user.findUnique({ where: { id: userId }, select: { businessName: true, name: true } })
  return db.project.create({
    data: {
      userId,
      name: user?.businessName || `${user?.name || 'My'}'s Business`,
      isDefault: true,
    },
  })
}

/** Assign projectId = default project to any rows missing it (used by backfill + create flows). */
export async function attachDefaultProject(userId: string, projectId?: string) {
  const pid = projectId || (await getOrCreateDefaultProject(userId)).id
  const [leads, clients, finance] = await Promise.all([
    db.lead.updateMany({ where: { userId, projectId: null }, data: { projectId: pid } }),
    db.client.updateMany({ where: { userId, projectId: null }, data: { projectId: pid } }),
    db.financeEntry.updateMany({ where: { userId, projectId: null }, data: { projectId: pid } }),
  ])
  return { projectId: pid, leads: leads.count, clients: clients.count, finance: finance.count }
}

/** Compact business-profile text used to ground Gemini prompts. */
export function profileText(p: ProjectShape | {
  name: string
  industry: string | null
  valueProp: string | null
  targetMarket: string | null
  offerings: string | null
  tone: string | null
  website: string | null
  contactEmail: string | null
  contactPhone: string | null
}): string {
  const lines = [
    `Business: ${p.name}`,
    p.industry ? `Industry: ${p.industry}` : null,
    p.valueProp ? `Value proposition: ${p.valueProp}` : null,
    p.targetMarket ? `Target market: ${p.targetMarket}` : null,
    p.offerings ? `Offerings: ${p.offerings}` : null,
    p.tone ? `Tone of voice: ${p.tone}` : null,
    p.website ? `Website: ${p.website}` : null,
    p.contactEmail ? `Contact email: ${p.contactEmail}` : null,
    p.contactPhone ? `Contact phone: ${p.contactPhone}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}
