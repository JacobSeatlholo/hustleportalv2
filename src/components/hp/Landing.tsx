'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'
import { useHp } from './store'
import {
  Target, Zap, Users, Wallet, BrainCircuit, Trophy, Loader2, ArrowRight, Star, Check,
  Laptop, TrendingUp, Camera, Handshake, Brain, Sparkles, Gift, Crown, Rocket, MailCheck,
} from 'lucide-react'
import { BH_SERVICES } from '@/data/services'

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  target: <Target className="h-5 w-5" />,
  laptop: <Laptop className="h-5 w-5" />,
  'trending-up': <TrendingUp className="h-5 w-5" />,
  camera: <Camera className="h-5 w-5" />,
  handshake: <Handshake className="h-5 w-5" />,
  brain: <Brain className="h-5 w-5" />,
}

const INDUSTRIES = ['Creative Agency', 'Freelancer', 'Tech / SaaS', 'Retail', 'Consulting', 'Construction', 'Food & Bev', 'Health', 'Other']
const CITIES = ['Johannesburg', 'Durban', 'Pretoria', 'Cape Town', 'Port Elizabeth', 'Other']

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
  const [city, setCity] = useState('Johannesburg')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [refApplied, setRefApplied] = useState<string | null>(null)

  // Referral capture: ?ref=CODE — store it, greet the invitee, attach at register.
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
          body: JSON.stringify({ action: 'register', name, businessName, industry, city, email, password, refCode: localStorage.getItem('hp_ref') }),
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
        <a
          href="https://wa.me/27744815163"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Questions? WhatsApp us
        </a>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 pb-16 space-y-16">
      {/* ===== Hero: pitch + auth ===== */}
      <div className="grid lg:grid-cols-2 gap-10 items-center">
        {/* Left: pitch */}
        <div className="space-y-8">
          <div>
            <div className="text-xs font-semibold tracking-[0.3em] uppercase text-brand">Explore. Adapt. Evolve.</div>
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase text-muted-foreground mt-2">
              <Zap className="h-3 w-3 text-brand" /> The Business OS for South African businesses
            </div>
            <h1 className="font-display text-5xl md:text-6xl leading-[0.95] mt-3">
              Run your business<br />
              <span className="text-brand">like a business.</span>
            </h1>
            <p className="text-muted-foreground mt-4 text-lg">
              Leads, clients, invoicing, tasks and finance in one professional system —
              with an AI co-founder that knows your numbers. Free to start, working in minutes.
            </p>
            {refApplied && (
              <div className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs text-foreground mt-2">
                <Gift className="h-3.5 w-3.5 text-brand" />
                Invite code <b className="text-brand font-mono">{refApplied}</b> applied — your welcome credit will be added after signup.
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { icon: Target, title: 'AI Lead Finder', desc: 'Describe your ideal client — get matched, verified businesses' },
              { icon: Wallet, title: 'Pay-per-reveal credits', desc: 'Reveal real contacts only when you need them. No monthly lock-in.' },
              { icon: Users, title: 'Team workspace', desc: 'Share pipelines, tasks and clients with your team' },
              { icon: BrainCircuit, title: 'AI Co-Founder', desc: 'Plans, pricing and follow-ups grounded in your live data' },
              { icon: Trophy, title: 'Daily challenges', desc: 'Guided daily actions that keep your pipeline moving' },
              { icon: Zap, title: 'You own your data', desc: 'Your account, your pipeline, your numbers — exportable anytime' },
            ].map((f) => (
              <div key={f.title} className="flex gap-3 items-start rounded-xl border border-white/10 bg-card/70 backdrop-blur p-3">
                <div className="rounded-lg bg-brand/15 p-2 shrink-0">
                  <f.icon className="h-4 w-4 text-brand" />
                </div>
                <div>
                  <div className="font-medium text-sm">{f.title}</div>
                  <div className="text-xs text-muted-foreground">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2"><Star className="h-4 w-4 text-brand" /> Proudly South African</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> Starter credits included</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> Secure payments by Yoco</div>
          </div>
        </div>

        {/* Right: auth card */}
        <Card className="border-white/10 shadow-2xl shadow-black/60">
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
                    Check your inbox — and spam, just in case. The link works for 30 minutes.
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
                    ← Back to sign in
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
                      <Input id="r-name" placeholder="Jacob" value={name} onChange={(e) => setName(e.target.value)} />
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
                        {INDUSTRIES.slice(0, 5).map((i) => (
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
                    </div>
                    <div className="space-y-1.5">
                      <Label>City</Label>
                      <div className="flex flex-wrap gap-1">
                        {CITIES.slice(0, 4).map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setCity(c)}
                            className={`text-xs px-2 py-1 rounded-full border transition ${city === c ? 'bg-brand border-brand text-black font-medium' : 'bg-transparent text-muted-foreground hover:border-brand/60'}`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
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
                  ? 'Free account · starter credits included · no card required'
                  : 'Welcome back.'}
              </p>
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

      {/* ===== The problem ===== */}
      <section id="problem" className="space-y-5">
        <div>
          <div className="text-xs font-semibold tracking-[0.22em] uppercase text-brand">The problem</div>
          <h2 className="font-display text-3xl mt-1">Disorganisation is expensive</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Leads buried in WhatsApp. Invoices in Word. Expenses in your head and a shoebox of slips.
            By the time you catch up, the month is gone — and so is the money.
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { icon: '💬', title: 'Leads slip through the cracks', desc: 'Hot prospects scattered across WhatsApp, DMs and missed calls — no pipeline, no follow-up, no closure.' },
            { icon: '💸', title: 'Profit is a guess, not a number', desc: 'No invoice trail and no expense record means you never know which clients actually pay — or where the month went.' },
            { icon: '🧍', title: 'Admin eats the evenings', desc: 'Quotes, scheduling, follow-ups and filing — all on you, all after hours. The busywork crowds out the billable work.' },
          ].map((p) => (
            <div key={p.title} className="rounded-xl border border-white/10 bg-card/70 backdrop-blur p-5">
              <div className="text-2xl">{p.icon}</div>
              <div className="font-semibold text-sm mt-2">{p.title}</div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{p.desc}</div>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          HustlePortal gives it all <span className="text-brand font-medium">one home</span> — pipeline, payments, tasks,
          appointments and AI in a single Business OS, built for South African businesses.
        </p>
      </section>

      {/* ===== How it works — effortless by design ===== */}
      <section id="how-it-works" className="space-y-5">
        <div>
          <div className="text-xs font-semibold tracking-[0.22em] uppercase text-brand">How it works</div>
          <h2 className="font-display text-3xl mt-1">Three steps. Five minutes.</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            No training, no setup call, nothing to install. If you can use WhatsApp, you already know how to use HustlePortal.
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { n: '01', title: 'Create your free account', desc: 'Your name, business and email. Two minutes, no card required.' },
            { n: '02', title: 'Load your leads & clients', desc: 'Paste a WhatsApp list, scan a contacts screenshot, or reveal verified contacts with credits.' },
            { n: '03', title: 'Follow up & get paid', desc: 'AI drafts the message, the calendar holds the appointments, invoices track the money.' },
          ].map((s) => (
            <div key={s.n} className="rounded-xl border border-white/10 bg-card/70 backdrop-blur p-5">
              <div className="font-display text-brand text-2xl">{s.n}</div>
              <div className="font-semibold text-sm mt-2">{s.title}</div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Our Solutions (Store highlights, like hustleportal.online) ===== */}
      <section id="solutions" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-semibold tracking-[0.22em] uppercase text-brand">Our Solutions</div>
            <h2 className="font-display text-3xl mt-1">Everything your business needs</h2>
            <p className="text-sm text-muted-foreground mt-1">Professional products and services for South African businesses — pay securely with Yoco, or order on WhatsApp.</p>
          </div>
          <a
            href="https://app.businesshustle.co.za/shop"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-brand hover:underline inline-flex items-center gap-1"
          >
            Browse the full store <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              emoji: '🌐', title: 'HustlePortal™', price: 'R1,950/yr',
              desc: 'We build your landing page for your business — live in days, not months.',
              url: 'https://app.businesshustle.co.za/product/hustle-portal/'
            },
            {
              emoji: '📖', title: 'Hustle Basics eBook', price: 'R270',
              desc: 'The essential business toolkit — 20% off this month.',
              url: 'https://app.businesshustle.co.za/product/hustle-basics-ebook/'
            },
            {
              emoji: '💻', title: 'Landing Page', price: 'R1,950',
              desc: 'Modern, fast web presence, mobile-friendly and SEO-ready.',
              url: 'https://app.businesshustle.co.za/product/landing-page/'
            },
            {
              emoji: '🏘️', title: 'Biz Local', price: 'From R950',
              desc: 'Get your business featured in your local neighbourhood directory on KasiStreet.online.',
              url: 'https://app.businesshustle.co.za/product/kloof-street-starter-feature-package/'
            },
          ].map((s) => (
            <a
              key={s.title}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/10 bg-card/70 backdrop-blur p-4 hover:border-brand/60 transition group"
            >
              <div className="text-2xl">{s.emoji}</div>
              <div className="font-semibold text-sm mt-2 group-hover:text-brand transition">{s.title}</div>
              <div className="font-display text-brand text-lg mt-0.5">{s.price}</div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{s.desc}</div>
            </a>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Inside the app you&apos;ll find the full Store — 15 packages from R249 to R21,000 — plus a Resource Hub of 50+ free tools &amp; guides.
        </p>
      </section>

      {/* ===== Services by Business Hustle (like hustleportal.online Services page) ===== */}
      <section id="services" className="space-y-5">
        <div>
          <div className="text-xs font-semibold tracking-[0.22em] uppercase text-brand">Services</div>
          <h2 className="font-display text-3xl mt-1">Expert services, done for you</h2>
          <p className="text-sm text-muted-foreground mt-1">Professional services for South African businesses — quoted per project, delivered by the team behind HustlePortal.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {BH_SERVICES.map((svc) => (
            <a
              key={svc.id}
              href={`https://wa.me/27744815163?text=${encodeURIComponent(svc.waMsg)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/10 bg-card/70 backdrop-blur p-4 hover:border-brand/60 transition group"
            >
              <div className="rounded-lg p-2 inline-flex" style={{ background: `${svc.color}1f`, color: svc.color }}>
                {SERVICE_ICONS[svc.icon]}
              </div>
              <div className="font-semibold text-sm mt-2.5 group-hover:text-brand transition">{svc.title}</div>
              <div className="text-xs text-brand/80">{svc.desc}</div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{svc.detail}</div>
              <div className="text-xs font-medium mt-2.5 inline-flex items-center gap-1 text-brand">Enquire on WhatsApp →</div>
            </a>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Not sure what you need? WhatsApp us for a free business assessment — we&apos;ll recommend the right solution.
        </p>
      </section>
      {/* ===== Pipeline promise ===== */}
      <section id="trust" className="rounded-2xl border border-brand/25 bg-brand/5 p-6 md:p-8 space-y-3">
        <div className="text-xs font-semibold tracking-[0.22em] uppercase text-brand">Your pipeline, handled</div>
        <h2 className="font-display text-3xl">We feed your pipeline. You run your business.</h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Verified leads land in your CRM ready to work — sourced, checked and delivered by the team behind
          HustlePortal. <span className="text-foreground font-medium">You see the results, not the plumbing.</span>
        </p>
        <p className="text-sm text-muted-foreground max-w-3xl">
          HustlePortal is <span className="text-brand font-medium">not another leads database</span>. It is your Business OS:
          CRM, invoicing, calendar, mail, reports and an AI co-founder that knows your numbers — with a pipeline that stays
          full behind the scenes.
        </p>
        <div className="flex flex-wrap gap-6 pt-1 text-sm">
          <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> Verified contacts, delivered to your CRM</div>
          <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> Your data, your control — export anytime</div>
          <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> The team behind it is one tap away, in-app</div>
        </div>
      </section>

      {/* ===== Final CTA ===== */}
      <section id="pricing" className="space-y-5">
        <div className="text-center space-y-2">
          <div className="text-xs font-semibold tracking-[0.3em] uppercase text-brand">Go further, faster</div>
          <h2 className="font-display text-3xl md:text-4xl">Plans that pay for themselves</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Start free. Upgrade when the pipeline demands it. One closed deal covers the month.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto">
          {[
            {
              name: 'Operator', price: 'R199', icon: <Rocket className="h-5 w-5 text-brand" />,
              tagline: 'For owner-operators building steady momentum.',
              perks: ['Unlimited AI Co-Founder & email drafts', '30 verified lead reveals every month', 'Invoices, calendar, reports, exports', 'R50 credit for every business owner you refer'],
            },
            {
              name: 'Boss', price: 'R499', icon: <Crown className="h-5 w-5 text-brand" />, highlight: true,
              tagline: 'For teams ready to outscale the competition.',
              perks: ['Everything in Operator', '100 verified lead reveals every month', 'Up to 5 team seats, shared pipeline', 'Priority AI — faster, longer answers'],
            },
          ].map((p) => (
            <div key={p.name} className={`rounded-2xl border p-6 space-y-4 ${p.highlight ? 'border-brand/50 bg-brand/5' : 'bg-card'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">{p.icon}<h3 className="font-display text-xl">{p.name}</h3></div>
                <div className="text-right">
                  <div className="font-display text-3xl">{p.price}</div>
                  <div className="text-[10px] text-muted-foreground">per month</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{p.tagline}</p>
              <ul className="space-y-2">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-sm"><Check className="h-4 w-4 text-brand shrink-0 mt-0.5" />{perk}</li>
                ))}
              </ul>
              <Button className="w-full bg-brand text-black hover:brightness-110 font-semibold" onClick={() => { document.getElementById('a-email')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); document.getElementById('a-email')?.focus() }}>
                Start with {p.name}<ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Secure card payments by Yoco · cancel anytime · your data is always exportable — the platform earns your loyalty, it doesn&apos;t lock it.
        </p>
      </section>

      <section className="text-center space-y-4 py-6">
        <h2 className="font-display text-4xl md:text-5xl">Start free. Get organised. Get paid.</h2>
        <p className="text-brand font-display text-xl tracking-wide">Free to start. Ready when you are.</p>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          A free account with starter credits to reveal your first leads, and every tool above included. Upgrade only when the pipeline demands it.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-1">
          <a href="#" onClick={(e) => { e.preventDefault(); document.getElementById('a-email')?.focus({ preventScroll: false }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="rounded-lg bg-brand px-6 h-11 inline-flex items-center font-semibold text-black hover:brightness-110 transition">
            Start free <ArrowRight className="h-4 w-4 ml-1.5" />
          </a>
          <a href="https://wa.me/27744815163" target="_blank" rel="noreferrer" className="rounded-lg border px-6 h-11 inline-flex items-center font-medium hover:border-brand transition">
            Talk to us on WhatsApp
          </a>
        </div>
      </section>
      </main>

      <footer className="border-t bg-background/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>BUSINESS HUSTLE · SIMPLE ETERNITY HOLDINGS (PTY) LTD</span>
          <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-brand" /> <span className="text-brand tracking-wide">We feed your pipeline. You run your business.</span></span>
          <span>© {new Date().getFullYear()} HustlePortal™</span>
        </div>
      </footer>
    </div>
  )
}
