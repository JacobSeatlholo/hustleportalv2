'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'
import { useHp } from './store'
import {
  Target, Zap, Users, Wallet, BrainCircuit, Trophy, Loader2, ArrowRight, MapPin, Star, Check,
} from 'lucide-react'

const INDUSTRIES = ['Creative Agency', 'Freelancer', 'Tech / SaaS', 'Retail', 'Consulting', 'Construction', 'Food & Bev', 'Health', 'Other']
const CITIES = ['Cape Town', 'Johannesburg', 'Durban', 'Pretoria', 'Port Elizabeth', 'Other']

export default function Landing() {
  const { loadSession } = useHp()
  const { toast } = useToast()
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [busy, setBusy] = useState(false)

  // register fields
  const [name, setName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [industry, setIndustry] = useState('')
  const [city, setCity] = useState('Cape Town')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function submit() {
    setBusy(true)
    try {
      if (mode === 'register') {
        await api('/api/auth', {
          method: 'POST',
          body: JSON.stringify({ action: 'register', name, businessName, industry, city, email, password }),
        })
      } else {
        await api('/api/auth', {
          method: 'POST',
          body: JSON.stringify({ action: 'login', email, password }),
        })
      }
      await loadSession(true)
    } catch (e) {
      toast({ title: 'Hold up', description: e instanceof Error ? e.message : 'Something went wrong', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen hp-gradient-bg flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full">
        <div className="font-display text-2xl tracking-wide">
          HUSTLE<span className="text-amber-500">PORTAL</span>
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

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 pb-16 grid lg:grid-cols-2 gap-10 items-center">
        {/* Left: pitch */}
        <div className="space-y-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-900 px-3 py-1 text-xs font-medium">
              <MapPin className="h-3 w-3" /> Built in Cape Town · for South African hustlers
            </div>
            <h1 className="font-display text-5xl md:text-6xl leading-[0.95] mt-4">
              Your business.<br />
              <span className="text-amber-500">Levelled up.</span>
            </h1>
            <p className="text-muted-foreground mt-4 text-lg">
              Leads, clients, tasks and finance in one place. Source leads with AI,
              reveal contacts with prepaid credits — no monthly lock-in for what you use.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { icon: Target, title: 'AI Lead Finder', desc: 'Describe your ideal client, get matched businesses' },
              { icon: Wallet, title: 'Prepaid credits', desc: 'Top up, reveal real contacts. No subscription traps' },
              { icon: Users, title: 'Team hustle', desc: 'Share tasks & pipelines with your team' },
              { icon: BrainCircuit, title: 'AI Co-Founder', desc: 'Plans, pricing & advice grounded in your data' },
              { icon: Trophy, title: 'Daily challenges', desc: 'Earn XP, level up your hustle' },
              { icon: Zap, title: 'Your data only', desc: 'Your account, your pipeline, your numbers' },
            ].map((f) => (
              <div key={f.title} className="flex gap-3 items-start rounded-xl border bg-white/70 backdrop-blur p-3">
                <div className="rounded-lg bg-amber-100 p-2 shrink-0">
                  <f.icon className="h-4 w-4 text-amber-700" />
                </div>
                <div>
                  <div className="font-medium text-sm">{f.title}</div>
                  <div className="text-xs text-muted-foreground">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2"><Star className="h-4 w-4 text-amber-500" /> Cape Town born &amp; bred</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> Free starter credits</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> Yoco secure payments</div>
          </div>
        </div>

        {/* Right: auth card */}
        <Card className="border-0 shadow-xl shadow-amber-100">
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
                            className={`text-xs px-2 py-1 rounded-full border transition ${industry === i ? 'bg-amber-400/90 border-amber-500 text-black font-medium' : 'bg-white text-muted-foreground hover:border-amber-300'}`}
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
                            className={`text-xs px-2 py-1 rounded-full border transition ${city === c ? 'bg-amber-400/90 border-amber-500 text-black font-medium' : 'bg-white text-muted-foreground hover:border-amber-300'}`}
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
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'register' ? 'Claim my free credits' : 'Sign in'}
                {!busy && <ArrowRight className="h-4 w-4 ml-1" />}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                {mode === 'register'
                  ? 'Free account · starter credits to reveal your first leads · cancel nothing'
                  : 'Welcome back, hustler.'}
              </p>
            </div>
          </CardContent>
        </Card>
      </main>

      <footer className="border-t bg-white/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>BUSINESS HUSTLE · SIMPLE ETERNITY HOLDINGS (PTY) LTD · CAPE TOWN</span>
          <span>© {new Date().getFullYear()} HustlePortal™</span>
        </div>
      </footer>
    </div>
  )
}
