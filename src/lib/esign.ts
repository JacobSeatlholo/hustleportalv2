// ============ FIRST-PARTY E-SIGN ENGINE (Task 212) ============
// Open-source replacement for DocuSign — the whole signing flow is our own:
//   1. Deal room creates a session (unguessable token) for a private-docs PDF.
//   2. Signer opens /sign/<token> (token = the secret), reviews the PDF,
//      draws their signature on a canvas and consents.
//   3. We stamp the signature + execution block onto the last page, append a
//      certificate page with the full audit trail (SHA-256 of original and
//      signed bytes, IPs, timestamps SAST), store the signed PDF in Postgres
//      and email the signer their copy link.
// Legal basis: Electronic Communications and Transactions Act 25 of 2002 (SA)
// gives legal effect to ordinary electronic signatures. Everything runs on our
// own infrastructure — no third-party signing service, no per-envelope fees.
import { randomBytes, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'
import { PRIVATE_DOCS_DIR, findPartnerDoc } from '@/lib/partnerDocs'
// Static import — a dynamic import here resolved fine in dev but broke module
// resolution in the serverless bundle (Task 214: sessions pointed at uploaded
// DocFiles 404'd as 'Document missing'). Server-only module, so this is safe.
import { db } from '@/lib/db'

export function newSigningToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sha256hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** South Africa Standard Time rendering for stamps and certificates. */
export function sast(dt: Date): string {
  return `${dt.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })} SAST`
}

/**
 * Read an allowed private-docs PDF. Double-checks the allowlist so only the
 * deal-room documents can ever be stamped into a session.
 */
export async function loadOriginalPdf(docBase: string): Promise<{ bytes: Buffer; title: string }> {
  const doc = findPartnerDoc(docBase)
  if (!doc || doc.base !== docBase || !docBase.toLowerCase().endsWith('.pdf')) {
    throw new Error(`Unknown document: ${docBase}`)
  }
  const bytes = await readFile(path.join(PRIVATE_DOCS_DIR, docBase))
  return { bytes, title: ascii(doc.title) }
}

/**
 * Original bytes for a signing session: an uploaded DocFile (platform deal
 * room, Task 213) or an allowlisted private-docs PDF (partner doors). The
 * session record decides which source applies.
 */
export async function loadSessionOriginal(session: { docBase: string; docFileId: string | null }): Promise<{ bytes: Buffer; title: string; filename: string }> {
  if (session.docFileId) {
    const f = await db.docFile.findUnique({ where: { id: session.docFileId } })
    if (!f) throw new Error(`Missing document: ${session.docBase}`)
    return {
      bytes: Buffer.from(f.bytes),
      title: ascii(f.filename.replace(/\.pdf$/i, '')),
      filename: f.filename,
    }
  }
  const { bytes, title } = await loadOriginalPdf(session.docBase)
  return { bytes, title, filename: session.docBase }
}

/** pdf-lib standard fonts are WinAnsi — keep stamps/certificates ASCII-only. */
function ascii(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
}

/** Naive word-wrap for the certificate page, with hard-split for unbroken
 * runs (SHA-256 hashes are 64 chars with no spaces and must wrap by character). */
function wrap(text: string, maxChars: number): string[] {
  const words = ascii(text).split(/\s+/)
  const lines: string[] = []
  for (const w of words) {
    if (w.length > maxChars) {
      // hard chunk long unbroken tokens (hashes, URLs)
      for (let i = 0; i < w.length; i += maxChars) lines.push(w.slice(i, i + maxChars))
      continue
    }
    const prev = lines.length ? lines[lines.length - 1] : ''
    if (prev && (prev + ' ' + w).length <= maxChars) {
      lines[lines.length - 1] = prev + ' ' + w
    } else {
      lines.push(w)
    }
  }
  return lines
}

function drawLines(page: PDFPage, lines: string[], x: number, startY: number, font: PDFFont, size: number, gap: number, color = rgb(0, 0, 0)): number {
  let y = startY
  for (const line of lines) {
    page.drawText(line, { x, y, size, font, color })
    y -= gap
  }
  return y
}

export interface StampInput {
  originalBytes: Buffer
  docTitle: string
  sigPngBase64: string // raw base64 (no data: prefix) of the drawn signature
  initialsPngBase64?: string // raw base64 of the drawn initials — stamped on EVERY original page (Task 214)
  typedName: string
  typedFields?: Array<{ label: string; value: string }> // typed info rendered in the execution block (Task 215)
  signerEmail: string
  sessionId: string
  signerIp: string
  userAgent: string
  originalSha256: string
  viewedAt: Date | null
  signedAt: Date
}

export interface StampResult {
  bytes: Uint8Array
  signedSha256: string
}

/**
 * Append the Certificate of Electronic Signature page: the drawn signature
 * and /s/ execution block at the top, full audit trail below, and save the
 * signed PDF.
 */
export async function stampSignedPdf(input: StampInput): Promise<StampResult> {
  const pdf = await PDFDocument.load(input.originalBytes)
  const black = rgb(0, 0, 0)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // --- per-page initials (Task 214) ---
  // When the signer draws initials, every page of the ORIGINAL document gets
  // them bottom-right with a timestamp caption — the counter-execution move
  // for entity-to-entity agreements where each party initials every page.
  // Applied before the certificate page is appended: the certificate itself
  // is not initialled, it RECORDS the initialling in the audit trail.
  let initialsApplied = false
  if (input.initialsPngBase64) {
    let init: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null
    try {
      init = await pdf.embedPng(Buffer.from(input.initialsPngBase64, 'base64'))
    } catch {
      init = null // a broken initials image must not block signing
    }
    if (init) {
      const iw = 64
      const ih = Math.min(28, iw * (init.height / init.width))
      for (const page of pdf.getPages()) {
        const { width } = page.getSize()
        page.drawImage(init, { x: width - 57 - iw, y: 40, width: iw, height: ih })
        page.drawText(ascii(`Initials - ${sast(input.signedAt)}`), {
          x: width - 57 - iw,
          y: 28,
          size: 6,
          font,
          color: rgb(0.45, 0.45, 0.45),
        })
      }
      initialsApplied = true
    }
  }

  // --- execution block ON THE CERTIFICATE PAGE (Task 212b) ---
  // The last page's layout differs per document (the strategist agreement's
  // signature table sits low on its final page), so fixed coordinates on the
  // document page risk overlapping printed text. Instead the drawn signature
  // and execution details live at the top of the appended certificate page —
  // deterministic, collision-free, and part of the same signed file.
  const cert = pdf.addPage([595.28, 841.89])
  let png: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null
  try {
    png = await pdf.embedPng(Buffer.from(input.sigPngBase64, 'base64'))
  } catch {
    png = null // a broken image must not block signing — the typed name still executes
  }

  // --- certificate page: signature + execution block, then the audit trail ---
  let cy = 800
  cy = drawLines(cert, ['CERTIFICATE OF ELECTRONIC SIGNATURE'], 57, cy, bold, 16, 22)
  cert.drawLine({ start: { x: 57, y: cy + 8 }, end: { x: 538, y: cy + 8 }, thickness: 1, color: black })
  cy -= 20
  if (png) {
    const w = 180
    const h = Math.min(56, w * (png.height / png.width))
    cert.drawImage(png, { x: 57, y: cy - h, width: w, height: h })
    cy -= h + 14
  }
  cert.drawText(`/s/ ${ascii(input.typedName)}`, { x: 57, y: cy, size: 12, font: bold, color: black })
  cy -= 14
  cert.drawText(ascii(`Electronically signed by ${input.typedName} <${input.signerEmail}>`), { x: 57, y: cy, size: 9, font, color: black })
  cy -= 13
  cert.drawText(ascii(`${sast(input.signedAt)} - Business Hustle e-sign (first-party), session ${input.sessionId}`), { x: 57, y: cy, size: 9, font, color: black })
  cy -= 26
  // Typed info the signer entered on the signing page (Task 215) — rendered
  // into the execution block so what they typed is part of the executed file.
  const infoFields: Array<[string, string]> = (input.typedFields || [])
    .filter((f) => f.label.trim() && f.value.trim())
    .map((f) => [ascii(f.label.trim()).slice(0, 60), ascii(f.value.trim()).slice(0, 200)])
  for (const [label, value] of infoFields) {
    cert.drawText(`${label}:`, { x: 57, y: cy, size: 10, font: bold, color: black })
    cert.drawText(value, { x: 210, y: cy, size: 10, font, color: black })
    cy -= 16
  }
  if (infoFields.length) cy -= 10
  const fields: Array<[string, string]> = [
    ['Document', input.docTitle],
    ['Signer', `${input.typedName} <${input.signerEmail}>`],
    ['Session', input.sessionId],
    ['Link opened', input.viewedAt ? `${sast(input.viewedAt)} from IP ${input.signerIp || 'unknown'}` : 'not recorded'],
    ['Signature executed', `${sast(input.signedAt)} from IP ${input.signerIp || 'unknown'}`],
    ['Page initials', initialsApplied ? 'applied to every page of the document before execution' : input.initialsPngBase64 ? 'provided but not embeddable, not applied' : 'not requested'],
    ['Device (user agent)', (input.userAgent || 'unknown').slice(0, 120)],
    ['SHA-256 (original)', input.originalSha256 || 'not recorded'],
    ['SHA-256 (signed)', 'stored in the signing session record and shown on the signing page'],
  ]
  for (const [label, value] of fields) {
    cert.drawText(`${label}:`, { x: 57, y: cy, size: 9, font: bold, color: black })
    const vlines = wrap(value, 72)
    let vy = cy
    for (const vl of vlines) {
      cert.drawText(vl, { x: 210, y: vy, size: 9, font, color: black })
      vy -= 12
    }
    cy = vy - 8
  }
  cy -= 8
  const statement =
    'This certificate was generated by Business Hustle e-sign, a first-party electronic signing ' +
    'system operated by the document owner on its own infrastructure. The signer reviewed the ' +
    'document' + (initialsApplied ? ', initialled every page' : '') + ', drew their signature and confirmed consent to be bound by an electronic ' +
    'signature, which has legal effect under the Electronic Communications and Transactions ' +
    'Act 25 of 2002 of South Africa. The signed file and this audit trail are retained in the ' +
    'operator\u2019s records.'
  drawLines(cert, wrap(statement, 92), 57, cy, font, 9, 12)
  cert.drawText(ascii(`Business Hustle e-sign - ${sast(input.signedAt)}`), { x: 57, y: 60, size: 8, font, color: rgb(0.4, 0.4, 0.4) })

  const bytes = await pdf.save()
  return { bytes, signedSha256: sha256hex(bytes) }
}
