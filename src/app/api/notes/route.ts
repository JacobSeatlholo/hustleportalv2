import { db } from '@/lib/db'
import { bool, fail, ok, optStr, parseBody, str } from '@/lib/api'

export async function GET() {
  const notes = await db.note.findMany({ orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }] })
  return ok(notes)
}

export async function POST(req: Request) {
  const body = await parseBody(req)
  const title = str(body.title).trim()
  if (!title) return fail('Note title is required')
  const note = await db.note.create({
    data: {
      title,
      content: str(body.content),
      color: str(body.color, 'default'),
      pinned: bool(body.pinned),
    },
  })
  return ok(note, 201)
}
