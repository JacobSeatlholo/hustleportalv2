'use client'

// ============ TESTIMONIAL SUBMIT FORM (Task 219, owner) ============
// "Users should be able to submit testimonials on the site." One shared form
// for every surface: the strategist doors (his clients tell his story), the
// generic corporate door and the main landing. Laws:
//  - nothing goes live from this form: rows land approved=false and the desk
//    approves them in the exec dashboard (Task 213 "no invented testimonials"
//    is enforced by that flag, not by hope);
//  - honeypot + rate limit live in the API, same as every public form;
//  - the success state says exactly what happens next, so the UX never just
//    "ends there" — the same standard the owner set for the signup flow.

import { useState } from 'react'
import { CheckCircle2, Loader2, Star } from 'lucide-react'

const inputCls =
  'w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/60 focus:border-brand focus:ring-2 focus:ring-brand/20'

export default function TestimonialForm({ door }: { door?: string }) {
  const [form, setForm] = useState({ name: '', business: '', location: '', body: '' })
  const [rating, setRating] = useState(5)
  const [hpField, setHpField] = useState('')
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
      const res = await fetch('/api/testimonials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          business: form.business,
          location: form.location,
          body: form.body,
          rating,
          slug: door ?? '',
          companyWebsite: hpField,
        }),
      })
      const j = (await res.json().catch(() => null)) as { error?: string } | null
      if (res.ok) {
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
        <p className="font-semibold">Thank you — your story is in.</p>
        <p className="text-sm text-muted-foreground">
          The team reads every story before it shows on the wall. Yours goes live once it is
          approved.
        </p>
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
      <div className="grid gap-3 sm:grid-cols-3">
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
          placeholder="Business or role (optional)"
          value={form.business}
          onChange={(e) => set('business', e.target.value)}
          maxLength={120}
        />
        <input
          className={inputCls}
          placeholder="Town or city (optional)"
          value={form.location}
          onChange={(e) => set('location', e.target.value)}
          maxLength={80}
        />
      </div>
      <textarea
        className={`${inputCls} min-h-24`}
        placeholder="How did the verified leads work for your business? Two or three honest sentences are perfect."
        value={form.body}
        onChange={(e) => set('body', e.target.value)}
        maxLength={600}
        required
      />
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Your rating:</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`Rate ${n} out of 5`}
              className="p-0.5"
            >
              <Star className={`h-5 w-5 transition ${n <= rating ? 'fill-brand text-brand' : 'text-muted-foreground/40'}`} />
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={state === 'sending' || form.name.trim().length < 2 || form.body.trim().length < 20}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {state === 'sending' && <Loader2 className="h-4 w-4 animate-spin" />}
        Share my story
      </button>
      <p className="text-xs text-muted-foreground text-center">
        Every story is read by the team before it shows on the wall. Nothing goes live without a
        human yes.
      </p>
    </form>
  )
}
