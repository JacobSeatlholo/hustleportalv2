import { db } from '@/lib/db'
import { bool, fail, num, ok, optDate, optId, optStr, parseBody, str } from '@/lib/api'

export async function GET() {
  const expenses = await db.expense.findMany({
    orderBy: { date: 'desc' },
    include: { project: { select: { id: true, name: true } } },
  })
  return ok(expenses)
}

export async function POST(req: Request) {
  const body = await parseBody(req)
  const description = str(body.description).trim()
  if (!description) return fail('Description is required')
  const expense = await db.expense.create({
    data: {
      description,
      category: str(body.category, 'OTHER'),
      amount: num(body.amount),
      date: optDate(body.date) ?? new Date(),
      vendor: optStr(body.vendor),
      method: str(body.method, 'CARD'),
      recurring: bool(body.recurring),
      billable: bool(body.billable),
      projectId: optId(body.projectId),
    },
  })
  return ok(expense, 201)
}
