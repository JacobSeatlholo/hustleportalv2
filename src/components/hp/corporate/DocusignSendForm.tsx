'use client'

import { useState } from 'react'
import { FileSignature, ExternalLink, Loader2 } from 'lucide-react'

// The DocuSign send form inside the gated deal room. Posts to the gated API
// with the same key the page was opened with; on success the signer opens the
// returned recipient-view URL in a new tab (embedded free-form signing).
export default function DocusignSendForm({
  slug,
  gateKey,
  docs,
}: {
  slug: string
  gateKey: string
  docs: { file: string; title: string }[]
}) {
  const [file, setFile] = useState(docs[0]?.file ?? '')
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signingUrl, setSigningUrl] = useState<string | null>(null)
  const [envelopeId, setEnvelopeId] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    setSigningUrl(null)
    setEnvelopeId(null)
    try {
      const res = await fetch(`/api/corporate/${slug}/docusign?key=${encodeURIComponent(gateKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, signerName, signerEmail }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string; url?: string; envelopeId?: string } | null
      if (!res.ok || !json?.url) {
        setError(json?.error || `Send failed (${res.status}).`)
      } else {
        setSigningUrl(json.url)
        setEnvelopeId(json.envelopeId ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20'

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <p className="font-display text-xl flex items-center gap-2">
        <FileSignature className="h-5 w-5 text-brand" /> Send for signature (DocuSign)
      </p>
      <p className="text-sm text-muted-foreground">
        Creates a DocuSign envelope from the draft PDF and returns an embedded signing window for
        the counterparty. Free-form signing: they place their signature themselves.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Document (PDF)</span>
          <select className={inputCls} value={file} onChange={(e) => setFile(e.target.value)}>
            {docs.map((d) => (
              <option key={d.file} value={d.file}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Signer name</span>
          <input className={inputCls} value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="e.g. Kelo Anthony Martins" />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Signer email</span>
          <input className={inputCls} type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} placeholder="them@company.co.za" />
        </label>
      </div>
      <button
        onClick={send}
        disabled={busy || !file || !signerName || !signerEmail}
        className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? 'Creating envelope…' : 'Create envelope and open signing'}
      </button>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3">
          {error}
        </p>
      )}
      {signingUrl && (
        <div className="rounded-xl border border-brand/40 bg-brand/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-brand">Envelope {envelopeId} is ready.</p>
          <a
            href={signingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand underline"
          >
            Open the DocuSign signing window <ExternalLink className="h-4 w-4" />
          </a>
          <p className="text-xs text-muted-foreground">
            The signer lands back here when they finish. DocuSign emails them a copy of the signed
            document.
          </p>
        </div>
      )}
    </div>
  )
}
