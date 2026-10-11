'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useHp } from './store'
import { BH_SERVICES, waLink, type BhService } from '@/data/services'
import {
  Target, Laptop, TrendingUp, Camera, Handshake, Brain, ChevronDown, MessageCircle, Sparkles, ExternalLink, Loader2, Send,
} from 'lucide-react'
import { api as hpApi } from './shared'

const ICONS: Record<string, React.ReactNode> = {
  target: <Target className="h-5 w-5" />,
  laptop: <Laptop className="h-5 w-5" />,
  'trending-up': <TrendingUp className="h-5 w-5" />,
  camera: <Camera className="h-5 w-5" />,
  handshake: <Handshake className="h-5 w-5" />,
  brain: <Brain className="h-5 w-5" />,
}

const URGENCY_OPTIONS: { key: 'ASAP' | 'THIS_WEEK' | 'PLANNING'; label: string; hint: string }[] = [
  { key: 'ASAP', label: 'ASAP — urgent', hint: 'The team prioritises it immediately' },
  { key: 'THIS_WEEK', label: 'This week', hint: 'Most popular' },
  { key: 'PLANNING', label: 'Just planning', hint: 'Get a quote, no rush' },
]

interface RequestState {
  open: boolean
  service: { id: string; title: string } | null
  urgency: 'ASAP' | 'THIS_WEEK' | 'PLANNING'
  message: string
  submitting: boolean
}

export default function ServicesView() {
  const { bumpRefresh, session } = useHp()
  const { toast } = useToast()
  const [openId, setOpenId] = useState<string | null>(null)
  const [req, setReq] = useState<RequestState>({
    open: false, service: null, urgency: 'THIS_WEEK', message: '', submitting: false,
  })

  function markExplored() {
    // "Explore Our Services" daily challenge
    hpApi('/api/gamification/challenges', {
      method: 'POST',
      body: JSON.stringify({ key: 'explore_services' }),
    })
      .then(() => bumpRefresh())
      .catch(() => {})
  }

  function toggle(svc: BhService) {
    setOpenId((cur) => {
      const next = cur === svc.id ? null : svc.id
      if (next) markExplored()
      return next
    })
  }

  function openRequest(service: { id: string; title: string } | null, preset?: string) {
    markExplored()
    setReq({ open: true, service, urgency: 'THIS_WEEK', message: preset ?? '', submitting: false })
  }

  async function submitRequest() {
    if (!req.service) return
    setReq((r) => ({ ...r, submitting: true }))
    try {
      const res = await hpApi<{ ok: true; ref: string; emailSent: boolean }>('/api/service-requests', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: req.service.id,
          serviceTitle: req.service.title,
          urgency: req.urgency,
          message: req.message,
        }),
      })
      setReq((r) => ({ ...r, open: false, submitting: false }))
      toast({
        title: `Request ${res.ref} sent ✓`,
        description:
          'Tracked on your Tasks with its urgency level — the Business Hustle team replies to ' +
          (session?.user.email || 'your email') + '.',
      })
      bumpRefresh()
    } catch (e) {
      setReq((r) => ({ ...r, submitting: false }))
      toast({ title: 'Could not send your request', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] tracking-[0.18em] text-brand font-semibold">SERVICES</p>
        <h1 className="font-display text-3xl">Professional services for your business</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Request a service in under a minute — it lands with the team as an email and stays tracked on your dashboard.
        </p>
      </div>

      {/* Free assessment banner */}
      <div className="rounded-2xl bg-sidebar text-sidebar-foreground p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-brand/15 p-3"><Sparkles className="h-6 w-6 text-brand" /></div>
          <div>
            <div className="font-medium">Not sure what you need?</div>
            <div className="text-sm text-sidebar-foreground/60 max-w-md">
              Our team assesses your business and recommends the right solution — free, no strings.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openRequest({ id: 'free-assessment', title: 'Free Business Assessment' }, "I'd like the free business assessment, please. Here's where my business is right now: ")}>
            <Send className="h-4 w-4 mr-1.5" /> Request free assessment
          </Button>
          <Button asChild variant="outline" className="border-sidebar-foreground/30 text-sidebar-foreground hover:bg-white/5">
            <a href={waLink("Hi HustlePortal team! I'd like a free business assessment, please.")} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
            </a>
          </Button>
        </div>
      </div>

      {/* Services accordion */}
      <div className="space-y-2">
        {BH_SERVICES.map((svc) => {
          const open = openId === svc.id
          return (
            <Card
              key={svc.id}
              className={`cursor-pointer transition-colors ${open ? 'shadow-md' : 'hover:border-brand/40'}`}
              style={{ borderColor: open ? `${svc.color}80` : `${svc.color}22` }}
              onClick={() => toggle(svc)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="rounded-xl p-2.5 shrink-0"
                    style={{ background: `${svc.color}1f`, color: svc.color }}
                  >
                    {ICONS[svc.icon]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{svc.title}</div>
                    <div className="text-xs text-muted-foreground">{svc.desc}</div>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
                </div>
                {open && (
                  <div className="mt-3 pt-3 border-t space-y-3" style={{ borderColor: `${svc.color}22` }}>
                    <p className="text-sm text-muted-foreground leading-relaxed">{svc.detail}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); openRequest(svc) }}
                      >
                        <Send className="h-3.5 w-3.5 mr-1.5" /> Request this service
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); markExplored() }}
                        asChild
                      >
                        <a href={waLink(svc.waMsg)} target="_blank" rel="noreferrer">
                          <MessageCircle className="h-3.5 w-3.5 mr-1.5" /> Ask on WhatsApp
                          <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
                        </a>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Every request is confirmed on your Tasks with an urgency level, and emailed straight to the Business Hustle team —
        you always have a paper trail. Services are quoted per project before any work starts.
      </p>

      {/* Service request dialog */}
      <Dialog open={req.open} onOpenChange={(v) => setReq((r) => ({ ...r, open: v }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {req.service ? `Request: ${req.service.title}` : 'Request a service'}
            </DialogTitle>
            <DialogDescription>
              Tell us how urgent this is — the request is emailed to the team and added to your Tasks so nothing gets lost.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>How urgent is it?</Label>
              <div className="grid gap-1.5">
                {URGENCY_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setReq((r) => ({ ...r, urgency: o.key }))}
                    className={`text-left rounded-lg border px-3 py-2 transition ${req.urgency === o.key ? 'border-brand bg-brand/10' : 'hover:border-brand/40'}`}
                  >
                    <div className="text-sm font-medium">{o.label}</div>
                    <div className="text-[11px] text-muted-foreground">{o.hint}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sr-msg">What do you need? (optional)</Label>
              <Textarea
                id="sr-msg"
                rows={4}
                placeholder="One or two lines about your business and the outcome you want. Prices, timelines and next steps come from the team."
                value={req.message}
                onChange={(e) => setReq((r) => ({ ...r, message: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReq((r) => ({ ...r, open: false }))}>Cancel</Button>
              <Button onClick={submitRequest} disabled={req.submitting}>
                {req.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
