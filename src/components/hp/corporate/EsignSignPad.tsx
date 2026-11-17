'use client'

import { useRef, useState, useEffect, type RefObject } from 'react'
import { Loader2, PenLine, CheckCircle2, Eraser, BookmarkCheck, Plus, X } from 'lucide-react'

// The first-party signing surface (Task 215 round 2): review the PDF inline,
// draw (or reuse the saved) signature, optional initials — stamped bottom-right
// of EVERY page — typed info rows for what the document should say, consent,
// execute. The signature and initials are saved on this device after a
// successful signing (localStorage, no account needed — the token is the
// secret), so the next document loads them automatically: save once, sign in
// seconds. On success the session is stamped and stored server-side; this
// view swaps to the completed card with the inline signed copy and download.

const PROFILE_KEY = 'esign-profile-v1'

interface Profile {
  sig: string // data URL of the drawn signature
  init: string // data URL of the drawn initials ('' when none)
  name: string // the typed name last used
}

function loadProfile(): Profile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Profile
    return p && typeof p.sig === 'string' && p.sig.startsWith('data:image/png') ? p : null
  } catch {
    return null
  }
}

function saveProfile(p: Profile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  } catch {
    // private mode — the session still signs, the profile just doesn't persist
  }
}

function paintDataUrl(canvasRef: RefObject<HTMLCanvasElement | null>, dataUrl: string, done: () => void) {
  const canvas = canvasRef.current
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = new Image()
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    done()
  }
  img.src = dataUrl
}

function attachPad(canvasRef: RefObject<HTMLCanvasElement | null>, onInk: () => void) {
  const canvas = canvasRef.current
  if (!canvas) return () => {}
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
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
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    canvas.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      ev.preventDefault()
      const q = pos(ev)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
      onInk()
    }
    const up = () => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
    }
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
  }
  canvas.addEventListener('pointerdown', down)
  return () => canvas.removeEventListener('pointerdown', down)
}

export default function EsignSignPad({ token, docTitle, signerName }: { token: string; docTitle: string; signerName: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const initialsRef = useRef<HTMLCanvasElement | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [hasInitials, setHasInitials] = useState(false)
  const [restored, setRestored] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [fields, setFields] = useState<Array<{ label: string; value: string }>>([
    { label: '', value: '' },
    { label: '', value: '' },
  ])
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signedAt, setSignedAt] = useState<string | null>(null)

  useEffect(() => attachPad(canvasRef, () => setHasInk(true)), [])
  useEffect(() => attachPad(initialsRef, () => setHasInitials(true)), [])
  useEffect(() => {
    const p = loadProfile()
    if (!p) return
    if (p.sig) paintDataUrl(canvasRef, p.sig, () => setHasInk(true))
    if (p.init) paintDataUrl(initialsRef, p.init, () => setHasInitials(true))
    if (p.name) setTypedName(p.name)
    setRestored(true)
  }, [])

  function clearPad(which: 'sig' | 'init') {
    const canvas = which === 'sig' ? canvasRef.current : initialsRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (which === 'sig') setHasInk(false)
    else setHasInitials(false)
  }

  function setField(i: number, part: 'label' | 'value', v: string) {
    setFields((rows) => rows.map((r, ri) => (ri === i ? { ...r, [part]: v } : r)))
  }

  async function sign() {
    setBusy(true)
    setError(null)
    try {
      const signaturePng = canvasRef.current?.toDataURL('image/png') ?? ''
      const initialsPng = hasInitials ? (initialsRef.current?.toDataURL('image/png') ?? '') : ''
      const res = await fetch(`/api/sign/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signaturePng, initialsPng: initialsPng || undefined, typedName, consent, typedFields: fields }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string; signedAt?: string } | null
      if (!res.ok) {
        setError(json?.error || `Signing failed (${res.status}).`)
      } else {
        // Profile saved once, on this device — every future signing page on
        // this browser loads the same signature, initials and name.
        saveProfile({ sig: signaturePng, init: initialsPng, name: typedName })
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
          Your signature, initials on every page, your typed info, an execution
          block and a certificate of electronic signature were applied to &ldquo;{docTitle}&rdquo;.
          A copy link has been emailed to you.
        </p>
        <a
          href={`/api/sign/${token}/file`}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Download signed copy (PDF)
        </a>
        <p className="text-xs text-muted-foreground">
          Your signature and initials are saved on this device — the next document you sign loads
          them automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <p className="px-5 py-3 text-sm font-semibold border-b border-border bg-muted/40">
          1 · Review the document — {docTitle}
        </p>
        <iframe
          src={`/api/sign/${token}/pdf`}
          title={`${docTitle} preview`}
          className="w-full h-[62vh] bg-white"
        />
        <p className="px-5 py-2 text-xs text-muted-foreground">
          Preview not loading?{' '}
          <a href={`/api/sign/${token}/pdf`} target="_blank" rel="noopener noreferrer" className="text-brand underline">
            Open the document in a new tab
          </a>{' '}
          or{' '}
          <a href={`/api/sign/${token}/pdf`} download className="text-brand underline">
            download the review copy
          </a>{' '}
          — review before you sign, exactly as you would on paper.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <p className="font-display text-xl flex items-center gap-2">
          <PenLine className="h-5 w-5 text-brand" /> 2 · Sign as {signerName}
        </p>
        {restored && (
          <p className="text-xs text-brand flex items-center gap-1.5 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2">
            <BookmarkCheck className="h-3.5 w-3.5 shrink-0" />
            Loaded your saved signature{typedName ? ' and name' : ''} from this device. Draw again
            to replace; clearing here only affects this session until you sign.
          </p>
        )}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Draw your signature</label>
          <canvas
            ref={canvasRef}
            width={720}
            height={200}
            className="mt-2 w-full rounded-xl border border-border bg-white touch-none cursor-crosshair"
            style={{ height: 'auto', aspectRatio: '720 / 200' }}
          />
          <button onClick={() => clearPad('sig')} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <Eraser className="h-3.5 w-3.5" /> Clear signature
          </button>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Initials — stamped bottom-right of every page
          </label>
          <canvas
            ref={initialsRef}
            width={360}
            height={110}
            className="mt-2 w-1/2 min-w-[200px] rounded-xl border border-border bg-white touch-none cursor-crosshair"
            style={{ height: 'auto', aspectRatio: '360 / 110' }}
          />
          <button onClick={() => clearPad('init')} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <Eraser className="h-3.5 w-3.5" /> Clear initials
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <p className="font-display text-xl">3 · Type what the document should say</p>
        <p className="text-sm text-muted-foreground">
          Anything typed here is written into the execution block of the signed copy — name,
          capacity, company, effective date, whatever the document needs from you.
        </p>
        {fields.map((f, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={`${inputCls} w-1/3 shrink-0`}
              value={f.label}
              onChange={(e) => setField(i, 'label', e.target.value)}
              placeholder="Label (e.g. Capacity)"
              maxLength={60}
            />
            <input
              className={`${inputCls} flex-1`}
              value={f.value}
              onChange={(e) => setField(i, 'value', e.target.value)}
              placeholder="Value (e.g. Director, for and on behalf of Business Hustle)"
              maxLength={200}
            />
            <button
              onClick={() => setFields((rows) => rows.filter((_, ri) => ri !== i))}
              disabled={fields.length <= 1}
              aria-label="Remove this field"
              className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground hover:text-red-600 hover:border-red-300 transition disabled:opacity-30"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        {fields.length < 8 && (
          <button
            onClick={() => setFields((rows) => [...rows, { label: '', value: '' }])}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Add another field
          </button>
        )}
        <label className="block space-y-1.5 pt-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your full name (executes the signature)</span>
          <input className={inputCls} value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Your full name" maxLength={120} />
        </label>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <p className="font-display text-xl">4 · Consent and sign</p>
        <label className="flex items-start gap-3 text-sm text-muted-foreground">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand,#b45309)]" />
          <span>
            I have reviewed this document, I consent to sign it electronically, and I understand
            this electronic signature has the same legal effect as a handwritten one (Electronic
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
