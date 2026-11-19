'use client'

// Task 215 (owner): the OPEN corporate sign-up on partner doors. The old
// claim form collected details and promised a callback — the funnel leaked
// there. This one opens the real account on the spot: PREMIUM_DFY tier, the
// R550 exact-five starting credit already in the wallet, session live, and
// the user lands in the app. No access code, no card, no waiting.

import { useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'

const inputCls =
  'w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/60 focus:border-brand focus:ring-2 focus:ring-brand/20'

export default function CorporateSignupForm({ slug, creditRands = 550 }: { slug: string; creditRands?: number }) {
  const [form, setForm] = useState({ name: '', businessName: '', email: '', password: '' })
  // Honeypot, same law as the main registration: a hidden field real humans
  // never see. Bots fill every input they find.
  const [hpField, setHpField] = useState('')
  // Task 221 round 4 (owner, network effect): the door captures ?ref=CODE,
  // the same loop as the main site. A floor member's Grow & Share link lands
  // here with their code, so the signup attributes to the strategist funnel
  // (corporatePartner below) AND to the member (Referral row, the split
  // trail). Same storage law as Landing: localStorage so a signup completed
  // days later still attributes.
  const [refCode] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.location.search
      ? new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase() || localStorage.getItem('hp_ref') || ''
      : localStorage.getItem('hp_ref') || ''
  })
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'sending') return
    setState('sending')
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          name: form.name,
          businessName: form.businessName,
          email: form.email,
          password: form.password,
          companyWebsite: hpField,
          corporatePartner: slug,
          refCode: refCode || undefined,
        }),
      })
      const j = (await res.json().catch(() => null)) as { error?: string } | null
      if (res.ok) {
        // The session cookie is set by the API. Land in the app — at /app,
        // NOT at '/': on the strategist's own domain (app.<brand>) the root
        // serves the marketing door, so '/' bounced a fresh member straight
        // back to the page they signed up from (owner, Task 219). /app is the
        // workspace on every host, main domain and partner domains alike.
        setState('done')
        setTimeout(() => { window.location.href = '/app' }, 2000)
        return
      }
      setError(j?.error || 'Something went wrong on our side. Try again in a moment.')
      setState('error')
    } catch {
      setError('Network hiccup. Check your connection and try again.')
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-3">
        <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
        <p className="font-semibold">Account open. Your R{creditRands} credit is loaded.</p>
        <p className="text-sm text-muted-foreground">
          Taking you straight in — your first verified leads are one search away. The welcome email
          with your account details is on its way too.
        </p>
        {/* The manual door: if the auto-redirect stalls (slow network, popup
            blocker, closed tab), one tap still lands in the workspace. */}
        <a
          href="/app"
          className="inline-flex items-center justify-center rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Open your app now
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {/* Honeypot: invisible to humans, irresistible to bots. */}
      <input
        type="text"
        name="companyWebsite"
        value={hpField}
        onChange={(e) => setHpField(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className={inputCls}
          placeholder="Your name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          maxLength={80}
          required
        />
        <input
          className={inputCls}
          placeholder="Business name"
          value={form.businessName}
          onChange={(e) => set('businessName', e.target.value)}
          maxLength={120}
          required
        />
        <input
          className={inputCls}
          type="email"
          placeholder="Work email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          maxLength={160}
          required
        />
        <input
          className={inputCls}
          type="password"
          placeholder="Choose a password (6+ characters)"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
          maxLength={100}
          required
          minLength={6}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={state === 'sending' || !form.name || !form.email || form.password.length < 6}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {state === 'sending' && <Loader2 className="h-4 w-4 animate-spin" />}
        Get started now — claim my free credit
      </button>
      <p className="text-xs text-muted-foreground text-center">
        No credit card needed. R{creditRands} in starting credit lands in your wallet the moment your
        account opens. By continuing you agree to our{' '}
        <a href="/legal/terms" className="text-brand underline underline-offset-2">Terms</a> and{' '}
        <a href="/legal/privacy" className="text-brand underline underline-offset-2">Privacy &amp; POPIA notice</a>.
      </p>
    </form>
  )
}
