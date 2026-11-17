import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { sha256hex } from '@/lib/esign'
import { canSeeDeal, canSeeTaskRecord, MAX_DOC_BYTES } from '@/lib/dealroom'

// ============ DOCUMENTS on tasks and deals (Task 213) ============
// POST   multipart: file (PDF, ≤10MB) + taskId or dealId → stored in Postgres,
//        sha256 pinned at upload so a signed session always points at exactly
//        the bytes that were sent.
// GET    ?taskId=|dealId= → doc metadata + their signing sessions (no bytes).

export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const taskId = url.searchParams.get('taskId')
  const dealId = url.searchParams.get('dealId')
  if (!taskId === !dealId) {
    return NextResponse.json({ error: 'Pass exactly one of taskId or dealId.' }, { status: 400 })
  }

  if (taskId) {
    const task = await canSeeTaskRecord(taskId, userId)
    if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
  } else {
    const deal = await canSeeDeal(dealId as string, userId)
    if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 })
  }

  const docs = await db.docFile.findMany({
    where: taskId ? { taskId } : { dealId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, filename: true, size: true, sha256: true, uploaderId: true,
      createdAt: true, taskId: true, dealId: true,
    },
  })
  const docIds = docs.map((d) => d.id)
  const sessions = docIds.length
    ? await db.esignSession.findMany({
        where: { docFileId: { in: docIds } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, token: true, docFileId: true, docTitle: true, signerName: true,
          signerEmail: true, status: true, sentVia: true, createdAt: true, viewedAt: true, signedAt: true,
        },
      })
    : []
  return NextResponse.json({ docs, sessions }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Send the document as multipart form data.' }, { status: 400 })
  }
  const file = form.get('file')
  const taskId = (form.get('taskId') as string) || ''
  const dealId = (form.get('dealId') as string) || ''
  if (Boolean(taskId) === Boolean(dealId)) {
    return NextResponse.json({ error: 'Attach to exactly one of taskId or dealId.' }, { status: 400 })
  }
  if (taskId) {
    const task = await canSeeTaskRecord(taskId, userId)
    if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
  } else {
    const deal = await canSeeDeal(dealId, userId)
    if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file received.' }, { status: 400 })
  }
  const name = (file.name || 'document.pdf').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 200)
  if (!name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Upload a PDF — that is what the signing engine stamps.' }, { status: 400 })
  }
  if (file.size > MAX_DOC_BYTES) {
    return NextResponse.json({ error: 'That PDF is over the 10 MB limit.' }, { status: 400 })
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length === 0) {
    return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
  }

  const doc = await db.docFile.create({
    data: {
      taskId: taskId || null,
      dealId: dealId || null,
      filename: name,
      mime: 'application/pdf',
      size: bytes.length,
      bytes,
      sha256: sha256hex(bytes),
      uploaderId: userId,
    },
    select: { id: true, filename: true, size: true, sha256: true, createdAt: true, taskId: true, dealId: true },
  })
  return NextResponse.json({ doc }, { status: 201 })
}
