import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

async function ownProject(id: string, userId: string) {
  return db.project.findFirst({ where: { id, userId } })
}

// GET → the project's assigned members
export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const project = await db.project.findFirst({ where: { id, userId } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const members = await db.projectMember.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      name: m.user.name,
      email: m.user.email,
    })),
  })
}

// POST { userId } → assign a teammate to this project (owner only)
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const project = await ownProject(id, userId)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const memberId = String(body.userId || '')
  if (!memberId) return NextResponse.json({ error: 'Pick a teammate to assign.' }, { status: 400 })
  if (memberId === userId) return NextResponse.json({ error: 'You already own this project.' }, { status: 400 })
  const person = await db.user.findUnique({ where: { id: memberId }, select: { id: true, name: true } })
  if (!person) return NextResponse.json({ error: 'That person has no HustlePortal account yet.' }, { status: 404 })
  const member = await db.projectMember.upsert({
    where: { projectId_userId: { projectId: id, userId: memberId } },
    create: { projectId: id, userId: memberId, addedById: userId },
    update: {},
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  return NextResponse.json(
    {
      member: { id: member.id, userId: member.userId, role: member.role, name: member.user.name, email: member.user.email },
    },
    { status: 201 },
  )
}

// DELETE ?userId= → remove a teammate from this project (owner only)
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const project = await ownProject(id, userId)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const memberId = new URL(req.url).searchParams.get('userId') || ''
  if (!memberId) return NextResponse.json({ error: 'userId is required.' }, { status: 400 })
  await db.projectMember.deleteMany({ where: { projectId: id, userId: memberId } })
  return NextResponse.json({ ok: true })
}
