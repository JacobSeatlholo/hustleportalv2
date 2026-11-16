'use client'

import { useRef, useState, useEffect } from 'react'
import { Loader2, PenLine, CheckCircle2, Eraser } from 'lucide-react'

// The first-party signing surface: review the PDF inline, draw the signature
// on a canvas, type the name, consent, execute. On success the session is
// stamped and stored server-side; this view swaps to the completed card with
// the download link for the signed copy.
export default function EsignSignPad({ token, docTitle, signerName }: { token: string; docTitle: string; signerName: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signedAt, setSignedAt] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
    const pos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height }
    }
    const down = (e: PointerEvent) => {
      e.preventDefault()
      drawing.current = true
      const p = pos(e)
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      canvas.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!drawing.current) return
      e.preventDefault()
      const p = pos(e)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      setHasInk(true)
    }
    const up = () => {
      drawing.current = false
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
    }
  }, [])

  function clearPad() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
  }

  async function sign() {
    setBusy(true)
    setError(null)
    try {
      const signaturePng = canvasRef.current?.toDataURL('image/png') ?? ''
      const res = await fetch(`/api/sign/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signaturePng, typedName, consent }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string; signedAt?: string } | null
      if (!res.ok) {
        setError(json?.error || `Signing failed (${res.status}).`)
      } else {
        setSignedAt(json?.signedAt ?? new Date().toISOString())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signing failed.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20'

  if (signedAt) {
    return (
      <div className="rounded-2xl border border-brand/40 bg-brand/5 p-8 text-center space-y-4">
        <CheckCircle2 className="h-12 w-12 text-brand mx-auto" />
        <p className="font-display text-2xl">Signed — thank you, {signerName}.</p>
        <p className="text-sm text-muted-foreground">
          Your signature, an execution block and a certificate of electronic signature were applied
          to &ldquo;{docTitle}&rdquo;. A copy link has been emailed to you.
        </p>
        <a
          href={`/api/sign/${token}/file`}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Download signed copy (PDF)
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <p className="px-5 py-3 text-sm font-semibold border-b border-border bg-muted/40">
          Document preview — {docTitle}
        </p>
        <iframe
          src={`/api/sign/${token}/pdf`}
          title={`${docTitle} preview`}
          className="w-full h-[62vh] bg-white"
        />
        <p className="px-5 py-2 text-xs text-muted-foreground">
          Preview not loading? Download to review:{' '}
          <a href={`/api/sign/${token}/pdf`} target="_blank" rel="noopener noreferrer" className="text-brand underline">
            open the document in a new tab
          </a>
          .
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <p className="font-display text-xl flex items-center gap-2">
          <PenLine className="h-5 w-5 text-brand" /> Sign as {signerName}
        </p>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Draw your signature</label>
          <canvas
            ref={canvasRef}
            width={720}
            height={200}
            className="mt-2 w-full rounded-xl border border-border bg-white touch-none cursor-crosshair"
            style={{ height: 'auto', aspectRatio: '720 / 200' }}
          />
          <button onClick={clearPad} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <Eraser className="h-3.5 w-3.5" /> Clear signature
          </button>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type your full name (confirmation)</span>
          <input className={inputCls} value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Your full name" />
        </label>
        <label className="flex items-start gap-3 text-sm text-muted-foreground">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand,#b45309)]" />
          <span>
            I have reviewed this document and consent to sign it electronically. I understand this
            electronic signature has the same legal effect as a handwritten one (Electronic
            Communications and Transactions Act 25 of 2002).
          </span>
        </label>
        <button
          onClick={sign}
          disabled={busy || !hasInk || typedName.trim().length < 2 || !consent}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Executing signature…' : 'Sign the document'}
        </button>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
