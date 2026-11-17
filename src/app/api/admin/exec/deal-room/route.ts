import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireExec } from '@/lib/admin'
import { sha256hex, newSigningToken } from '@/lib/esign'
import { sendSystemMail } from '@/lib/mailer'
import { MAX_DOC_BYTES, DEAL_STAGES } from '@/lib/dealroom'

// ============ EXEC DEAL-ROOM SEED (Task 214) ============
// Loads a real-world partnership straight into the owner's in-platform deal
// room: create the deal for a given user, attach the uploaded PDFs, and open
// the first signing session (initials-per-page capable) on one of them.
// Exec-gated like every other /api/admin/exec route — the operator seat runs
// it, the deal lands owned by the named account so it shows in THEIR Deals tab.
//
// GET    ?email=...          → resolve a user (id, name, email) for ownerEmail
// POST   multipart           → seed the deal + docs + optional signing session
// PATCH  { dealId, ownerEmail } → move the deal to another owner
// DELETE ?dealId=            → exec-only cleanup, sessions included (QA hygiene;
//                              user-facing deletes stay blocked by the records law)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s]+$/

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const email = (new URL(req.url).searchParams.get('email') || '').toLowerCase().trim()
  if (!email) return NextResponse.json({ error: 'Pass ?email= to resolve.' }, { status: 400 })
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, accountStatus: true },
  })
  return NextResponse.json({ user: user || null })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Send multipart form data.' }, { status: 400 })
  }
  const ownerEmail = String(form.get('ownerEmail') || '').toLowerCase().trim()
  const title = String(form.get('title') || '').trim()
  const company = String(form.get('company') || '').trim()
  const contactName = String(form.get('contactName') || '').trim()
  if (!EMAIL_RE.test(ownerEmail) || !title || !company || !contactName) {
    return NextResponse.json({ error: 'ownerEmail, title, company and contactName are required.' }, { status: 400 })
  }
  const owner = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true, name: true, email: true } })
  if (!owner) return NextResponse.json({ error: `No account for ${ownerEmail}.` }, { status: 404 })

  const contactEmail = String(form.get('contactEmail') || '').trim() || null
  const contactPhone = String(form.get('contactPhone') || '').trim() || null
  const valueRaw = String(form.get('value') || '').trim()
  const value = valueRaw ? Number(valueRaw) : null
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    return NextResponse.json({ error: 'value must be a number in rands.' }, { status: 400 })
  }
  const stageRaw = String(form.get('stage') || 'LEAD')
  const stage = DEAL_STAGES.includes(stageRaw as (typeof DEAL_STAGES)[number]) ? stageRaw : 'LEAD'
  const notes = String(form.get('notes') || '').trim().slice(0, 4000) || null

  const deal = await db.deal.create({
    data: {
      title: title.slice(0, 160),
      company: company.slice(0, 160),
      contactName: contactName.slice(0, 120),
      contactEmail,
      contactPhone,
      value,
      stage,
      notes,
      ownerId: owner.id,
      creatorId: owner.id,
      teamId: null,
    },
  })

  // Attach every uploaded PDF to the deal.
  const files = form.getAll('file').filter((f): f is File => f instanceof File)
  const createdDocs: { id: string; filename: string; sha256: string }[] = []
  for (const file of files) {
    const name = (file.name || 'document.pdf').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 200)
    if (!name.toLowerCase().endsWith('.pdf')) continue
    if (file.size > MAX_DOC_BYTES) continue
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length === 0) continue
    const doc = await db.docFile.create({
      data: {
        dealId: deal.id,
        filename: name,
        mime: 'application/pdf',
        size: bytes.length,
        bytes,
        sha256: sha256hex(bytes),
        uploaderId: gate.me.id,
      },
    })
    createdDocs.push({ id: doc.id, filename: name, sha256: doc.sha256 })
  }

  // Optional: open the first signing session on one of the attached docs.
  const signDocFilename = String(form.get('signDocFilename') || '').trim()
  const signerName = String(form.get('signerName') || '').trim()
  const signerEmail = String(form.get('signerEmail') || '').trim()
  let session: { token: string; url: string; emailed: boolean; emailError?: string } | null = null
  if (signDocFilename && signerName && signerEmail) {
    const doc = createdDocs.find((d) => d.filename === signDocFilename)
    if (!EMAIL_RE.test(signerEmail)) {
      return NextResponse.json({ error: 'signerEmail does not look valid.', dealId: deal.id, docs: createdDocs }, { status: 400 })
    }
    if (!doc) {
      return NextResponse.json({ error: `signDocFilename ${signDocFilename} was not among the uploads.`, dealId: deal.id, docs: createdDocs }, { status: 400 })
    }
    const docTitle = doc.filename.replace(/\.pdf$/i, '')
    const token = newSigningToken()
    const created = await db.esignSession.create({
      data: {
        token,
        slug: 'platform',
        docBase: doc.filename,
        docTitle,
        docFileId: doc.id,
        signerName: signerName.slice(0, 120),
        signerEmail: signerEmail.slice(0, 200),
        originalSha256: doc.sha256,
      },
    })
    const origin = `${new URL(req.url).protocol}//${new URL(req.url).host}`
    const signUrl = `${origin}/sign/${token}`
    const mail = await sendSystemMail({
      to: signerEmail,
      subject: `Signature request: ${docTitle}`,
      body: `Hi ${signerName},\n\nThe document "${docTitle}" is ready for your signature.\n\nOpen your signing page, review the document, initial each page if the agreement calls for it, and draw your signature:\n${signUrl}\n\nThe signed copy and a certificate of electronic signature are generated automatically when you sign.`,
      title: docTitle,
      headline: 'Signature requested',
      ctaLabel: 'Review and sign',
      ctaUrl: signUrl,
      preheader: 'One document is waiting for your signature',
    })
    if (mail.ok) {
      await db.esignSession.update({ where: { id: created.id }, data: { sentVia: 'email', linkSentAt: new Date() } })
    }
    session = { token, url: signUrl, emailed: mail.ok, emailError: mail.ok ? undefined : mail.error }
  }

  return NextResponse.json(
    { ok: true, deal, docs: createdDocs, session, owner: { id: owner.id, name: owner.name, email: owner.email } },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function PATCH(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const body = (await req.json().catch(() => null)) as { dealId?: string; ownerEmail?: string } | null
  if (!body?.dealId || !body.ownerEmail) {
    return NextResponse.json({ error: 'dealId and ownerEmail are required.' }, { status: 400 })
  }
  const owner = await db.user.findUnique({
    where: { email: body.ownerEmail.toLowerCase().trim() },
    select: { id: true },
  })
  if (!owner) return NextResponse.json({ error: 'No account for that email.' }, { status: 404 })
  const deal = await db.deal.update({
    where: { id: body.dealId },
    data: { ownerId: owner.id, teamId: null },
  })
  return NextResponse.json({ ok: true, dealId: deal.id, ownerId: owner.id })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res
  const dealId = new URL(req.url).searchParams.get('dealId') || ''
  if (!dealId) return NextResponse.json({ error: 'Pass ?dealId=.' }, { status: 400 })
  // Exec cleanup: sessions and their signed bytes go with the deal. This is
  // the operator's QA hygiene lever, not a user-facing delete.
  await db.esignSession.deleteMany({ where: { docFile: { dealId } } })
  await db.docFile.deleteMany({ where: { dealId } })
  await db.task.updateMany({ where: { dealId }, data: { dealId: null } })
  await db.deal.delete({ where: { id: dealId } })
  return NextResponse.json({ ok: true })
}
