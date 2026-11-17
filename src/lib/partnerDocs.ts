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
  /** The other party's already-executed PDF has no editable DOCX companion. */
  hasDocx?: boolean
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
      'The per-strategist appointment: the trinitydirect door, the R50 per managed lead referral fee as executed flat in V2.1 (no taper), the R25/R25 member split mechanics, brand usage licence, non-circumvention, POPIA. DRAFT v0.1 — same 【】 placeholders and review caveat.',
    tag: 'agreement',
  },
  {
    // Task 214: the basename itself must be engine-free — it rides in download
    // URLs, signing sessions and the signer's page.
    base: 'Pricing_Strategy_Internal',
    title: 'Pricing Strategy (v3, live)',
    description:
      'The internal strategy as it now stands, on Business Hustle letterhead: the executed flat R50/R60 referral law (v2\u2019s 90-day taper is superseded), the armed self-serve ladder from 1 December 2026 with grandfathering before it, the exact-five R550 corporate credit, the live welcome credits and packs, and the partner funnel with its Monday digest. Every figure verified against the live till on 17 November 2026.',
    tag: 'internal',
  },
  {
    // Task 215 round 2: the version Trinity executed on their own OpenSign
    // system, loaded for the Business Hustle counter-signature. Their
    // signatures stay; ours are added on top (initials every page, typed info,
    // first-party certificate) — the executed copy records both parties.
    base: 'Strategic_Partnership_Agreement_Tdc_Bh_V2_1-2_signed_by_OpenSign™',
    title: 'Strategic Partnership Agreement — V2, signed by Trinity (counter-signature copy)',
    description:
      'V2.1 of the Trinity agreement as Trinity Direct Consortium signed and returned it (their OpenSign certificate and signature pages included, 22 pages). This is the copy Business Hustle counter-signs: initials on every page, typed info in the execution block, then our first-party certificate of electronic signature appended. No editable DOCX — the executed PDF is the source of truth.',
    tag: 'agreement',
    hasDocx: false,
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
