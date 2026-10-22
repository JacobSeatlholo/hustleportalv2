'use client'

/**
 * WelcomeTour, pop-ups that welcome and guide every new user through the
 * platform. Fires once on first dashboard entry (per browser); replayable from
 * Profile. Negative-churn by design: users who complete onboarding are far
 * less likely to churn, so the tour sells OUTCOMES (outsell, outlast,
 * outperform) and ends on the invite loop.
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { useHp } from './store'
import { openInstallTutorial } from './InstallApp'
import {
  Target, Sparkles, Mail, Users, ArrowRight, Rocket, Trophy, Zap, Smartphone,
} from 'lucide-react'

const TOUR_KEY = 'hp_tour_done_v2'

interface Step {
  icon: React.ReactNode
  kicker: string
  title: string
  body: string
  cta: string
  goTo?: () => void
}

export default function WelcomeTour() {
  const setView = useHp((s) => s.setView)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    // ORDERING LAW: the two question onboarding survey owns the first moment.
    // The tour waits for a settled account (answered, or maybe later) and
    // only then walks them around. Polls until the session resolves; the
    // hp:onboard-settle event covers the exact moment onboarding finishes.
    if (typeof window === 'undefined') return
    if (localStorage.getItem(TOUR_KEY) === '1') return
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = () => {
      tries++
      const u = useHp.getState().session?.user
      if (!u) {
        if (tries < 20) timer = setTimeout(attempt, 700)
        return
      }
      const settled = Boolean(u.onboardedAt) || localStorage.getItem('hp_onboard_dismissed') !== null
      if (!settled) {
        if (tries < 30) timer = setTimeout(attempt, 900)
        return
      }
      setOpen(true)
    }
    timer = setTimeout(attempt, 1200)
    const onSettle = () => {
      if (timer) clearTimeout(timer)
      if (localStorage.getItem(TOUR_KEY) !== '1') attempt()
    }
    window.addEventListener('hp:onboard-settle', onSettle)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('hp:onboard-settle', onSettle)
    }
  }, [])

  useEffect(() => {
    // Replay hook (Profile & Team → "Replay the tour").
    const fire = () => { setStep(0); setOpen(true) }
    window.addEventListener('hp:tour-fire', fire)
    return () => window.removeEventListener('hp:tour-fire', fire)
  }, [])

  const steps: Step[] = [
    {
      icon: <Rocket className="h-7 w-7 text-brand" />,
      kicker: 'Welcome to HustlePortal',
      title: 'Outsell. Outlast. Outperform.',
      body: 'This is your Business OS, leads, follow-ups, invoicing and an AI co-founder that knows your numbers, in one professional system. Let\'s take 30 seconds to show you around.',
      cta: "Show me around",
    },
    {
      icon: <Target className="h-7 w-7 text-brand" />,
      kicker: 'Find customers',
      title: 'Verified leads, ready to call',
      body: 'The Lead Finder is loaded with real businesses that need what you sell. Reveal contacts with credits, move them through your pipeline, and never let a hot lead go cold.',
      cta: 'Go to Lead Finder',
      goTo: () => setView('leads'),
    },
    {
      icon: <Sparkles className="h-7 w-7 text-brand" />,
      kicker: 'Your unfair advantage',
      title: 'The AI Co-Founder knows your business',
      body: 'Ask it anything, pricing, pitch, follow-ups, next moves. It reads your real pipeline and answers like a sharp business partner. Included free with every plan.',
      cta: 'Meet your Co-Founder',
      goTo: () => setView('ai'),
    },
    {
      icon: <Mail className="h-7 w-7 text-brand" />,
      kicker: 'Close deals on autopilot',
      title: 'Emails that send themselves',
      body: 'AI drafts the follow-up in your voice; HustlePortal sends it and tracks it. Replies come straight back to you. This is how the most consistent businesses outlast everyone who forgets to follow up.',
      cta: 'Open Mail',
      goTo: () => setView('mail'),
    },
    {
      icon: <Users className="h-7 w-7 text-brand" />,
      kicker: 'Grow together',
      title: 'Invite owners. Earn R50 each.',
      body: 'Teams that grow together, win together. Share your invite link, when someone subscribes, you earn R50 credit and they start with a bonus. Your link is ready in Grow & Earn.',
      cta: 'Get my invite link',
      goTo: () => setView('grow'),
    },
    {
      icon: <Smartphone className="h-7 w-7 text-brand" />,
      kicker: 'One-tap access',
      title: 'Take HustlePortal home',
      body: 'Add HustlePortal to your phone\'s home screen, it opens full screen like a proper app, one tap away. iPhone: Share → Add to Home Screen. Android: menu → Install app.',
      cta: 'Show me how (30 sec)',
      goTo: openInstallTutorial,
    },
    {
      icon: <Trophy className="h-7 w-7 text-brand" />,
      kicker: 'You\'re ready',
      title: 'Let\'s get you paid',
      body: 'Add your first lead, send your first follow-up, and watch your streak grow. HustlePortal levels up as you do, every action earns XP. Now go outperform.',
      cta: "Let's get to work",
    },
  ]

  const s = steps[step]
  const last = step === steps.length - 1

  function finish(go?: () => void) {
    localStorage.setItem(TOUR_KEY, '1')
    setOpen(false)
    if (go) go()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) finish() }}>
      <DialogContent className="sm:max-w-md border-brand/30">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 mb-1">
            <Badge className="bg-brand text-black hover:bg-brand font-semibold">{s.kicker}</Badge>
            <span className="text-[11px] text-muted-foreground">{step + 1} / {steps.length}</span>
          </div>
          <DialogTitle className="font-display text-2xl flex items-center gap-3">
            {s.icon}
            {s.title}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed pt-1">
            {s.body}
          </DialogDescription>
        </DialogHeader>

        <Progress value={((step + 1) / steps.length) * 100} className="h-1.5" />

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            onClick={() => finish()}
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={() => setStep((v) => v - 1)}>
                Back
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => (last ? finish() : s.goTo ? finish(s.goTo) : setStep((v) => v + 1))}
              className="bg-brand text-black hover:bg-brand/90 font-semibold"
            >
              {s.cta} {!last && <ArrowRight className="h-3.5 w-3.5" />}
              {last && <Zap className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Replay entry point (Profile & Team → "Replay the tour"). */
export function replayTour() {
  localStorage.removeItem(TOUR_KEY)
  window.dispatchEvent(new CustomEvent('hp:tour-replay'))
}
