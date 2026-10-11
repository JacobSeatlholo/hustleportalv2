'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useHp } from './store'
import { BH_SERVICES, waLink, type BhService } from '@/data/services'
import {
  Target, Laptop, TrendingUp, Camera, Handshake, Brain, ChevronDown, MessageCircle, Sparkles, ExternalLink, Send,
} from 'lucide-react'
import { api as hpApi } from './shared'
import { ServiceRequestDialog, type RequestedService } from './ServiceRequestDialog'

const ICONS: Record<string, React.ReactNode> = {
  target: <Target className="h-5 w-5" />,
  laptop: <Laptop className="h-5 w-5" />,
  'trending-up': <TrendingUp className="h-5 w-5" />,
  camera: <Camera className="h-5 w-5" />,
  handshake: <Handshake className="h-5 w-5" />,
  brain: <Brain className="h-5 w-5" />,
}

export default function ServicesView() {
  const { bumpRefresh } = useHp()
  const [openId, setOpenId] = useState<string | null>(null)
  const [reqOpen, setReqOpen] = useState(false)
  const [reqService, setReqService] = useState<RequestedService | null>(null)
  const [reqPreset, setReqPreset] = useState<string | undefined>(undefined)

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

  function openRequest(service: RequestedService | null, preset?: string) {
    markExplored()
    setReqService(service)
    setReqPreset(preset)
    setReqOpen(true)
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

      {/* Service request dialog — shared with conversion touchpoints app-wide */}
      <ServiceRequestDialog open={reqOpen} onOpenChange={setReqOpen} service={reqService} presetMessage={reqPreset} />
    </div>
  )
}
