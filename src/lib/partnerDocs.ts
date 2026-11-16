import path from 'node:path'

// ============ PARTNER DEAL ROOM (Task 211) ============
// The internal documents behind the strategist doors: agreement drafts and
// pricing strategy. Laws (boss, Task 210/211):
//   - Client doors are PURE SALES — no link from any client-facing page leads
//     here; access is by direct URL with the gate key only.
//   - Files live in private-docs/ (NOT public/) and stream through the API
//     route after the gate key check. Wrong key = 404, same as a dead link.
//   - Signing runs on the first-party e-sign engine (Task 212): sessions are
//     created here, the signer gets a /sign/<token> link, stamping and the
//     audit certificate happen in this app. No third-party signer involved.

export const PRIVATE_DOCS_DIR = path.join(process.cwd(), 'private-docs')

export interface PartnerDoc {
  /** Base name without extension; both .pdf and .docx must exist. */
  base: string
  title: string
  description: string
  tag: string
}

export const PARTNER_DOCS: PartnerDoc[] = [
  {
    base: 'TDC_Strategic_Partnership_Agreement_DRAFT',
    title: 'Strategic Partnership and White-Label Software Agreement',
    description:
      'The entity-to-entity agreement with Trinity Direct Consortium (Pty) Ltd: R110 customer rate split R60/R50 on Consortium-introduced clients, white-label subdomain framework, Gauteng territorial protection, IP split, POPIA/FAIS. DRAFT v0.1 — placeholders in 【】 need filling (BH registration details, notice emails) and legal review before signature.',
    tag: 'agreement',
  },
  {
    base: 'Brand_Strategist_Agreement_DRAFT',
    title: 'Brand Strategist Agreement',
    description:
      'The per-strategist appointment: the trinitydirect door, the R50 per managed lead referral fee (taper decision flagged for the owner), the R25/R25 member split mechanics, brand usage licence, non-circumvention, POPIA. DRAFT v0.1 — same 【】 placeholders and review caveat.',
    tag: 'agreement',
  },
  {
    base: 'HustlePortal_Pricing_Strategy',
    title: 'HustlePortal Pricing Strategy (v2, R110)',
    description:
      'The internal strategy: level ladder R60→R15 with grandfathering, R120 welcome credit, corporate R110 with the exact-five credit, referral economics. Internal only — moved out of /docs/ so it is no longer publicly served.',
    tag: 'internal',
  },
]

export function findPartnerDoc(fileName: string): PartnerDoc | null {
  const base = path.basename(fileName)
  const withoutExt = base.replace(/\.(pdf|docx)$/i, '')
  const ext = base.slice(withoutExt.length).toLowerCase()
  if (ext !== '.pdf' && ext !== '.docx') return null
  const doc = PARTNER_DOCS.find((d) => d.base === withoutExt)
  return doc ? { ...doc, base: `${doc.base}${ext}` } : null
}

/**
 * The gate key. Set DOCS_ACCESS_KEY in Vercel to rotate the fallback;
 * sharing the key gives read access to the deal room and DocuSign sends.
 */
export function docsAccessKey(): string {
  return process.env.DOCS_ACCESS_KEY || 'bh-tdc-dealroom-qx7k29'
}

export function checkDocsKey(provided?: string | null): boolean {
  const key = docsAccessKey()
  return typeof provided === 'string' && provided.length > 0 && provided === key
}
