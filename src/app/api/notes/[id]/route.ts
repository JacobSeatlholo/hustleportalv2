import { db } from '@/lib/db'
import { bool, fail, ok, parseBody, str } from '@/lib/api'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const body = await parseBody(req)
  const existing = await db.note.findUnique({ where: { id } })
  if (!existing) return fail('Note not found', 404)
  const data: Record<string, unknown> = {}
  if (body.title !== undefined) data.title = str(body.title).trim() || existing.title
  if (body.content !== undefined) data.content = str(body.content)
  if (body.color !== undefined) data.color = str(body.color, existing.color)
  if (body.pinned !== undefined) data.pinned = bool(body.pinned)
  const note = await db.note.update({ where: { id }, data })
  return ok(note)
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const existing = await db.note.findUnique({ where: { id } })
  if (!existing) return fail('Note not found', 404)
  await db.note.delete({ where: { id } })
  return ok({ deleted: id })
}
