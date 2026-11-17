import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getStrategist } from '@/lib/corporate'
import { checkDocsKey } from '@/lib/partnerDocs'
import { sha256hex } from '@/lib/esign'

// ============ PARTNER ROOM: UPLOAD A DOCUMENT TO SIGN (Task 215) ============
// POST multipart (gate key) with a `file` field → stored as a DocFile in
// Postgres, ready for /api/corporate/<slug>/esign with its docFileId. This is
// the counter-signature path: the other party's executed PDF (e.g. the
// Trinity agreement signed by Kelo) is loaded here and counter-signed with
// initials on every page, typed info and a first-party certificate.
// The uploader of record is the first ADMIN account (the operator) — the
// partner room is gate-key'd, not logged-in, and the bytes must belong to a
// user for the platform's DocFile relations.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB, matching the platform deal room

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const key = new URL(req.url).searchParams.get('key') || ''
  if (!checkDocsKey(key) || !getStrategist(slug)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Send the document as multipart form data.' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file received.' }, { status: 400 })
  }
  const name = (file.name || 'document.pdf').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 200)
  if (!name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Upload a PDF — that is what the signing engine stamps.' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'That PDF is over the 10 MB limit.' }, { status: 400 })
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length === 0) {
    return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
  }
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return NextResponse.json({ error: 'That file is not a valid PDF.' }, { status: 400 })
  }

  const uploader = await db.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } })
  if (!uploader) {
    return NextResponse.json({ error: 'No operator account found to hold the upload.' }, { status: 500 })
  }

  const doc = await db.docFile.create({
    data: {
      filename: name,
      mime: 'application/pdf',
      size: bytes.length,
      bytes,
      sha256: sha256hex(bytes),
      uploaderId: uploader.id,
    },
    select: { id: true, filename: true, size: true, sha256: true, createdAt: true },
  })
  return NextResponse.json({ doc }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
