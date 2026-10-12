import { db } from '@/lib/db'
import { fail, num, ok, optDate, parseBody, str } from '@/lib/api'

export async function GET() {
  const goals = await db.goal.findMany({ orderBy: { createdAt: 'desc' } })
  return ok(goals)
}

export async function POST(req: Request) {
  const body = await parseBody(req)
  const title = str(body.title).trim()
  if (!title) return fail('Goal title is required')
  const goal = await db.goal.create({
    data: {
      title,
      metric: str(body.metric, 'REVENUE'),
      targetValue: num(body.targetValue),
      currentValue: num(body.currentValue),
      period: str(body.period, 'MONTHLY'),
      deadline: optDate(body.deadline),
      status: str(body.status, 'ACTIVE'),
    },
  })
  return ok(goal, 201)
}
