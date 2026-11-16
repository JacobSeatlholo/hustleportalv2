import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Lock, FileText, FileSignature, ShieldCheck } from 'lucide-react'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import DocusignSendForm from '@/components/hp/corporate/DocusignSendForm'
import { getStrategist } from '@/lib/corporate'
import { PARTNER_DOCS, checkDocsKey } from '@/lib/partnerDocs'
import { docusignStatus } from '@/lib/docusign'

// ============ PARTNER DEAL ROOM (Task 211) ============
// The internal documents + DocuSign section for the strategist partnership.
// Laws:
//   - GATED: wrong or missing ?key= returns notFound() — the page simply does
//     not exist for anyone else, and no client-facing page links here (the
//     doors stay pure sales). Access is the direct URL the boss shares.
//   - Documents stream from private-docs/ through the gated API route.
//   - DocuSign env missing → the page renders the honest setup checklist
//     instead of pretending the flow is live.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = getStrategist(slug)
  return {
    title: s ? `Internal deal room — ${s.company} × HustlePortal` : 'Internal deal room',
    robots: { index: false, follow: false },
  }
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

  const ds = docusignStatus()
  const docs = PARTNER_DOCS.map((d) => ({
    ...d,
    pdf: `${d.base}.pdf`,
    docx: `${d.base}.docx`,
  }))

  return (
    <CorporateShell>
      <main className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-14 space-y-10">
          <header className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" /> Internal — not client-facing
            </p>
            <h1 className="font-display text-4xl leading-tight">Deal room: documents &amp; signing</h1>
            <p className="text-muted-foreground">
              The working documents behind the {partner.company} partnership, and the DocuSign flow
              to send them for signature. The client door stays pure sales — commission mechanics
              live only in these documents and the internal ledger.
            </p>
            {signed === '1' && (
              <p className="rounded-xl border border-brand/40 bg-brand/5 p-4 text-sm text-brand font-semibold">
                Signature session complete. DocuSign will email the signed copy to the parties. For
                the counterparty's signed PDF, check the DocuSign account.
              </p>
            )}
          </header>

          <section className="space-y-3">
            <h2 className="font-display text-2xl flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand" /> Documents
            </h2>
            {docs.map((d) => (
              <div key={d.base} className="rounded-2xl border border-border bg-card p-5 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold">{d.title}</p>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                      d.tag === 'agreement'
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {d.tag === 'agreement' ? 'draft — for legal review' : 'internal'}
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
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-2xl">Signing</h2>
            {ds.configured ? (
              <DocusignSendForm
                slug={slug}
                gateKey={key ?? ''}
                docs={docs.filter((d) => d.pdf.endsWith('.pdf')).map((d) => ({ file: d.pdf, title: d.title }))}
              />
            ) : (
              <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <p className="font-display text-xl flex items-center gap-2">
                  <FileSignature className="h-5 w-5 text-brand" /> DocuSign not connected yet
                </p>
                <p className="text-sm text-muted-foreground">
                  The send flow is built and will switch on the moment these four values are set in
                  Vercel project settings (Environment Variables), then a redeploy:
                </p>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal pl-5">
                  <li>
                    Free <strong>developer (demo) account</strong> at developer.docusign.com — signs
                    real documents in the demo environment at no cost.
                  </li>
                  <li>
                    Apps &amp; Keys → <strong>Add App &amp; Integration Key</strong> → enable{' '}
                    <strong>JWT grant</strong> → add an RSA keypair (generate one:{' '}
                    <code className="font-mono text-xs">openssl genrsa -out docusign_private.pem 2048</code>
                    , paste the <em>public</em> key in the app, keep the private one for the env).
                  </li>
                  <li>
                    Grab <strong>Integration Key</strong>, <strong>API Username (User ID)</strong>{' '}
                    and <strong>Account ID</strong> from the same screen. Grant consent once via the
                    app's <em>Request personal access token</em> helper.
                  </li>
                  <li>
                    Vercel env: <code className="font-mono text-xs">DOCUSIGN_INTEGRATION_KEY</code>,{' '}
                    <code className="font-mono text-xs">DOCUSIGN_USER_ID</code>,{' '}
                    <code className="font-mono text-xs">DOCUSIGN_ACCOUNT_ID</code>,{' '}
                    <code className="font-mono text-xs">DOCUSIGN_RSA_PRIVATE_KEY</code> (paste the
                    PEM). Missing right now: {ds.missing.join(', ')}.
                  </li>
                </ol>
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5" /> Demo endpoints are the defaults; switching
                  to live signing later is two env values (DOCUSIGN_OAUTH_BASE / DOCUSIGN_API_BASE).
                </p>
              </div>
            )}
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
