'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileSignature, ExternalLink, Loader2, Copy, Check, MailCheck, MailX } from 'lucide-react'

// First-party e-sign send form inside the gated deal room. Creates a signing
// session (token link emailed to the signer when the mail engine is up); the
// boss can always copy the link and send it any way they like.
export default function EsignSendForm({
  slug,
  gateKey,
  docs,
}: {
  slug: string
  gateKey: string
  docs: { file: string; title: string }[]
}) {
  const router = useRouter()
  const [file, setFile] = useState(docs[0]?.file ?? '')
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ url: string; emailed: boolean; emailError?: string } | null>(null)
  const [copied, setCopied] = useState(false)

  async function send() {
    setBusy(true)
    setError(null)
    setCreated(null)
    try {
      const res = await fetch(`/api/corporate/${slug}/esign?key=${encodeURIComponent(gateKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, signerName, signerEmail }),
      })
      const json = (await res.json().catch(() => null)) as
        | { error?: string; url?: string; emailed?: boolean; emailError?: string }
        | null
      if (!res.ok || !json?.url) {
        setError(json?.error || `Could not create the session (${res.status}).`)
      } else {
        setCreated({ url: json.url, emailed: !!json.emailed, emailError: json.emailError })
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the session.')
    } finally {
      setBusy(false)
    }
  }

  async function copyUrl() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard blocked — the URL is selectable text anyway
    }
  }

  const inputCls =
    'w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20'

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <p className="font-display text-xl flex items-center gap-2">
        <FileSignature className="h-5 w-5 text-brand" /> Send for signature
      </p>
      <p className="text-sm text-muted-foreground">
        Creates a signing session on your own infrastructure — no third-party signer. The signer
        reviews the PDF, draws their signature, and the signed copy plus a certificate of
        electronic signature are generated and stored here.
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
        {busy ? 'Creating session…' : 'Create signing session'}
      </button>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3">
          {error}
        </p>
      )}
      {created && (
        <div className="rounded-xl border border-brand/40 bg-brand/5 p-4 space-y-3">
          <p className="text-sm font-semibold text-brand">Signing session created.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs bg-card border border-border rounded-lg px-3 py-2 break-all flex-1 min-w-[16rem]">
              {created.url}
            </code>
            <button
              onClick={copyUrl}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a
              href={created.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
            >
              Open <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            {created.emailed ? (
              <>
                <MailCheck className="h-3.5 w-3.5 text-brand" /> The signing link was emailed to the signer.
              </>
            ) : (
              <>
                <MailX className="h-3.5 w-3.5" /> Email engine not configured — send the link yourself
                ({created.emailError || 'mail unavailable'}).
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
