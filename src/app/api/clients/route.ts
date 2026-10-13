import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'
import { resolveProject } from '@/lib/workspace'

// GET /api/clients?projectId= → list clients (own)
// projectId narrows the list to one workspace; projectId=ALL (or omitted) keeps the classic mixed view.
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const projectId = new URL(req.url).searchParams.get('projectId') || ''
  const where: Record<string, unknown> = { userId }
  if (projectId && projectId !== 'ALL') {
    const project = await resolveProject(userId, projectId)
    if (project.id !== projectId) return NextResponse.json({ error: 'Unknown project.' }, { status: 404 })
    where.projectId = projectId
  }
  const clients = await db.client.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ clients })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { name, company, email, phone, notes, monthlyValue, projectId } = body || {}
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Client name is required.' }, { status: 400 })
  }
  // Every client belongs to a workspace. Explicit projectId wins (validated against
  // the owner), otherwise the client lands in the active/default workspace.
  const project = await resolveProject(userId, projectId ?? null)
  const client = await db.client.create({
    data: {
      userId,
      projectId: project.id,
      name: String(name).trim(),
      company: company || null,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
      monthlyValue: Number(monthlyValue) || 0,
    },
  })
  await bumpChallenge(userId, 'add_client')
  return NextResponse.json({ client })
}
