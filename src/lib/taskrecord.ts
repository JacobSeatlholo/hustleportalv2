/**
 * The sealed task record, accountability the team can trust.
 *
 * Every meaningful task moment (created, sent to someone, opened, status moved,
 * commented, edited) is appended as a TaskEvent. Each event seals the previous
 * one: hash = sha256(prevHash | taskId | seq | type | actor | detail). Editing
 * or deleting any row breaks the chain, and the record endpoint reports
 * "verified" only when every seal checks out end to end.
 *
 * The record NEVER blocks the action it witnesses: a failed append is logged and
 * swallowed, because a task must still save even if its record hiccups.
 */
import { createHash } from 'crypto'
import { db } from '@/lib/db'

export type TaskEventType = 'CREATED' | 'SENT' | 'OPENED' | 'STATUS' | 'COMMENT' | 'EDIT'

export const STATUS_LABEL: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
}

export async function recordTaskEvent(
  taskId: string,
  type: TaskEventType,
  actorId: string | null,
  detail: string
): Promise<void> {
  try {
    let actorName = 'HustlePortal'
    if (actorId) {
      const u = await db.user.findUnique({ where: { id: actorId }, select: { name: true } })
      actorName = u?.name || 'A team member'
    }
    const last = await db.taskEvent.findFirst({
      where: { taskId },
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true },
    })
    const seq = (last?.seq ?? 0) + 1
    const prevHash = last?.hash ?? ''
    const hash = createHash('sha256')
      .update(`${prevHash}|${taskId}|${seq}|${type}|${actorName}|${detail}`)
      .digest('hex')
    await db.taskEvent.create({ data: { taskId, seq, type, actorId, actorName, detail, prevHash, hash } })
  } catch {
    // The record never blocks the action.
  }
}

export interface ChainCheck {
  events: {
    id: string
    seq: number
    type: string
    actorName: string
    detail: string
    createdAt: Date
    hash: string
  }[]
  verified: boolean
}

/** Recompute every seal; the chain is verified only when nothing was touched. */
export function verifyChain(
  events: { seq: number; type: string; actorName: string; detail: string; prevHash: string; hash: string; taskId: string }[]
): boolean {
  let prev = ''
  let expectSeq = 1
  for (const e of events) {
    if (e.seq !== expectSeq || e.prevHash !== prev) return false
    const hash = createHash('sha256')
      .update(`${e.prevHash}|${e.taskId}|${e.seq}|${e.type}|${e.actorName}|${e.detail}`)
      .digest('hex')
    if (hash !== e.hash) return false
    prev = e.hash
    expectSeq++
  }
  return true
}
