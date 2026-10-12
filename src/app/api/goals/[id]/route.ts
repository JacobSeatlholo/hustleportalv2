import { db } from '@/lib/db'
import { fail, num, ok, optDate, parseBody, str } from '@/lib/api'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const body = await parseBody(req)
  const existing = await db.goal.findUnique({ where: { id } })
  if (!existing) return fail('Goal not found', 404)
  const data: Record<string, unknown> = {}
  if (body.title !== undefined) data.title = str(body.title).trim() || existing.title
  if (body.metric !== undefined) data.metric = str(body.metric, existing.metric)
  if (body.targetValue !== undefined) data.targetValue = num(body.targetValue)
  if (body.currentValue !== undefined) data.currentValue = num(body.currentValue)
  if (body.period !== undefined) data.period = str(body.period, existing.period)
  if (body.deadline !== undefined) data.deadline = optDate(body.deadline)
  if (body.status !== undefined) data.status = str(body.status, existing.status)
  const goal = await db.goal.update({ where: { id }, data })
  return ok(goal)
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const existing = await db.goal.findUnique({ where: { id } })
  if (!existing) return fail('Goal not found', 404)
  await db.goal.delete({ where: { id } })
  return ok({ deleted: id })
}
