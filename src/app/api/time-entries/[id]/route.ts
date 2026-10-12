import { db } from '@/lib/db'
import { bool, fail, num, ok, optDate, optId, parseBody, str } from '@/lib/api'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const body = await parseBody(req)
  const existing = await db.timeEntry.findUnique({ where: { id } })
  if (!existing) return fail('Time entry not found', 404)
  const entry = await db.timeEntry.update({
    where: { id },
    data: {
      description: body.description !== undefined ? str(body.description).trim() || existing.description : undefined,
      minutes: body.minutes !== undefined ? Math.max(0, Math.round(num(body.minutes))) : undefined,
      billable: body.billable !== undefined ? bool(body.billable, true) : undefined,
      hourlyRate: body.hourlyRate !== undefined ? num(body.hourlyRate) : undefined,
      date: body.date !== undefined ? optDate(body.date) ?? existing.date : undefined,
      clientId: body.clientId !== undefined ? optId(body.clientId) : undefined,
      projectId: body.projectId !== undefined ? optId(body.projectId) : undefined,
    },
  })
  return ok(entry)
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const existing = await db.timeEntry.findUnique({ where: { id } })
  if (!existing) return fail('Time entry not found', 404)
  await db.timeEntry.delete({ where: { id } })
  return ok({ deleted: id })
}
