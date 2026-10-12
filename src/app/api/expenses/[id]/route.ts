import { db } from '@/lib/db'
import { bool, fail, num, ok, optDate, optId, optStr, parseBody, str } from '@/lib/api'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const body = await parseBody(req)
  const existing = await db.expense.findUnique({ where: { id } })
  if (!existing) return fail('Expense not found', 404)
  const expense = await db.expense.update({
    where: { id },
    data: {
      description: body.description !== undefined ? str(body.description).trim() || existing.description : undefined,
      category: body.category !== undefined ? str(body.category, existing.category) : undefined,
      amount: body.amount !== undefined ? num(body.amount) : undefined,
      date: body.date !== undefined ? optDate(body.date) ?? existing.date : undefined,
      vendor: body.vendor !== undefined ? optStr(body.vendor) : undefined,
      method: body.method !== undefined ? str(body.method, existing.method) : undefined,
      recurring: body.recurring !== undefined ? bool(body.recurring) : undefined,
      billable: body.billable !== undefined ? bool(body.billable) : undefined,
      projectId: body.projectId !== undefined ? optId(body.projectId) : undefined,
    },
  })
  return ok(expense)
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const existing = await db.expense.findUnique({ where: { id } })
  if (!existing) return fail('Expense not found', 404)
  await db.expense.delete({ where: { id } })
  return ok({ deleted: id })
}
