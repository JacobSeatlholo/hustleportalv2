'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Upload, FileSignature, Download, Trash2, Copy, SendHorizontal, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { api, type DealDocRow, type EsignRow } from './shared'
import { useToast } from '@/hooks/use-toast'

// ============ DOC PANEL (Task 213) ============
// Documents on a task or a deal: upload a PDF, then invite anyone with an
// email to sign it. Signing runs on the first-party e-sign engine (Task 212)
// — the signer gets a /sign/<token> link, draws their signature, and the
// stamped copy + ECTA audit certificate come back automatically. One panel,
// used on both task rows and deal detail.

const STATUS_STYLES: Record<string, string> = {
  SENT: 'bg-amber-500/15 text-amber-500',
  VIEWED: 'bg-sky-500/15 text-sky-500',
  SIGNED: 'bg-emerald-500/15 text-emerald-500',
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function DocPanel({ taskId, dealId }: { taskId?: string; dealId?: string }) {
  const { toast } = useToast()
  const [docs, setDocs] = useState<DealDocRow[] | null>(null)
  const [sessions, setSessions] = useState<EsignRow[]>([])
  const [uploading, setUploading] = useState(false)
  const [signFor, setSignFor] = useState<string | null>(null) // doc id with the invite form open
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [lastLink, setLastLink] = useState<{ token: string; emailed: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const query = taskId ? `taskId=${taskId}` : `dealId=${dealId}`

  const load = useCallback(async () => {
    try {
      const res = await api<{ docs: DealDocRow[]; sessions: EsignRow[] }>(`/api/docs?${query}`)
      setDocs(res.docs)
      setSessions(res.sessions)
    } catch {
      setDocs([])
    }
  }, [query])

  useEffect(() => {
    load()
  }, [load])

  async function upload(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (taskId) fd.append('taskId', taskId)
      if (dealId) fd.append('dealId', dealId)
      const res = await fetch('/api/docs', { method: 'POST', body: fd })
      const json = (await res.json().catch(() => null)) as { doc?: DealDocRow; error?: string } | null
      if (!res.ok || !json?.doc) throw new Error(json?.error || 'Upload failed')
      await load()
      toast({ title: 'Document uploaded', description: 'Invite someone to sign it below.' })
    } catch (e) {
      toast({ title: 'Could not upload', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeDoc(doc: DealDocRow) {
    try {
      await api(`/api/docs/${doc.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      toast({ title: 'Could not delete', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  async function inviteSign(doc: DealDocRow) {
    if (!signerName.trim() || !signerEmail.trim()) return
    setSending(true)
    try {
      const res = await api<{ ok: boolean; url: string; emailed: boolean; emailError?: string }>(`/api/docs/${doc.id}/esign`, {
        method: 'POST',
        body: JSON.stringify({ signerName: signerName.trim(), signerEmail: signerEmail.trim() }),
      })
      setSignFor(null)
      setSignerName('')
      setSignerEmail('')
      setLastLink({ token: res.url.split('/sign/')[1] || '', emailed: res.emailed })
      await load()
      toast({
        title: res.emailed ? 'Signing link emailed' : 'Signing link created',
        description: res.emailed ? `${signerEmail} can review and sign now.` : 'Copy the link below and send it yourself.',
      })
    } catch (e) {
      toast({ title: 'Could not create the signing session', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/sign/${token}`)
      toast({ title: 'Link copied' })
    } catch {
      toast({ title: 'Copy failed — select the link text instead', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium flex items-center gap-1.5">
          <FileSignature className="h-3.5 w-3.5 text-brand" /> Documents &amp; signatures
        </p>
        <label className="cursor-pointer">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={uploading} onClick={(e) => { e.preventDefault(); fileRef.current?.click() }}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1 text-brand" />} Upload PDF
          </Button>
        </label>
      </div>

      {!docs || docs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No documents yet. Upload the agreement or any PDF, then invite someone to sign — the signed copy comes back with an audit certificate.
        </p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((d) => {
            const docSessions = sessions.filter((s) => s.docFileId === d.id)
            return (
              <div key={d.id} className="rounded-lg border bg-muted/20 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs font-medium truncate flex-1" title={d.filename}>{d.filename}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{fmtBytes(d.size)} · {fmtDate(d.createdAt)}</span>
                  <a href={`/api/docs/${d.id}/file`} title="Download original">
                    <Download className="h-3.5 w-3.5 text-muted-foreground hover:text-brand" />
                  </a>
                  {docSessions.length === 0 && (
                    <button title="Delete document" onClick={() => removeDoc(d)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                    </button>
                  )}
                  <button
                    onClick={() => setSignFor((v) => (v === d.id ? null : d.id))}
                    className="text-[11px] font-medium text-brand hover:underline shrink-0"
                  >
                    {docSessions.length > 0 ? 'Invite again' : 'Invite to sign'}
                    {signFor === d.id ? <ChevronUp className="inline h-3 w-3 ml-0.5" /> : <ChevronDown className="inline h-3 w-3 ml-0.5" />}
                  </button>
                </div>

                {docSessions.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2 pl-5 text-[11px]">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[s.status] || 'bg-muted'}`}>{s.status}</span>
                    <span className="font-medium">{s.signerName}</span>
                    <span className="text-muted-foreground">{s.signerEmail}</span>
                    <span className="text-muted-foreground">
                      {s.status === 'SIGNED' && s.signedAt ? `signed ${fmtDate(s.signedAt)}` : s.status === 'VIEWED' && s.viewedAt ? `viewed ${fmtDate(s.viewedAt)}` : `sent ${fmtDate(s.createdAt)}`}
                    </span>
                    <button className="inline-flex items-center gap-1 text-brand hover:underline" onClick={() => copyLink(s.token)}>
                      <Copy className="h-3 w-3" /> {s.status === 'SIGNED' ? 'copy signing page' : 'copy link'}
                    </button>
                  </div>
                ))}

                {signFor === d.id && (
                  <div className="flex flex-wrap items-center gap-2 pl-5 pt-1">
                    <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Signer name" className="h-8 w-[160px] text-xs" />
                    <Input
                      value={signerEmail}
                      onChange={(e) => setSignerEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && inviteSign(d)}
                      placeholder="Signer email"
                      className="h-8 w-[200px] text-xs"
                    />
                    <Button size="sm" className="h-8 text-xs" onClick={() => inviteSign(d)} disabled={sending || !signerName.trim() || !signerEmail.trim()}>
                      {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5 mr-1" />} Send
                    </Button>
                    <span className="text-[10px] text-muted-foreground">They sign on their own page; the stamped copy + certificate come back automatically.</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {lastLink && (
        <div className="rounded-lg border border-brand/40 bg-brand/5 p-2 text-[11px] flex items-center gap-2">
          <span className="text-muted-foreground">{lastLink.emailed ? 'Emailed. Backup link:' : 'Share this link:'}</span>
          <code className="truncate flex-1 font-mono">{`${typeof window !== 'undefined' ? window.location.origin : ''}/sign/${lastLink.token}`}</code>
          <button className="text-brand hover:underline shrink-0" onClick={() => copyLink(lastLink.token)}>copy</button>
        </div>
      )}
    </div>
  )
}
