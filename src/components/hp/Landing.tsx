'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'
import { useHp } from './store'
import CityField from './CityField'
import ThemeToggle from './ThemeToggle'
import {
  Zap, Wallet, Loader2, ArrowRight, Check, Handshake, Sparkles, Gift, MailCheck,
  MessageSquareText, Timer, BookOpen, BadgeCheck, MessageCircleOff, Calculator, Clock,
  Twitter, Instagram, Star,
} from 'lucide-react'

const INDUSTRIES = [
  'Creative Agency', 'Freelancer', 'Tech / SaaS', 'Retail', 'Consulting', 'Construction',
  'Food & Bev', 'Health', 'Beauty & Wellness', 'Travel & Tours', 'Transport & Logistics',
  'Cleaning Services', 'Security Services', 'Education & Training', 'Other',
]

/** The money flow, drawn as an infographic: three moves, no jargon. */
const FLOW_STEPS = [
  {
    n: '01', icon: MessageSquareText, title: 'Tell us what you sell',
    desc: 'One line about your business. That’s the whole form.',
  },
  {
    n: '02', icon: Sparkles, title: 'We find your customers',
    desc: 'Our AI searches the web and the maps for real businesses near you, and checks every detail before it reaches your list.',
  },
  {
    n: '03', icon: Handshake, title: 'You close and get paid',
    desc: 'Call them, send the quote, log the deal. Your pipeline keeps it all in one place so nothing slips.',
  },
]

/** Truthful numbers only: every tile is a fact about the product. */
const STAT_TILES = [
  { icon: Timer, big: '5 min', small: 'from account to your first lead search' },
  { icon: Wallet, big: 'R99', small: 'in free lead credits when you join' },
  { icon: BookOpen, big: '50+', small: 'free guides and tools in the hub' },
  { icon: BadgeCheck, big: 'R0', small: 'to start, and no card is needed' },
]

/** Real Google reviews, verbatim from the Business Hustle Google listing
 *  (4.8 ★, 12 reviews, 99 Kloof St, Gardens, Cape Town — verified Nov 2026).
 *  Nothing here is invented; quotes render exactly as they appear on Google. */
const GOOGLE_RATING = { stars: '4.8', count: 12 }
const GOOGLE_REVIEWS_URL = 'https://www.google.com/maps/search/Business+Hustle+99+Kloof+St+Gardens+Cape+Town'
const GOOGLE_REVIEWS = [
  {
    name: 'Pako Mahumo', role: 'HustlePortal user',
    quote: 'I love this app, it’s convenient and easy to use.',
  },
  {
    name: 'Ronald Menoe', role: 'Gabonewe',
    quote: 'I did not only get a landing page for my business, I found a like-minded family that supports my vision and dream. Great partnership.',
  },
  {
    name: 'Franck Leya', role: 'Client',
    quote: 'What a pleasant experience! 100% will recommend!!',
  },
]

const PROBLEMS = [
  {
    icon: MessageCircleOff, title: 'Leads slip through the cracks',
    desc: 'In WhatsApp, DMs and missed calls — nobody calls back, the deal goes cold.',
  },
  {
    icon: Calculator, title: 'Profit is a guess, not a number',
    desc: 'Invoices here, expenses there — you never really know which jobs made money.',
  },
  {
    icon: Clock, title: 'Admin eats the evenings',
    desc: 'Quotes, schedules and filing wait until after hours — the hours you should be billing.',
  },
]

export default function Landing() {
  const { loadSession } = useHp()
  const { toast } = useToast()
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('register')
  const [busy, setBusy] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)

  // register fields
  const [name, setName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [industry, setIndustry] = useState('')
  const [customIndustry, setCustomIndustry] = useState('')
  const [city, setCity] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [hpField, setHpField] = useState('') // honeypot: real humans never see or fill this
  const [refApplied, setRefApplied] = useState<string | null>(null)

  // Referral capture: ?ref=CODE, store it, greet the invitee, attach at register.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ref')
    if (code && code.trim()) {
      localStorage.setItem('hp_ref', code.trim().toUpperCase())
      setRefApplied(code.trim().toUpperCase())
    } else if (localStorage.getItem('hp_ref')) {
      setRefApplied(localStorage.getItem('hp_ref'))
    }
  }, [])

  async function submit() {
    setBusy(true)
    try {
      if (mode === 'register') {
        await api('/api/auth', {
          method: 'POST',
          body: JSON.stringify({ action: 'register', name, businessName, industry: industry === 'Other' ? (customIndustry.trim() || 'Other') : industry, city, email, password, companyWebsite: hpField, refCode: localStorage.getItem('hp_ref') }),
        })
        localStorage.removeItem('hp_ref')
      } else {
        await api('/api/auth', {
          method: 'POST',
          body: JSON.stringify({ action: 'login', email, password }),
        })
      }
      await loadSession(true)
    } catch (e) {
      toast({ title: 'Couldn’t sign you in', description: e instanceof Error ? e.message : 'Please check your details and try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function sendResetLink() {
    setBusy(true)
    try {
      const res = await api<{ ok: boolean; message?: string }>('/api/auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'forgot', email }),
      })
      setForgotSent(true)
      toast({ title: 'Check your inbox', description: res.message || 'Reset link sent if the account exists.' })
    } catch (e) {
      toast({ title: 'Couldn’t send the reset link', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen hp-gradient-bg flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full">
        <div className="font-display text-2xl tracking-wide">
          HUSTLE<span className="text-brand">PORTAL</span>
          <span className="text-[10px] align-super">™</span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle compact />
          <a
            href="https://wa.me/27744815163"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground text-right leading-snug"
          >
            <span className="hidden sm:inline">Questions? </span>WhatsApp us
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 pb-16 space-y-20">
      {/* ===== Hero: short pitch + auth ===== */}
      <div className="grid lg:grid-cols-2 gap-10 items-center">
        <div className="space-y-7 hp-rise">
          <div>
            <div className="inline-flex items-center gap-2 hp-eyebrow text-brand">
              <Zap className="h-3 w-3 text-brand" /> Made for South African businesses
            </div>
            <h1 className="font-display text-5xl md:text-6xl leading-[0.95] mt-3">
              Tell us what you do.<br />
              <span className="text-brand">We find your customers.</span>
            </h1>
            <p className="text-muted-foreground mt-4 text-lg max-w-xl">
              Tell us what you sell and we find real businesses near you that need it —
              details checked, loaded into your pipeline, ready to call, quote and get paid.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-brand" /> Proudly South African</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /> R99 in free credits when you join</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /> Secure payments by Yoco</div>
            <a
              href={GOOGLE_REVIEWS_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-brand hover:underline"
              aria-label="Business Hustle on Google: 4.8 stars"
            >
              <Star className="h-4 w-4 fill-brand text-brand" /> {GOOGLE_RATING.stars}★ on Google
            </a>
          </div>

          {refApplied && (
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs text-foreground">
              <Gift className="h-3.5 w-3.5 text-brand" />
              Invite code <b className="text-brand font-mono">{refApplied}</b> applied. Your welcome credit lands after signup.
            </div>
          )}
        </div>

        {/* Auth card */}
        <Card>
          <CardContent className="p-6 md:p-8">
            <div className="flex gap-2 mb-6 p-1 rounded-lg bg-muted w-fit">
              <button
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${mode === 'register' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground'}`}
                onClick={() => setMode('register')}
              >
                Start free
              </button>
              <button
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${mode === 'login' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground'}`}
                onClick={() => setMode('login')}
              >
                Sign in
              </button>
            </div>

            {mode === 'forgot' ? (
              forgotSent ? (
                <div className="space-y-4 text-center py-6">
                  <MailCheck className="h-9 w-9 text-brand mx-auto" />
                  <p className="text-sm text-muted-foreground">
                    If an account exists for <b className="text-foreground">{email}</b>, a reset link is on its way.
                    Check your inbox, and spam, just in case. The link works for 30 minutes.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => { setMode('login'); setForgotSent(false) }}
                  >
                    Back to sign in
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Enter the email on your account and we&apos;ll send you a secure reset link. It works for 30 minutes and can be used once.
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="f-email">Email</Label>
                    <Input
                      id="f-email" type="email" placeholder="you@business.co.za" value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendResetLink()}
                    />
                  </div>
                  <Button
                    onClick={sendResetLink}
                    disabled={busy || !email.includes('@')}
                    className="w-full h-11 text-base font-semibold"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send reset link'}
                    {!busy && <ArrowRight className="h-4 w-4 ml-1" />}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setMode('login')}
                    className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
                  >
                    Back to sign in
                  </button>
                </div>
              )
            ) : (
            <>
            <div className="space-y-4">
              {mode === 'register' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="r-name">Your name</Label>
                      <Input id="r-name" placeholder="Joseph" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="r-biz">Business name</Label>
                      <Input id="r-biz" placeholder="Nkosi Brands" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Industry</Label>
                      <div className="flex flex-wrap gap-1">
                        {INDUSTRIES.map((i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setIndustry(i)}
                            className={`text-xs px-2 py-1 rounded-full border transition ${industry === i ? 'bg-brand border-brand text-black font-medium' : 'bg-transparent text-muted-foreground hover:border-brand/60'}`}
                          >
                            {i}
                          </button>
                        ))}
                      </div>
                      {industry === 'Other' && (
                        <Input
                          placeholder="Tell us your industry, e.g. Car wash"
                          value={customIndustry}
                          onChange={(e) => setCustomIndustry(e.target.value)}
                        />
                      )}
                    </div>
                    <CityField value={city} onChange={setCity} label="City" hint="Pick a shortcut or type any city, township or suburb, or tag your location." />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="a-email">Email</Label>
                <Input id="a-email" type="email" placeholder="you@business.co.za" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-pw">Password</Label>
                <Input
                  id="a-pw" type="password" placeholder="••••••••" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </div>

              {/* Honeypot, visually hidden, keyboard unreachable, bots fill it and get refused */}
              <div className="hidden" aria-hidden="true">
                <label htmlFor="a-site">Company website</label>
                <Input
                  id="a-site" type="text" tabIndex={-1} autoComplete="off"
                  value={hpField} onChange={(e) => setHpField(e.target.value)}
                />
              </div>

              <Button
                onClick={submit}
                disabled={busy || !email || !password || (mode === 'register' && !name)}
                className="w-full h-11 text-base font-semibold"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'register' ? 'Create my free account' : 'Sign in'}
                {!busy && <ArrowRight className="h-4 w-4 ml-1" />}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                {mode === 'register'
                  ? 'Free to start. R99 in lead credits on us. No card needed.'
                  : 'Welcome back.'}
              </p>
              {mode === 'register' && (
                <p className="text-[11px] text-center text-muted-foreground">
                  By creating an account you agree to our{' '}
                  <a href="https://businesshustle.co.za/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Terms</a>
                  {' '}and our{' '}
                  <a href="https://businesshustle.co.za/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Privacy &amp; POPIA notice</a>.
                </p>
              )}
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => setMode('forgot')}
                  className="text-xs text-muted-foreground hover:text-brand w-full text-center transition"
                >
                  Forgot password?
                </button>
              )}
            </div>
            </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== Infographic: the money flow ===== */}
      <section id="how-it-works" className="space-y-8">
        <div className="text-center">
          <div className="hp-eyebrow text-brand">How it works</div>
          <h2 className="font-display text-3xl md:text-4xl mt-2">Three moves. Five minutes.</h2>
        </div>
        <div className="grid md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-4 items-stretch">
          {FLOW_STEPS.map((s, i) => (
            <div key={s.n} className="contents">
              <div className="rounded-xl border bg-card p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="rounded-lg bg-brand/15 p-2.5 w-fit"><s.icon className="h-5 w-5 text-brand" /></div>
                  <span className="font-display text-3xl text-brand/25">{s.n}</span>
                </div>
                <div>
                  <div className="font-semibold text-sm">{s.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.desc}</div>
                </div>
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <div className="hidden md:flex items-center text-brand/50">
                  <ArrowRight className="h-6 w-6" />
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          {STAT_TILES.map((t) => (
            <div key={t.big} className="rounded-lg border bg-muted/40 p-4 text-center">
              <t.icon className="h-4 w-4 text-brand mx-auto" />
              <div className="font-display text-2xl mt-1.5">{t.big}</div>
              <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">{t.small}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== The problem (three one-liners, no essay) ===== */}
      <section id="problem" className="space-y-5">
        <div>
          <div className="hp-eyebrow text-brand">The problem</div>
          <h2 className="font-display text-3xl md:text-4xl mt-2">Being scattered costs real money</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="rounded-lg border border-border bg-card p-5">
              <div className="rounded-lg bg-brand/10 p-2 w-fit"><p.icon className="h-4 w-4 text-brand" /></div>
              <div className="font-semibold text-sm mt-2.5">{p.title}</div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{p.desc}</div>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          HustlePortal pulls all of it into <span className="text-brand font-medium">one home</span>.
        </p>
      </section>

      {/* ===== Google reviews: real words from the Business Hustle listing ===== */}
      <section id="reviews" className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="hp-eyebrow text-brand">Google reviews</div>
            <h2 className="font-display text-3xl md:text-4xl mt-2">Rated {GOOGLE_RATING.stars} out of 5</h2>
            <p className="text-sm text-muted-foreground mt-1">Real words from the Business Hustle Google listing · {GOOGLE_RATING.count} reviews.</p>
          </div>
          <a
            href={GOOGLE_REVIEWS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border px-4 h-10 text-sm font-medium hover:border-brand transition shrink-0"
          >
            <Star className="h-4 w-4 fill-brand text-brand" />
            {GOOGLE_RATING.stars} · Read on Google
          </a>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {GOOGLE_REVIEWS.map((r) => (
            <figure key={r.name} className="rounded-xl border bg-card p-5 flex flex-col gap-3">
              <div className="flex gap-0.5" aria-label="Rated on Google">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-brand text-brand" />
                ))}
              </div>
              <blockquote className="text-sm leading-relaxed">“{r.quote}”</blockquote>
              <figcaption className="mt-auto">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-[11px] text-muted-foreground">{r.role} · Google review</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ===== Done-for-you work: one line — the catalogue lives inside the app ===== */}
      <section id="services" className="rounded-2xl border bg-card p-6 md:p-7 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="font-display text-xl">Need it built for you?</div>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Websites, brands, business plans and done-for-you projects by Business Hustle —
            the full Store and Services live inside the platform.
          </p>
        </div>
        <a
          href="https://wa.me/27744815163"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border px-5 h-10 inline-flex items-center text-sm font-medium hover:border-brand transition shrink-0"
        >
          Ask on WhatsApp <ArrowRight className="h-4 w-4 ml-1.5" />
        </a>
      </section>
      {/* ===== Pipeline promise ===== */}
      <section id="trust" className="rounded-2xl border border-brand/25 bg-brand/5 p-6 md:p-8 space-y-3">
        <div className="hp-eyebrow text-brand">Your pipeline, handled</div>
        <h2 className="font-display text-3xl md:text-4xl mt-2">We feed your pipeline. You run your business.</h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Clients, invoices, calendar and mail in one place, an AI helper that knows your numbers —
          and verified leads landing in your pipeline while you work.
        </p>
        <div className="flex flex-wrap gap-6 pt-1 text-sm">
          <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /> Contact details checked before you pay a cent</div>
          <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /> Your data stays yours. Download it anytime.</div>
          <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /> Real people, one tap away, inside the app</div>
        </div>
      </section>

      {/* ===== Pricing: one calm line — the numbers live inside the platform ===== */}
      <section id="pricing" className="rounded-2xl border bg-card p-6 md:p-7 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="font-display text-xl">Simple plans, no lock-in</div>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Start free — no card needed. Plans and credits live inside the platform, under{' '}
            <span className="text-brand font-medium">Store and Services</span>. Take a look once you&apos;re in.
          </p>
        </div>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); document.getElementById('a-email')?.focus({ preventScroll: false }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
          className="rounded-lg bg-brand px-5 h-10 inline-flex items-center text-sm font-semibold text-black hover:bg-brand/90 transition shrink-0"
        >
          Start free <ArrowRight className="h-4 w-4 ml-1.5" />
        </a>
      </section>

      {/* ===== Demo: a working preview, built by Business Hustle ===== */}
      <section id="demo" className="space-y-6">
        <div className="text-center space-y-2">
          <div className="hp-eyebrow text-brand">Look inside</div>
          <h2 className="font-display text-3xl md:text-4xl mt-2">See it work before you spend a cent</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            A working demo of your workspace, built by Business Hustle — leads come in,
            quotes go out, the money gets tracked. On your phone or your laptop.
          </p>
        </div>

        <div className="max-w-3xl mx-auto rounded-2xl border bg-card shadow-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b bg-muted/40">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            <span className="ml-2 text-[10px] font-mono text-muted-foreground">www.hustleportal.online</span>
          </div>
          <div className="p-4 md:p-5 grid md:grid-cols-5 gap-3 text-left">
            <div className="md:col-span-3 rounded-xl border p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Leads today</div>
                <div className="text-[10px] rounded-full bg-brand/15 text-brand px-2 py-0.5 font-semibold">Credits R140</div>
              </div>
              {[
                { name: 'Lerato’s Kitchen', city: 'Soweto' },
                { name: 'Mzansi Moves', city: 'Durban' },
                { name: 'TrueStyle Barbering', city: 'Pretoria' },
              ].map((lead) => (
                <div key={lead.name} className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium leading-tight">{lead.name}</div>
                    <div className="text-[10px] text-muted-foreground">{lead.city}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] hidden sm:inline-flex items-center gap-1 text-emerald-500 font-medium"><BadgeCheck className="h-3 w-3" /> Verified</span>
                    <span className="text-[10px] rounded-md bg-brand text-black font-semibold px-2 py-1">Reveal R15</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="md:col-span-2 space-y-3">
              <div className="rounded-xl border p-4 space-y-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</div>
                {[
                  { stage: 'New leads', value: '8', w: 'w-2/3' },
                  { stage: 'Quoted', value: 'R8,400', w: 'w-1/2' },
                  { stage: 'Won this month', value: 'R21,500', w: 'w-1/3' },
                ].map((row) => (
                  <div key={row.stage}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{row.stage}</span>
                      <span className="font-semibold">{row.value}</span>
                    </div>
                    <div className="h-1 rounded-full bg-muted mt-1"><div className={`h-1 rounded-full bg-brand ${row.w}`} /></div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold leading-tight">Invoice #1042</div>
                  <div className="text-[10px] text-muted-foreground">Nkosi Brands</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg text-brand">R4,500</div>
                  <div className="text-[10px] text-emerald-500 font-medium inline-flex items-center gap-1"><Check className="h-3 w-3" /> Paid</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto rounded-xl border border-brand/25 bg-brand/5 p-5 md:p-6 text-sm space-y-2">
          <p>
            Credits work like airtime — load once, spend where it counts. If a lookup comes
            back empty, you pay nothing at all.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3 pt-1">
          <a href="#" onClick={(e) => { e.preventDefault(); document.getElementById('a-email')?.focus({ preventScroll: false }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="rounded-lg bg-brand px-6 h-11 inline-flex items-center font-semibold text-black hover:bg-brand/90 transition">
            Open your free account <ArrowRight className="h-4 w-4 ml-1.5" />
          </a>
          <a href={`https://wa.me/27744815163?text=${encodeURIComponent('Hi HustlePortal team, I would like to book a free demo please.')}`} target="_blank" rel="noreferrer" className="rounded-lg border px-6 h-11 inline-flex items-center font-medium hover:border-brand transition">
            Book a free demo on WhatsApp
          </a>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Demo built by <a href="https://businesshustle.co.za" target="_blank" rel="noreferrer" className="text-brand hover:underline">Business Hustle</a>. The real thing takes five minutes to set up.
        </p>
      </section>

      <section className="text-center space-y-4 py-6">
        <h2 className="font-display text-4xl md:text-5xl">Start free. Get organised. Get paid.</h2>
        <p className="text-brand font-display text-xl">Free to start. Ready when you are.</p>
        <div className="flex flex-wrap justify-center gap-3 pt-1">
          <a href="#" onClick={(e) => { e.preventDefault(); document.getElementById('a-email')?.focus({ preventScroll: false }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="rounded-lg bg-brand px-6 h-11 inline-flex items-center font-semibold text-black hover:bg-brand/90 transition">
            Start free <ArrowRight className="h-4 w-4 ml-1.5" />
          </a>
          <a href="https://wa.me/27744815163" target="_blank" rel="noreferrer" className="rounded-lg border px-6 h-11 inline-flex items-center font-medium hover:border-brand transition">
            Talk to us on WhatsApp
          </a>
        </div>
      </section>
      </main>

      <footer className="border-t bg-background">
        <div className="max-w-6xl mx-auto px-6 py-5 space-y-3">
          <div className="text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
            <span>
              © {new Date().getFullYear()} HustlePortal™, a <a href="https://businesshustle.co.za" target="_blank" rel="noreferrer" className="text-brand hover:underline">Business Hustle</a> product by Simple Eternity Holdings (Pty) Ltd
            </span>
            <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-brand" /> <span className="text-brand tracking-wide">We feed your pipeline. You run your business.</span></span>
          </div>
          <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <a href="https://businesshustle.co.za/terms" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">Terms of Service</a>
            <a href="https://businesshustle.co.za/privacy" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">Privacy &amp; POPIA</a>
            <a href="https://businesshustle.co.za/cookies" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">Cookie Policy</a>
            <a href="https://app.businesshustle.co.za/wp-content/uploads/2025/12/BHW-PAIA-Manual-Integrated-with-POPIA.pdf" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">PAIA Manual</a>
            <a href="/remove-listing" className="hover:text-foreground hover:underline">Remove my business</a>
            <a href="https://businesshustle.co.za" target="_blank" rel="noreferrer" className="text-brand hover:underline">www.businesshustle.co.za</a>
            <a href="https://x.com/hustlebusiness" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline" aria-label="Business Hustle on Twitter/X">
              <Twitter className="h-3 w-3" /> @hustlebusiness
            </a>
            <a href="https://www.instagram.com/businesshustleworldwide" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline" aria-label="Business Hustle on Instagram">
              <Instagram className="h-3 w-3" /> @businesshustleworldwide
            </a>
          </div>
          <p className="text-[11px] text-muted-foreground/80">
            We measure anonymous usage of the app to make it better. Analytics data is processed under our Privacy &amp; POPIA notice and never sold.
          </p>
        </div>
      </footer>
    </div>
  )
}
