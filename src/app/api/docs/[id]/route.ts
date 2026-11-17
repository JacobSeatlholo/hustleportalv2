import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { canSeeDoc } from '@/lib/dealroom'

// ============ DOCUMENT DELETE (Task 213) ============
// DELETE /api/docs/<id> → uploader, task creator/assignee or deal owner only;
// blocked once a signing session exists (signed records must stay intact).

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const meta = await canSeeDoc(id, userId)
  if (!meta) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })

  const sessions = await db.esignSession.count({ where: { docFileId: id } })
  if (sessions > 0) {
    return NextResponse.json(
      { error: 'This document has signing sessions, so it stays as part of the record.' },
      { status: 409 },
    )
  }
  // Only people who can manage the parent may remove the file: the uploader,
  // or the owner/creator/assignee of the parent task or deal.
  const allowed =
    meta.uploaderId === userId ||
    (await db.docFile.findFirst({
      where: {
        id,
        OR: [
          { task: { OR: [{ creatorId: userId }, { assigneeId: userId }] } },
          { deal: { OR: [{ ownerId: userId }, { creatorId: userId }] } },
        ],
      },
      select: { id: true },
    }))
  if (!allowed) return NextResponse.json({ error: 'You cannot delete this document.' }, { status: 403 })

  await db.docFile.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
