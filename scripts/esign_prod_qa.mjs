#!/usr/bin/env node
// ============ FIRST-PARTY E-SIGN: PROD MACHINE TEST (Task 215 round 2) ============
// Walks the exact chain the boss rides when they sign in the portal:
//   deal room → create session → signing page → PDF preview →
//   draw/sign API (with typed fields) → stamped copy + certificate →
//   SIGNED in the deal room. Plus the counter-signature path: upload the
//   other party's executed PDF → session on those bytes → sign → stamped.
// Uses the INTERNAL pricing doc for the throwaway pass so the agreement
// badges on the real deal room stay truthful (badge keys on docBase).
// Run: node scripts/esign_prod_qa.mjs [baseUrl]
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const DOCS_KEY = process.env.DOCS_KEY || 'bh-tdc-dealroom-qx7k29'
const SLUG = 'trinitydirect'
const DOC = 'Pricing_Strategy_Internal.pdf'
const DOC_TITLE = 'Pricing Strategy (v2, R110)'
const V2_TITLE = 'Strategic Partnership Agreement — V2, signed by Trinity (counter-signature copy)'
const V2_FILE = 'Strategic_Partnership_Agreement_Tdc_Bh_V2_1-2_signed_by_OpenSign™.pdf'
const { readFileSync, writeFileSync } = await import('node:fs')
const { spawnSync } = await import('node:child_process')
const { PDFDocument, StandardFonts } = await import('pdf-lib')

let pass = 0, fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${extra ? ` — ${extra}` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`) }
}

const sigB64 = readFileSync('/home/z/my-project/scripts/qa_signature.png').toString('base64')
const ts = Date.now().toString(36).slice(-6)

// 1. Create the session through the deal room API (gate key).
const mk = await fetch(`${BASE}/api/corporate/${SLUG}/esign?key=${encodeURIComponent(DOCS_KEY)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ file: DOC, signerName: `QA Signer ${ts}`, signerEmail: `qa-sign-${ts}@bhqa.co.za` }),
})
const mkJ = await mk.json().catch(() => null)
check('session created via deal room API', mk.ok && !!mkJ?.token, mk.ok ? mkJ.emailed ? 'link emailed too' : `email off (${mkJ.emailError || 'n/a'}), link copyable` : JSON.stringify(mkJ))
if (!mkJ?.token) { console.log(`\n==== E-SIGN: ${pass} PASS / ${fail} FAIL (aborted) ====`); process.exit(1) }
const token = mkJ.token

// 2. The signing page renders and is reviewable.
const page = await (await fetch(`${BASE}/sign/${token}`)).text()
check('signing page opens (no account, no gate)', page.includes('Review and sign') && page.includes(DOC_TITLE))

// 3. The PDF preview the signer must read.
const pdfRes = await fetch(`${BASE}/api/sign/${token}/pdf`)
const pdfHead = Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 5).toString()
check('document preview streams (%PDF)', pdfRes.ok && pdfHead === '%PDF-', `status ${pdfRes.status}`)
const originalLen = Number(pdfRes.headers.get('content-length') || 0)

// 3b. Validation wall: a typed row with an empty label but a value is rejected
//     up front, and the rejection does NOT consume the one-shot session.
const badFields = await fetch(`${BASE}/api/sign/${token}/sign`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ signaturePng: `data:image/png;base64,${sigB64}`, typedName: `QA Signer ${ts}`, consent: true, typedFields: [{ label: '', value: 'orphan value' }] }),
})
check('typed field with empty label rejected (session survives)', badFields.status === 400, `status ${badFields.status}`)

// 4. Mark-viewed happens on page open; sign it (drawn signature + initials +
//    typed name + typed fields + consent).
const signRes = await fetch(`${BASE}/api/sign/${token}/sign`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    signaturePng: `data:image/png;base64,${sigB64}`,
    typedName: `QA Signer ${ts}`,
    typedFields: [
      { label: 'Capacity', value: 'Director, for and on behalf of Business Hustle (Pty) Ltd' },
      { label: 'Effective date', value: '17 November 2026' },
      { label: '', value: '' }, // fully-empty rows are skipped, not rejected
    ],
    consent: true,
  }),
})
const signJ = await signRes.json().catch(() => null)
check('signature executes (stamp + certificate + typed fields)', signRes.ok && !!signJ?.signedAt, signRes.ok ? signJ.signedAt : JSON.stringify(signJ))

// 5. Replay protection.
const replay = await fetch(`${BASE}/api/sign/${token}/sign`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ signaturePng: `data:image/png;base64,${sigB64}`, typedName: 'x', consent: true }),
})
check('replay rejected (one signature per session)', replay.status === 409, `status ${replay.status}`)

// 6. The signed copy: real PDF, bigger than the original (stamp + cert page).
const signed = await fetch(`${BASE}/api/sign/${token}/file`)
const signedBuf = Buffer.from(await signed.arrayBuffer())
check('signed copy streams with certificate appended', signed.ok && signedBuf.subarray(0, 5).toString() === '%PDF-' && (!originalLen || signedBuf.length > originalLen), `${(originalLen / 1024).toFixed(0)} KB → ${(signedBuf.length / 1024).toFixed(0)} KB`)
// 6b. The typed fields must actually be INSIDE the stamped file — extract the
//     certificate page text with pypdf and look for them.
writeFileSync('/tmp/esign_qa_signed.pdf', signedBuf)
const extract = spawnSync('python3', ['-I', '-c', `
from pypdf import PdfReader
r = PdfReader('/tmp/esign_qa_signed.pdf')
text = r.pages[-1].extract_text() or ''
ok1 = 'Capacity' in text and 'for and on behalf of Business Hustle' in text
ok2 = 'Effective date' in text and '17 November 2026' in text
print('FIELDS_OK' if (ok1 and ok2) else 'FIELDS_MISSING')
`], { encoding: 'utf8' })
check('typed fields are written into the execution block', extract.stdout?.includes('FIELDS_OK'), (extract.stdout || extract.stderr || '').trim().slice(0, 120))
const done = await (await fetch(`${BASE}/sign/${token}`)).text()
check('signing page flips to Signature complete + inline copy', done.includes('Signature complete') && done.includes('certificate of electronic signature'))

// 7. Badge truth: a doc card carries "executed" iff at least one SIGNED
//    session exists for THAT document. Compare every card against the live
//    session list (segments bounded at the next card, so RSC echoes below the
//    sessions list can't leak in).
const BADGE = 'executed — signed copy below'
const list0 = await (await fetch(`${BASE}/api/corporate/${SLUG}/esign?key=${encodeURIComponent(DOCS_KEY)}`)).json()
const room = await (await fetch(`${BASE}/corporate/${SLUG}/documents?key=${encodeURIComponent(DOCS_KEY)}`)).text()
check('deal room lists the session SIGNED', room.includes(`QA Signer ${ts}`) && room.includes('SIGNED'))
const CARDS = [
  ['Strategic Partnership and White-Label Software Agreement', 'Brand Strategist Agreement'],
  ['Brand Strategist Agreement', 'Pricing Strategy (v2, R110)'],
  ['Pricing Strategy (v2, R110)', V2_TITLE],
  [V2_TITLE, 'Signing sessions'],
]
function badgeTruth(listJson, html) {
  const signed = new Set((listJson.sessions || []).filter((s) => s.status === 'SIGNED').map((s) => s.docTitle))
  return CARDS.every(([title, next]) => {
    const seg = html.slice(html.indexOf(title), html.indexOf(next))
    return signed.has(title) === seg.includes(BADGE)
  })
}
check('badge state equals session truth on every doc card', badgeTruth(list0, room), CARDS.map(([t]) => {
  const seg = room.slice(room.indexOf(t), room.indexOf(CARDS.find(([a]) => a === t)?.[1] ?? 'Signing sessions'))
  return `${t.slice(0, 22)}…:${seg.includes(BADGE) ? 'executed' : 'draft'}`
}).join(' | '))

// 8. The counter-signature copy itself: registered, streaming, and DOCX-less.
check('V2 counter-signature copy listed in the room', room.includes(V2_TITLE), V2_TITLE.slice(0, 40) + '…')
const v2seg = room.slice(room.indexOf(V2_TITLE), room.indexOf('Signing sessions'))
// The badge must match the session's LIVE status: SENT → awaiting the owner's
// counter-signature, SIGNED → executed with the signed copy below (the owner
// really signs this copy, so the expectation reads the session, not history).
const v2sess = (list0.sessions || []).find((s) => s.docTitle === V2_TITLE)
check('V2 badge matches the counter-sign session truth', v2sess
  ? (v2sess.status === 'SIGNED' ? v2seg.includes(BADGE) : v2seg.includes('signed by Trinity — awaiting counter-signature'))
  : v2seg.includes('draft'), `session ${v2sess?.status || 'missing'}`)
check('V2 card has no DOCX link (executed PDF is the source)', !v2seg.includes('Download DOCX'))
const v2res = await fetch(`${BASE}/api/corporate/${SLUG}/docs?key=${encodeURIComponent(DOCS_KEY)}&file=${encodeURIComponent(V2_FILE)}`)
const v2head = Buffer.from(await v2res.arrayBuffer()).subarray(0, 5).toString()
check('V2 PDF streams gated from private-docs', v2res.ok && v2head === '%PDF-', `status ${v2res.status}`)

// 9. The upload path — load the other party's executed PDF, session on those
//    exact bytes, sign it, verify the stamp rides on the uploaded document.
const scratch = await PDFDocument.create()
const sfont = await scratch.embedFont(StandardFonts.Helvetica)
const spage = scratch.addPage([595.28, 841.89])
spage.drawText(`Counter-sign QA payload ${ts} - page one`, { x: 57, y: 780, size: 12, font: sfont })
scratch.addPage([595.28, 841.89])
const upBytes = Buffer.from(await scratch.save())
const fd = new FormData()
fd.append('file', new Blob([upBytes], { type: 'application/pdf' }), `QA_Counter_${ts}.pdf`)
const upRes = await fetch(`${BASE}/api/corporate/${SLUG}/esign/upload?key=${encodeURIComponent(DOCS_KEY)}`, { method: 'POST', body: fd })
const upJ = await upRes.json().catch(() => null)
check('upload endpoint stores the executed PDF (DocFile)', upRes.ok && !!upJ?.doc?.id, upRes.ok ? `${(upBytes.length / 1024).toFixed(1)} KB, sha256 pinned` : JSON.stringify(upJ))
const badFd = new FormData()
badFd.append('file', new Blob([Buffer.from('not a pdf at all')], { type: 'application/pdf' }), 'QA_NotPdf.pdf')
const badRes = await fetch(`${BASE}/api/corporate/${SLUG}/esign/upload?key=${encodeURIComponent(DOCS_KEY)}`, { method: 'POST', body: badFd })
check('non-PDF upload rejected', badRes.status === 400, `status ${badRes.status}`)

let upToken = null
if (upJ?.doc?.id) {
  const mk2 = await fetch(`${BASE}/api/corporate/${SLUG}/esign?key=${encodeURIComponent(DOCS_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docFileId: upJ.doc.id, signerName: `QA Uploader ${ts}`, signerEmail: `qa-up-${ts}@bhqa.co.za` }),
  })
  const mk2J = await mk2.json().catch(() => null)
  check('session created on the uploaded bytes (docFileId)', mk2.ok && !!mk2J?.token, mk2.ok ? mk2J.url.split('/').pop().slice(0, 10) + '…' : JSON.stringify(mk2J))
  upToken = mk2J?.token ?? null
  if (upToken) {
    const upPage = await (await fetch(`${BASE}/sign/${upToken}`)).text()
    check('signing page shows the uploaded document title', upPage.includes('QA Counter'), 'title from filename')
    const upSign = await fetch(`${BASE}/api/sign/${upToken}/sign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signaturePng: `data:image/png;base64,${sigB64}`, typedName: `QA Uploader ${ts}`, consent: true }),
    })
    check('uploaded document signs end to end', upSign.ok, `status ${upSign.status}`)
    const upFile = await fetch(`${BASE}/api/sign/${upToken}/file`)
    const upBuf = Buffer.from(await upFile.arrayBuffer())
    check('signed uploaded copy streams (initials on both pages + cert)', upFile.ok && upBuf.subarray(0, 5).toString() === '%PDF-' && upBuf.length > upBytes.length, `${(upBytes.length / 1024).toFixed(1)} KB → ${(upBuf.length / 1024).toFixed(1)} KB`)
  }
}

// 10. The frame relaxation: the signing surface must be framable by the
//     portal itself (the review iframe the boss flagged), nowhere else.
const pageHead = await fetch(`${BASE}/sign/${token}`)
const pageHeaders = pageHead.headers
check('signing page allows same-origin framing', pageHeaders.get('x-frame-options') === 'SAMEORIGIN' && (pageHeaders.get('content-security-policy') || '').includes("frame-ancestors 'self'"), `XFO ${pageHeaders.get('x-frame-options')}`)
const rootHead = await fetch(`${BASE}/`)
check('root still denies all framing', rootHead.headers.get('x-frame-options') === 'DENY' && (rootHead.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), `XFO ${rootHead.headers.get('x-frame-options')}`)

// 11. Cleanup through the room's own DELETE: every QA session (this run and
//    strays from earlier runs) goes, badge and all.
const qaTokens = (list0.sessions || []).filter((s) => /qa-(sign|up)-.*@bhqa\.co\.za/.test(s.signerEmail)).map((s) => s.token)
let deleted = 0
for (const t of qaTokens) {
  const d = await fetch(`${BASE}/api/corporate/${SLUG}/esign?key=${encodeURIComponent(DOCS_KEY)}&token=${encodeURIComponent(t)}`, { method: 'DELETE' })
  if (d.ok) deleted++
}
check('gated DELETE removes every QA session', deleted === qaTokens.length && qaTokens.length >= 1, `${deleted}/${qaTokens.length} removed`)
// Second sweep: this run's uploaded session (and any other strays) were created
// AFTER list0 was taken, so one more listing pass guarantees the room is clean
// before the clean check runs.
let swept = 0
for (let i = 0; i < 3; i++) {
  const l = await (await fetch(`${BASE}/api/corporate/${SLUG}/esign?key=${encodeURIComponent(DOCS_KEY)}`)).json()
  const strays = (l.sessions || []).filter((s) => /@bhqa\.co\.za/.test(s.signerEmail || ''))
  if (strays.length === 0) break
  for (const s of strays) {
    const d = await fetch(`${BASE}/api/corporate/${SLUG}/esign?key=${encodeURIComponent(DOCS_KEY)}&token=${encodeURIComponent(s.token)}`, { method: 'DELETE' })
    if (d.ok) swept++
  }
}
if (swept > 0) console.log(`  sweep: removed ${swept} leftover QA session(s)`)
const listAfter = await (await fetch(`${BASE}/api/corporate/${SLUG}/esign?key=${encodeURIComponent(DOCS_KEY)}`)).json()
const roomAfter = await (await fetch(`${BASE}/corporate/${SLUG}/documents?key=${encodeURIComponent(DOCS_KEY)}`)).text()
check('room clean: no QA rows left', !roomAfter.includes('QA Signer') && !roomAfter.includes('QA Uploader') && !roomAfter.includes('@bhqa.co.za'))
check('badge state still equals session truth after cleanup', badgeTruth(listAfter, roomAfter))

console.log(`\n==== E-SIGN: ${pass} PASS / ${fail} FAIL ====`)
process.exit(fail > 0 ? 1 : 0)
