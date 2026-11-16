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
  typedName: string
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
 * Stamp the signature onto the last page (image + /s/ execution block) and
 * append a Certificate of Electronic Signature page with the audit trail.
 */
export async function stampSignedPdf(input: StampInput): Promise<StampResult> {
  const pdf = await PDFDocument.load(input.originalBytes)
  const pages = pdf.getPages()
  const last = pages[pages.length - 1]
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const black = rgb(0, 0, 0)

  // --- execution block on the last page, bottom-left ---
  // Geometry: signature image sits ABOVE the /s/ line; the detail lines run
  // BELOW it, all at fixed baselines so nothing overlaps (image spans
  // y=140..140+h, /s/ at 128, email at 114, session line at 102).
  const x = 57
  const y = 128
  let png: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null
  try {
    png = await pdf.embedPng(Buffer.from(input.sigPngBase64, 'base64'))
  } catch {
    png = null // a broken image must not block signing — the typed name still executes
  }
  if (png) {
    const w = 170
    const h = Math.min(56, w * (png.height / png.width))
    last.drawImage(png, { x, y: y + 12, width: w, height: h })
  }
  last.drawText(`/s/ ${ascii(input.typedName)}`, { x, y, size: 12, font: bold, color: black })
  last.drawText(ascii(`Electronically signed by ${input.typedName} <${input.signerEmail}>`), {
    x, y: y - 14, size: 8.5, font, color: black,
  })
  last.drawText(ascii(`${sast(input.signedAt)} - HustlePortal e-sign (first-party), session ${input.sessionId}`), {
    x, y: y - 26, size: 8.5, font, color: black,
  })

  // --- certificate page ---
  const cert = pdf.addPage([595.28, 841.89])
  let cy = 800
  cy = drawLines(cert, ['CERTIFICATE OF ELECTRONIC SIGNATURE'], 57, cy, bold, 16, 22)
  cert.drawLine({ start: { x: 57, y: cy + 8 }, end: { x: 538, y: cy + 8 }, thickness: 1, color: black })
  cy -= 24
  const fields: Array<[string, string]> = [
    ['Document', input.docTitle],
    ['Signer', `${input.typedName} <${input.signerEmail}>`],
    ['Session', input.sessionId],
    ['Link opened', input.viewedAt ? `${sast(input.viewedAt)} from IP ${input.signerIp || 'unknown'}` : 'not recorded'],
    ['Signature executed', `${sast(input.signedAt)} from IP ${input.signerIp || 'unknown'}`],
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
    'This certificate was generated by HustlePortal e-sign, a first-party electronic signing ' +
    'system operated by the document owner on its own infrastructure. The signer reviewed the ' +
    'document, drew their signature and confirmed consent to be bound by an electronic ' +
    'signature, which has legal effect under the Electronic Communications and Transactions ' +
    'Act 25 of 2002 of South Africa. The signed file and this audit trail are retained in the ' +
    'operator\u2019s records.'
  drawLines(cert, wrap(statement, 92), 57, cy, font, 9, 12)
  cert.drawText(ascii(`HustlePortal e-sign - ${sast(input.signedAt)}`), { x: 57, y: 60, size: 8, font, color: rgb(0.4, 0.4, 0.4) })

  const bytes = await pdf.save()
  return { bytes, signedSha256: sha256hex(bytes) }
}
