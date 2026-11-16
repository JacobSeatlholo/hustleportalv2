import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ShieldCheck, FileSignature } from 'lucide-react'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import EsignSignPad from '@/components/hp/corporate/EsignSignPad'
import { db } from '@/lib/db'
import { sast } from '@/lib/esign'

// ============ SIGNING PAGE (Task 212) ============
// /sign/<token> — the token is the secret and the authority: whoever holds it
// can review and sign this one document, nothing else. No account, no gate
// key. noindex everywhere. First-party from end to end.

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Sign document — HustlePortal e-sign', robots: { index: false, follow: false } }
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await db.esignSession.findUnique({ where: { token } })
  if (!session) notFound()

  const done = session.status === 'SIGNED' && !!session.signedPdf

  return (
    <CorporateShell>
      <main className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
          <header className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand flex items-center gap-2">
              <FileSignature className="h-3.5 w-3.5" /> HustlePortal e-sign — first-party, no third-party signer
            </p>
            <h1 className="font-display text-4xl leading-tight">
              {done ? 'Signature complete' : 'Review and sign'}
            </h1>
            <p className="text-muted-foreground">
              {done
                ? `"${session.docTitle}" was signed by ${session.signerName}.`
                : `You have been asked to review and sign "${session.docTitle}".`}
            </p>
          </header>

          {done ? (
            <div className="rounded-2xl border border-brand/40 bg-brand/5 p-8 space-y-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-8 w-8 text-brand" />
                <div>
                  <p className="font-display text-xl">Executed on {session.signedAt ? sast(session.signedAt) : ''}</p>
                  <p className="text-sm text-muted-foreground">
                    Signed by {session.signerName} &lt;{session.signerEmail}&gt; from IP {session.signerIp || 'unknown'}.
                  </p>
                </div>
              </div>
              <dl className="text-xs text-muted-foreground space-y-1 font-mono break-all">
                <div>Document: {session.docBase}</div>
                <div>Signed file SHA-256: {session.signedSha256 || '—'}</div>
                <div>Session: {session.id}</div>
              </dl>
              <a
                href={`/api/sign/${session.token}/file`}
                className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Download signed copy (PDF)
              </a>
              <p className="text-xs text-muted-foreground">
                The certificate of electronic signature is appended as the final page. This link is
                the permanent home of the signed copy — keep it.
              </p>
            </div>
          ) : (
            <EsignSignPad token={session.token} docTitle={session.docTitle} signerName={session.signerName} />
          )}

          <footer className="text-xs text-muted-foreground border-t border-border pt-4">
            This signing session covers exactly one document. Electronic signatures carry legal
            effect under the Electronic Communications and Transactions Act 25 of 2002 (South
            Africa). The audit trail (view and sign times, IPs, file hashes) is recorded by
            HustlePortal on its own infrastructure.
          </footer>
        </div>
      </main>
    </CorporateShell>
  )
}
