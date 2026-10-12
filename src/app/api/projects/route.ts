import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { listProjects, getOrCreateDefaultProject } from '@/lib/workspace'

// GET /api/projects → the user's company workspaces (default first, with counts)
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await getOrCreateDefaultProject(userId) // always at least "My Business"
  const projects = await listProjects(userId)
  return NextResponse.json({ projects })
}

// POST /api/projects → create an additional company workspace
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Workspace name is required.' }, { status: 400 })
  const project = await db.project.create({
    data: {
      userId,
      name,
      description: body.description || null,
      industry: body.industry || null,
      valueProp: body.valueProp || null,
      targetMarket: body.targetMarket || null,
      offerings: body.offerings || null,
      tone: body.tone || null,
      website: body.website || null,
      contactEmail: body.contactEmail || null,
      contactPhone: body.contactPhone || null,
    },
  })
  return NextResponse.json({ project }, { status: 201 })
}
