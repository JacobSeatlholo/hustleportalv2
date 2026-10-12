import { db } from '@/lib/db'
import { bool, fail, num, ok, optDate, optId, parseBody, str } from '@/lib/api'

export async function GET() {
  const entries = await db.timeEntry.findMany({
    orderBy: { date: 'desc' },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
  })
  return ok(entries)
}

export async function POST(req: Request) {
  const body = await parseBody(req)
  const description = str(body.description).trim()
  if (!description) return fail('Description is required')
  const entry = await db.timeEntry.create({
    data: {
      description,
      minutes: Math.max(0, Math.round(num(body.minutes))),
      billable: bool(body.billable, true),
      hourlyRate: num(body.hourlyRate),
      date: optDate(body.date) ?? new Date(),
      clientId: optId(body.clientId),
      projectId: optId(body.projectId),
    },
  })
  return ok(entry, 201)
}
