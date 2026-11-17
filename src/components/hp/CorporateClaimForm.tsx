'use client'

// Task 207: the claim form on the corporate landing page. Plain fetch, inline
// confirmation, no toast hop: the promise ("our corporate team reaches out
// personally") is the response, shown right where the button was.
// Task 208: carries referral attribution. refSlug arrives from the strategist
// door (/corporate/<slug>); refMember arrives from a member's outreach link
// (?via=<code>) read off the URL here, since members share links directly.
// Task 215: corporate is a locked channel — the claim posts an access code
// (a team member's code, or one the boss minted). The server re-resolves it;
// when the caller already validated one (the generic door's gate) it is
// passed in and the input is skipped.

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, KeyRound } from 'lucide-react'

const TEAM_SIZES = ['1 to 5 sellers', '6 to 20 sellers', '21 to 50 sellers', 'More than 50']

const inputCls =
  'w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/60 focus:border-brand focus:ring-2 focus:ring-brand/20'

export default function CorporateClaimForm({ refSlug, accessCode: prevalidated }: { refSlug?: string; accessCode?: string }) {
  const [form, setForm] = useState({ business: '', contactName: '', email: '', phone: '', teamSize: '', message: '' })
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  // The code starts from the URL: a member's ?via= link IS the code that
  // opened this door for this prospect. Read in an effect — the initializer
  // runs during SSR too, where window does not exist.
  const [code, setCode] = useState('')
  const [unlocked, setUnlocked] = useState(!!prevalidated)
  const [codeError, setCodeError] = useState('')
  useEffect(() => {
    const via = new URLSearchParams(window.location.search).get('via') || ''
    if (via) setCode(via)
  }, [])

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function checkCode() {
    if (state === 'sending') return
    setCodeError('')
    try {
      const res = await fetch('/api/corporate/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, slug: refSlug || '' }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && j?.ok) {
        setUnlocked(true)
      } else {
        setCodeError(j?.error || 'That code does not open this door.')
      }
    } catch {
      setCodeError('Network hiccup. Check your connection and try again.')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'sending') return
    setState('sending')
    setError('')
    try {
      const via = new URLSearchParams(window.location.search).get('via') || ''
      const res = await fetch('/api/corporate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          accessCode: prevalidated || code || via,
          refSlug: refSlug || '',
          refMember: refSlug ? via : '',
        }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && j?.ok) {
        setState('done')
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
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-2">
        <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
        <p className="font-semibold">Claimed. The credit is yours.</p>
        <p className="text-sm text-muted-foreground">
          Our corporate team reaches out personally to set your account up and apply your R550 starting credit.
          Keep an eye on your inbox.
        </p>
      </div>
    )
  }

  if (!unlocked) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          checkCode()
        }}
        className="space-y-3"
        noValidate
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-brand" />
          {refSlug ? 'Enter the access code your team member gave you' : 'Corporate access is by invitation'}
        </div>
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
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Open my claim form
        </button>
        <p className="text-xs text-muted-foreground text-center">
          Codes come from our team members. No code? The door next to this form takes invitation applications.
        </p>
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className={inputCls}
          placeholder="Business name"
          value={form.business}
          onChange={(e) => set('business', e.target.value)}
          maxLength={120}
          required
        />
        <input
          className={inputCls}
          placeholder="Your name"
          value={form.contactName}
          onChange={(e) => set('contactName', e.target.value)}
          maxLength={80}
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
          type="tel"
          placeholder="Phone (optional)"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          maxLength={30}
        />
      </div>
      <select className={inputCls} value={form.teamSize} onChange={(e) => set('teamSize', e.target.value)}>
        <option value="">How many sellers? (optional)</option>
        {TEAM_SIZES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <textarea
        className={inputCls + ' min-h-[88px] resize-y'}
        placeholder="What are you selling, and to whom? (optional)"
        value={form.message}
        onChange={(e) => set('message', e.target.value)}
        maxLength={600}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {state === 'sending' && <Loader2 className="h-4 w-4 animate-spin" />}
        Claim my R550 starting credit
      </button>
      <p className="text-xs text-muted-foreground text-center">
        No card needed. We set your account up personally and the credit lands before you spend a cent.
      </p>
    </form>
  )
}
