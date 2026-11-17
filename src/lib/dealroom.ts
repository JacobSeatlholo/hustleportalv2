import { db } from '@/lib/db'

// ============ DEAL ROOM (Task 213) ============
// Shared helpers for the in-platform deal room: the stage ladder, team
// memberships, and the visibility walls. A deal is visible to its owner, its
// creator and every member of its team (null team = private to the owner).
// Commission/referral mechanics stay internal to the exec layer — the deal
// room carries no client-facing pricing or split content.

export const DEAL_STAGES = ['LEAD', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const
export type DealStage = (typeof DEAL_STAGES)[number]

export const DEAL_STAGE_LABELS: Record<string, string> = {
  LEAD: 'New lead',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
}

export const MAX_DOC_BYTES = 10 * 1024 * 1024 // 10 MB per uploaded document

export async function myTeamIds(userId: string): Promise<string[]> {
  const memberships = await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })
  return memberships.map((m) => m.teamId)
}

/** The deal if the user may see it, else null. */
export async function canSeeDeal(dealId: string, userId: string) {
  const teamIds = await myTeamIds(userId)
  return db.deal.findFirst({
    where: {
      id: dealId,
      OR: [{ ownerId: userId }, { creatorId: userId }, { teamId: { in: teamIds } }],
    },
  })
}

/** The task if the user may see it (mirrors the comments API wall), else null. */
export async function canSeeTaskRecord(taskId: string, userId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } })
  if (!task) return null
  if (task.creatorId === userId || task.assigneeId === userId) return task
  if (task.teamId) {
    const member = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId: task.teamId, userId } },
    })
    if (member) return task
  }
  return null
}

/**
 * The doc row if the user may see it: via its task (creator, assignee or team
 * member) or via its deal (owner, creator or team member). Null otherwise.
 */
export async function canSeeDoc(docId: string, userId: string) {
  const doc = await db.docFile.findUnique({
    where: { id: docId },
    select: { id: true, taskId: true, dealId: true, filename: true, mime: true, size: true, sha256: true, uploaderId: true, createdAt: true },
  })
  if (!doc) return null
  if (doc.taskId) {
    const task = await canSeeTaskRecord(doc.taskId, userId)
    if (task) return doc
  }
  if (doc.dealId) {
    const deal = await canSeeDeal(doc.dealId, userId)
    if (deal) return doc
  }
  return null
}
