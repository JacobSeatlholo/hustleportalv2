'use client'

/**
 * Onboarding — the two question survey that meets every new account the
 * moment the app opens, before anything else asks for attention.
 *
 * WHY IT EXISTS
 *  People use software they feel was made for them. Two answers (what they
 *  do, what they want first) let the whole product talk back in their words:
 *  the dashboard track, the greeting line, the tutorials they are offered.
 *
 * THE PSYCHOLOGY, DELIBERATE AND HONEST
 *  1. Commitment: small self authored answers prime the real work that
 *     follows. They told us the goal; the app holds them to it.
 *  2. Anticipation: the last step shows their three move plan before they
 *     ever see a dashboard, so the first screen already feels earned.
 *  3. Momentum: progress dots, then a track that fills as real work happens.
 *
 * ORDERING LAW: this survey owns the first moment. The welcome tour waits
 * for it, and a checkout chosen on the landing page waits too (the charge
 * now intent fires the moment this survey settles, so the card form is one
 * tap after the last answer).
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { api } from './shared'
import { useHp, type ViewKey } from './store'
import { PERSONAS, PROFESSIONS, personaOf, professionLabel, type Persona, type Profession } from './tracks'

const DISMISS_KEY = 'hp_onboard_dismissed'
const SETTLE_EVENT = 'hp:onboard-settle'
const OPEN_EVENT = 'hp:onboard-open'
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return at > 0 && Date.now() - at < SEVEN_DAYS
  } catch {
    return false
  }
}

/** True while a brand new account has not answered (or bowed out) yet. */
export function onboardingStillPending(): boolean {
  if (typeof window === 'undefined') return false
  if (recentlyDismissed()) return false
  const user = useHp.getState().session?.user
  if (!user) return false // session not ready: never block a flow on a guess
  return !user.onboardedAt
}

/** Profile replay entry: clear the snooze and ask again. */
export function openOnboarding() {
  try { localStorage.removeItem(DISMISS_KEY) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

export default function Onboarding() {
  const session = useHp((s) => s.session)
  const setView = useHp((s) => s.setView)
  const loadSession = useHp((s) => s.loadSession)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [profession, setProfession] = useState<Profession | null>(null)
  const [persona, setPersona] = useState<Persona | null>(null)
  const [saving, setSaving] = useState(false)

  // Auto open for accounts that never answered. A settle (answered, or
  // maybe later) closes the door for seven days; Profile can reopen it.
  useEffect(() => {
    const u = session?.user
    if (!u) return
    if (u.onboardedAt) return
    if (recentlyDismissed()) return
    const t = setTimeout(() => setOpen(true), 700)
    return () => clearTimeout(t)
  }, [session])

  // Replay hook from Profile.
  useEffect(() => {
    const fire = () => { setStep(0); setOpen(true) }
    window.addEventListener(OPEN_EVENT, fire)
    return () => window.removeEventListener(OPEN_EVENT, fire)
  }, [])

  function settle() {
    window.dispatchEvent(new CustomEvent(SETTLE_EVENT))
  }

  function maybeLater() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* private mode */ }
    setOpen(false)
    settle()
  }

  async function finish() {
    if (!profession || !persona || saving) return
    setSaving(true)
    try {
      await api('/api/onboard', {
        method: 'POST',
        body: JSON.stringify({ persona, profession }),
      })
      try { localStorage.removeItem(DISMISS_KEY) } catch { /* private mode */ }
      await loadSession(true)
      setOpen(false)
      settle()
      // A plan chosen on the landing page is still waiting in hp_plan_intent:
      // the Grow view consumes it on this settle event and opens checkout.
      const intent = typeof window !== 'undefined' ? localStorage.getItem('hp_plan_intent') : null
      if (intent === 'HUSTLER' || intent === 'BOSS') {
        setView('grow')
      } else {
        const home = personaOf(persona)?.homeView as ViewKey | undefined
        if (home) setView(home)
      }
    } catch {
      // The toastless path: the dialog stays open, the button recovers.
    } finally {
      setSaving(false)
    }
  }

  const u = session?.user
  if (!u || u.onboardedAt) return null
  if (!open) return null

  const first = u.name.split(' ')[0] || 'there'
  const pDef = persona ? personaOf(persona) : null
  const fLabel = professionLabel(profession)
  const intent = typeof window !== 'undefined' ? localStorage.getItem('hp_plan_intent') : null
  const planName = intent === 'HUSTLER' ? 'Operator' : intent === 'BOSS' ? 'Boss' : null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) maybeLater() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-brand">
              {step === 0 ? 'One minute, two questions' : step === 1 ? 'Question 2 of 2' : 'Your plan is ready'}
            </span>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-brand' : i < step ? 'w-1.5 bg-brand/60' : 'w-1.5 bg-muted-foreground/30'}`}
                />
              ))}
            </div>
          </div>

          {step === 0 && (
            <>
              <DialogTitle className="font-display text-2xl">Welcome, {first}. What do you do?</DialogTitle>
              <DialogDescription className="text-sm">
                We shape HustlePortal around your kind of work. Pick the closest fit.
              </DialogDescription>
            </>
          )}
          {step === 1 && (
            <>
              <DialogTitle className="font-display text-2xl">What do you want first?</DialogTitle>
              <DialogDescription className="text-sm">
                One goal to start. The rest stays one tap away.
              </DialogDescription>
            </>
          )}
          {step === 2 && (
            <>
              <DialogTitle className="font-display text-2xl">You are set, {first}.</DialogTitle>
              <DialogDescription className="text-sm">
                {pDef && fLabel
                  ? <>You came here to <b className="text-foreground">{pDef.verb}</b> as a {fLabel.toLowerCase()}. Here is how you master it.</>
                  : 'Here is how you master it.'}
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {step === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PROFESSIONS.map((p) => (
              <button
                key={p.key}
                onClick={() => { setProfession(p.key); setStep(1) }}
                className={`text-left rounded-xl border p-3.5 transition hover:border-brand/60 ${profession === p.key ? 'border-brand bg-brand/5' : 'border-border'}`}
              >
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{p.blurb}</div>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.values(PERSONAS).map((p) => (
              <button
                key={p.key}
                onClick={() => { setPersona(p.key); setStep(2) }}
                className={`text-left rounded-xl border p-3.5 transition hover:border-brand/60 ${persona === p.key ? 'border-brand bg-brand/5' : 'border-border'}`}
              >
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{p.blurb}</div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && pDef && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border p-4 space-y-2.5">
              {pDef.track.map((s, i) => (
                <div key={s.label} className="flex items-center gap-3">
                  <span className="h-6 w-6 shrink-0 rounded-full bg-brand/15 text-brand text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <div>
                    <div className="text-sm font-medium leading-tight">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.why}</div>
                  </div>
                </div>
              ))}
            </div>
            {planName && (
              <div className="rounded-xl border border-brand/40 bg-brand/5 p-3.5 text-sm">
                <b className="text-brand">Your {planName} plan is waiting.</b> The next tap opens the secure card form.
              </div>
            )}
            <Button
              onClick={finish}
              disabled={saving}
              className="w-full h-11 bg-brand text-black hover:bg-brand/90 font-semibold"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : planName ? 'Continue to secure checkout' : 'Open my plan'}
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button onClick={maybeLater} className="text-xs text-muted-foreground hover:text-foreground transition">
            Maybe later
          </button>
          {step > 0 && (
            <Button variant="outline" size="sm" onClick={() => setStep((v) => Math.max(0, v - 1))} disabled={saving}>
              Back
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
