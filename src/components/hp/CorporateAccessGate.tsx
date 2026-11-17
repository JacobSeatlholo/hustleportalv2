'use client'

// Task 215: the locked corporate door. The generic /corporate page is the
// B2B access point, not an open funnel: corporate access is by invitation.
// Two paths, side by side:
//   1. An access code from a team member — validates against the same
//      resolver the claim API uses, then reveals the claim form inline.
//   2. An invitation application — the mini survey (what they sell, how many
//      leads they need) that the boss reviews and answers with a code.
// Plus the sign-in path for existing corporate clients: the app login at /.

import { useEffect, useState } from 'react'
import { KeyRound, Loader2, CheckCircle2, LogIn, ClipboardList } from 'lucide-react'
import CorporateClaimForm from '@/components/hp/CorporateClaimForm'

const inputCls =
  'w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/60 focus:border-brand focus:ring-2 focus:ring-brand/20'

export default function CorporateAccessGate() {
  const [tab, setTab] = useState<'code' | 'apply'>('code')

  // --- code path state (URL ?via= prefill lands client-side only; the
  // initializer also runs during SSR where window does not exist) ---
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [codeError, setCodeError] = useState('')
  const [unlockedCode, setUnlockedCode] = useState('')
  useEffect(() => {
    const via = new URLSearchParams(window.location.search).get('via') || ''
    if (via) setCode(via)
  }, [])

  // --- application state ---
  const [app, setApp] = useState({ business: '', contactName: '', email: '', phone: '', teamSize: '', industry: '', leadsNeeded: '', message: '' })
  const [appState, setAppState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [appError, setAppError] = useState('')

  function set<K extends keyof typeof app>(key: K, value: string) {
    setApp((f) => ({ ...f, [key]: value }))
  }

  async function checkCode(e: React.FormEvent) {
    e.preventDefault()
    if (checking) return
    setChecking(true)
    setCodeError('')
    try {
      const res = await fetch('/api/corporate/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && j?.ok) {
        setUnlockedCode(code)
      } else {
        setCodeError(j?.error || 'That code does not open this door.')
      }
    } catch {
      setCodeError('Network hiccup. Check your connection and try again.')
    } finally {
      setChecking(false)
    }
  }

  async function submitApp(e: React.FormEvent) {
    e.preventDefault()
    if (appState === 'sending') return
    setAppState('sending')
    setAppError('')
    try {
      const res = await fetch('/api/corporate/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...app }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && j?.ok) {
        setAppState('done')
        return
      }
      setAppError(j?.error || 'Something went wrong on our side. Try again in a moment.')
      setAppState('error')
    } catch {
      setAppError('Network hiccup. Check your connection and try again.')
      setAppState('error')
    }
  }

  if (unlockedCode) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> Code accepted. Claim your credit below.
        </p>
        <CorporateClaimForm accessCode={unlockedCode} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-border bg-card p-1">
        <button
          onClick={() => setTab('code')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === 'code' ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <KeyRound className="h-4 w-4" /> I have an access code
        </button>
        <button
          onClick={() => setTab('apply')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === 'apply' ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <ClipboardList className="h-4 w-4" /> Apply for an invitation
        </button>
      </div>

      {tab === 'code' ? (
        <form onSubmit={checkCode} className="space-y-3" noValidate>
          <input
            className={inputCls + ' font-mono tracking-widest uppercase'}
            placeholder="Access code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={40}
            required
          />
          {codeError && <p className="text-sm text-destructive">{codeError}</p>}
          <button
            type="submit"
            disabled={checking}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {checking && <Loader2 className="h-4 w-4 animate-spin" />}
            Open my claim form
          </button>
          <p className="text-xs text-muted-foreground text-center">
            Codes come from our team members. No code? Apply for an invitation instead.
          </p>
        </form>
      ) : appState === 'done' ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-2">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
          <p className="font-semibold">Application received.</p>
          <p className="text-sm text-muted-foreground">
            We read every application personally. If your business fits the corporate programme, your
            invitation and access code arrive by email.
          </p>
        </div>
      ) : (
        <form onSubmit={submitApp} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={inputCls} placeholder="Business name" value={app.business} onChange={(e) => set('business', e.target.value)} maxLength={120} required />
            <input className={inputCls} placeholder="Your name" value={app.contactName} onChange={(e) => set('contactName', e.target.value)} maxLength={80} required />
            <input className={inputCls} type="email" placeholder="Work email" value={app.email} onChange={(e) => set('email', e.target.value)} maxLength={160} required />
            <input className={inputCls} type="tel" placeholder="Phone (optional)" value={app.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} />
            <input className={inputCls} placeholder="What does your business sell?" value={app.industry} onChange={(e) => set('industry', e.target.value)} maxLength={80} required />
            <input className={inputCls} placeholder="Leads needed per month (e.g. 50)" value={app.leadsNeeded} onChange={(e) => set('leadsNeeded', e.target.value)} maxLength={60} required />
          </div>
          <select className={inputCls} value={app.teamSize} onChange={(e) => set('teamSize', e.target.value)}>
            <option value="">How many sellers? (optional)</option>
            {['1 to 5 sellers', '6 to 20 sellers', '21 to 50 sellers', 'More than 50'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <textarea
            className={inputCls + ' min-h-[88px] resize-y'}
            placeholder="Who do you sell to, and what does a good lead look like? (optional)"
            value={app.message}
            onChange={(e) => set('message', e.target.value)}
            maxLength={600}
          />
          {appError && <p className="text-sm text-destructive">{appError}</p>}
          <button
            type="submit"
            disabled={appState === 'sending'}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {appState === 'sending' && <Loader2 className="h-4 w-4 animate-spin" />}
            Apply for an invitation
          </button>
          <p className="text-xs text-muted-foreground text-center">
            We read every application personally. Fit means an invitation with your own access code.
          </p>
        </form>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground border-t border-border pt-4">
        <LogIn className="h-3.5 w-3.5" />
        Already a corporate client?{' '}
        <a href="/?view=dashboard" className="text-brand underline underline-offset-2 font-semibold">Sign in here</a>
        {' '}— your managed leads are waiting in your pipeline.
      </p>
    </div>
  )
}
