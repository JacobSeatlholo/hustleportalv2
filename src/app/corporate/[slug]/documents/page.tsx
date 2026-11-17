import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Lock, FileText, FileSignature, ShieldCheck } from 'lucide-react'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import EsignSendForm from '@/components/hp/corporate/EsignSendForm'
import EsignSessionDelete from '@/components/hp/corporate/EsignSessionDelete'
import { getStrategist, whitelabelMeta } from '@/lib/corporate'
import { PARTNER_DOCS, checkDocsKey } from '@/lib/partnerDocs'
import { db } from '@/lib/db'
import { sast } from '@/lib/esign'

// ============ PARTNER DEAL ROOM (Task 211, e-sign engine Task 212) ============
// The internal documents + signing section for the strategist partnership.
// Laws:
//   - GATED: wrong or missing ?key= returns notFound() — the page simply does
//     not exist for anyone else, and no client-facing page links here (the
//     doors stay pure sales). Access is the direct URL the boss shares.
//   - Documents stream from private-docs/ through the gated API route.
//   - Signing is FIRST-PARTY (Task 212): our own engine replaced DocuSign —
//     sessions, tokens, stamping, certificate and audit live in this app.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = getStrategist(slug)
  // Whitelabel law (Task 214): the partner deal room never brands the engine —
  // head metadata included.
  const meta = s
    ? whitelabelMeta(s, `Deal room — ${s.company}`, 'The partnership documents and the first-party signing flow.')
    : { title: 'Deal room' }
  return { ...meta, robots: { index: false, follow: false } }
}

const STATUS_STYLES: Record<string, string> = {
  SENT: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  VIEWED: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200',
  SIGNED: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200',
}

export default async function PartnerDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ key?: string; signed?: string }>
}) {
  const { slug } = await params
  const { key, signed } = await searchParams
  const partner = getStrategist(slug)
  // Wrong key or unknown slug = indistinguishable from a dead link.
  if (!partner || !checkDocsKey(key)) notFound()

  const docs = PARTNER_DOCS.map((d) => ({
    ...d,
    pdf: `${d.base}.pdf`,
    docx: `${d.base}.docx`,
  }))
  const sessions = await db.esignSession.findMany({
    where: { slug },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      token: true, docBase: true, docTitle: true, signerName: true, signerEmail: true,
      status: true, sentVia: true, createdAt: true, viewedAt: true, signedAt: true,
    },
  })
  // A doc whose latest session is SIGNED reads as executed, not as a draft —
  // the page is the one the boss sends the partner, so it must say the true
  // state of the agreement at a glance. Keyed on docBase, not title: only a
  // signature on THAT document flips its badge, never a same-titled session
  // of anything else (QA passes, renamed drafts).
  const signedDocs = new Set(sessions.filter((s) => s.status === 'SIGNED').map((s) => s.docBase))

  return (
    <CorporateShell footer={false}>
      <main className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-14 space-y-10">
          <header className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" /> Private partnership room — not client-facing
            </p>
            <h1 className="font-display text-4xl leading-tight">Deal room: documents &amp; signing</h1>
            <p className="text-muted-foreground">
              The working documents behind the {partner.company} partnership, and the first-party
              signing flow to execute them. The client door stays pure sales — commission mechanics
              live only in these documents and the internal ledger.
            </p>
            {signed === '1' && (
              <p className="rounded-xl border border-brand/40 bg-brand/5 p-4 text-sm text-brand font-semibold">
                Signature session complete. The signed copy is on the signer&apos;s signing page and
                in the session list below.
              </p>
            )}
          </header>

          <section className="space-y-3">
            <h2 className="font-display text-2xl flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand" /> Documents
            </h2>
            {docs.map((d) => {
              const executed = signedDocs.has(d.base)
              return (
              <div key={d.base} className="rounded-2xl border border-border bg-card p-5 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold">{d.title}</p>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                      executed
                        ? 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200'
                        : d.tag === 'agreement'
                          ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {executed ? 'executed — signed copy below' : d.tag === 'agreement' ? 'draft — for legal review' : 'internal'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{d.description}</p>
                <div className="flex gap-3 pt-1">
                  <a
                    href={`/api/corporate/${slug}/docs?key=${encodeURIComponent(key ?? '')}&file=${d.pdf}`}
                    className="text-sm font-semibold text-brand underline"
                  >
                    Download PDF
                  </a>
                  <a
                    href={`/api/corporate/${slug}/docs?key=${encodeURIComponent(key ?? '')}&file=${d.docx}`}
                    className="text-sm font-semibold text-brand underline"
                  >
                    Download DOCX (editable)
                  </a>
                </div>
              </div>
              )
            })}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-2xl">Signing</h2>
            <EsignSendForm
              slug={slug}
              gateKey={key ?? ''}
              docs={docs.filter((d) => d.pdf.endsWith('.pdf')).map((d) => ({ file: d.pdf, title: d.title }))}
            />

            {sessions.length > 0 && (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <p className="px-5 py-3 text-sm font-semibold border-b border-border bg-muted/40">
                  Signing sessions
                </p>
                <ul className="divide-y divide-border">
                  {sessions.map((s) => (
                    <li key={s.token} className="px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLES[s.status] ?? 'bg-muted text-muted-foreground'}`}>
                        {s.status}
                      </span>
                      <span className="font-semibold">{s.signerName}</span>
                      <span className="text-muted-foreground">{s.docTitle}</span>
                      <span className="text-xs text-muted-foreground">
                        created {sast(s.createdAt)}
                        {s.viewedAt ? ` · viewed ${sast(s.viewedAt)}` : ''}
                        {s.signedAt ? ` · signed ${sast(s.signedAt)}` : ''}
                      </span>
                      <span className="ml-auto flex items-center gap-3">
                        <a href={`/sign/${s.token}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand underline">
                          signing page
                        </a>
                        {s.status === 'SIGNED' && (
                          <a href={`/api/sign/${s.token}/file`} className="text-xs font-semibold text-brand underline">
                            signed PDF
                          </a>
                        )}
                        <EsignSessionDelete slug={slug} gateKey={key ?? ''} token={s.token} name={`${s.signerName} — ${s.docTitle}`} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5" /> 100% first-party: sessions, signature stamping,
              certificates and the audit trail run on your own infrastructure — no DocuSign, no
              per-envelope fees. Electronic signatures carry legal effect under the ECT Act 25 of 2002.
            </p>
          </section>

          <footer className="text-xs text-muted-foreground border-t border-border pt-4">
            Draft agreements are prepared for review and are not legal advice — each party has them
            reviewed by its own legal adviser before signature. Placeholders in 【】 mark facts that
            must be filled before signing.
          </footer>
        </div>
      </main>
    </CorporateShell>
  )
}
