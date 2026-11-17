// ============ INITIALS + FRAME LAWS: PROD MACHINE TEST (recreated 2026-11-17) ============
// The original suite was untracked and a sandbox recycle ate it. Rebuilt from
// the live contracts (src/app/api/sign/[token]/sign/route.ts Task 214 block)
// and the owner's real executed agreement as the permanent artifact:
//   - frame laws: root DENY, /sign/* SAMEORIGIN (the portal frames its own PDFs)
//   - initials drawn ONCE are stamped on EVERY original page (entity law)
//   - typed fields land inside the appended certificate page
//   - replay protection, one signature per session
//   - the owner's counter-signed V2 copy honours the same initials law
// Run: node scripts/initials_whitelabel_qa.mjs [baseUrl]
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const SLUG = 'trinitydirect'
const ROOM_KEY = 'bh-tdc-dealroom-qx7k29'
// The owner's real counter-sign session on the Trinity-executed V2 copy —
// a permanent prod artifact, signed 2026-11-17, never swept.
const V2_TOKEN = 'wq1oZ_YDXdXzMj1UHgNEFmETmuDG8HqOzGMd-7z-ph8'

const { readFileSync, writeFileSync } = await import('node:fs')
const { spawnSync } = await import('node:child_process')
const { PDFDocument } = await import('pdf-lib')

let pass = 0, fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${extra ? ` — ${extra}` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`) }
}
const ts = Date.now().toString(36).slice(-6)
const sigB64 = readFileSync('/home/z/my-project/scripts/qa_signature.png').toString('base64')

async function buf(path, timeoutMs = 60000) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(timeoutMs) })
  const body = Buffer.from(await res.arrayBuffer().catch(() => 0))
  return { status: res.status, headers: res.headers, body }
}
async function post(path, body, timeoutMs = 60000) {
  const res = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
// pypdf: per-page image counts + certificate text (isolated mode, project dir
// stays out of sys.path).
function inspectPdf(file) {
  const r = spawnSync('python3', ['-I', '-c', `
import json, sys
from pypdf import PdfReader
r = PdfReader(${JSON.stringify(file)})
print(json.dumps({
  'pages': len(r.pages),
  'images': [len(p.images) for p in r.pages],
  'certText': r.pages[-1].extract_text()[-2000:],
}))`], { encoding: 'utf8' })
  try { return JSON.parse(r.stdout) } catch { return null }
}

console.log('[1] frame laws (the portal frames its own signing pages, nothing frames it)')
{
  const root = await fetch(BASE, { redirect: 'manual' })
  const rootXfo = root.headers.get('x-frame-options') || ''
  const rootCsp = root.headers.get('content-security-policy') || ''
  check('root refuses framing (DENY or frame-ancestors none)', /DENY/i.test(rootXfo) || /frame-ancestors\s+'none'/.test(rootCsp), `XFO=${rootXfo || 'n/a'}`)
  const mk = await post(`/api/corporate/${SLUG}/esign?key=${encodeURIComponent(ROOM_KEY)}`, {
    file: 'Pricing_Strategy_Internal.pdf', signerName: `QA Initials ${ts}`, signerEmail: `qa-init-${ts}@bhqa.co.za`,
  })
  const token = mk.json?.token
  check('multi-page session created via deal room', mk.status === 200 && !!token, `status ${mk.status}`)
  if (!token) { console.log(`\n==== INITIALS: ${pass} PASS / ${fail} FAIL (aborted) ====`); process.exit(1) }
  const sign = await fetch(`${BASE}/sign/${token}`)
  const signXfo = sign.headers.get('x-frame-options') || ''
  const signCsp = sign.headers.get('content-security-policy') || ''
  check('sign page allows SAMEORIGIN framing', /SAMEORIGIN/i.test(signXfo) || /frame-ancestors\s+'self'/.test(signCsp), `XFO=${signXfo || 'n/a'}`)
  const signHtml = await sign.text()
  check('sign page renders the review block', signHtml.includes('Review and sign'), '')

  console.log('[2] the original document is a real multi-page PDF')
  const orig = await buf(`/api/sign/${token}/pdf`)
  check('preview streams (%PDF)', orig.status === 200 && orig.body.subarray(0, 5).toString() === '%PDF-', `status ${orig.status}`)
  const origDoc = await PDFDocument.load(orig.body)
  const pageCount = origDoc.getPageCount()
  check('document is genuinely multi-page (initials law has teeth)', pageCount >= 2, `${pageCount} pages`)

  console.log('[3] typed-fields wall, then the initials execution')
  const bad = await post(`/api/sign/${token}/sign`, { signaturePng: `data:image/png;base64,${sigB64}`, typedName: `QA ${ts}`, consent: true, typedFields: [{ label: '', value: 'orphan' }] })
  check('typed row with empty label rejected (session survives)', bad.status === 400, `status ${bad.status}`)
  const signRes = await post(`/api/sign/${token}/sign`, {
    signaturePng: `data:image/png;base64,${sigB64}`,
    initialsPng: `data:image/png;base64,${sigB64}`,
    typedName: `QA Initials ${ts}`,
    typedFields: [
      { label: 'Capacity', value: 'Director, for and on behalf of Business Hustle (Pty) Ltd' },
      { label: 'Effective date', value: '17 November 2026' },
    ],
    consent: true,
  })
  check('execution completes with initials + signature + typed fields', signRes.status === 200 && !!signRes.json?.signedAt, signRes.status === 200 ? signRes.json.signedAt : JSON.stringify(signRes.json))

  const replay = await post(`/api/sign/${token}/sign`, { signaturePng: `data:image/png;base64,${sigB64}`, typedName: 'x', consent: true })
  check('replay rejected (one signature per session)', replay.status === 409, `status ${replay.status}`)

  console.log('[4] the stamped copy: initials on EVERY original page')
  const done = await buf(`/api/sign/${token}/file`)
  check('signed copy streams (%PDF)', done.status === 200 && done.body.subarray(0, 5).toString() === '%PDF-', `status ${done.status}`)
  const doneDoc = await PDFDocument.load(done.body)
  check('no page lost or gained in the original block', doneDoc.getPageCount() === pageCount + 1, `${doneDoc.getPageCount()} pages (orig ${pageCount} + certificate)`)
  writeFileSync('/tmp/initials_qa_done.pdf', done.body)
  const insp = inspectPdf('/tmp/initials_qa_done.pdf')
  const imgs = insp?.images || []
  const originalsHaveInitials = imgs.slice(0, pageCount).every(n => n >= 1)
  check('every original page carries a stamp (initials law, page by page)', imgs.length >= pageCount && originalsHaveInitials, `images per page: [${imgs.join(', ')}]`)
  check('certificate page carries the typed fields', !!insp && insp.certText.includes('Director, for and on behalf of Business Hustle') && insp.certText.includes('17 November 2026'), '')

  console.log('[5] the owner\'s executed V2 copy honours the same law')
  const v2 = await buf(`/api/sign/${V2_TOKEN}/file`)
  check("owner's counter-signed V2 streams (%PDF)", v2.status === 200 && v2.body.subarray(0, 5).toString() === '%PDF-', `status ${v2.status}`)
  writeFileSync('/tmp/initials_qa_v2.pdf', v2.body)
  const v2i = inspectPdf('/tmp/initials_qa_v2.pdf')
  const v2Pages = v2i?.pages || 0
  const v2Imgs = v2i?.images || []
  check('executed V2 is multi-page with a stamp on every original page', v2Pages >= 2 && v2Imgs.slice(0, v2Pages - 1).every(n => n >= 1), `${v2Pages} pages, images: [${v2Imgs.join(', ')}]`)

  console.log('[6] cleanup through the room’s own gated DELETE')
  const del = await fetch(`${BASE}/api/corporate/${SLUG}/esign?key=${encodeURIComponent(ROOM_KEY)}&token=${encodeURIComponent(token)}`, { method: 'DELETE' })
  check('QA session removed', del.status === 200, `status ${del.status}`)
}

console.log(`\n==== INITIALS: ${pass} PASS / ${fail} FAIL ====`)
process.exit(fail > 0 ? 1 : 0)
