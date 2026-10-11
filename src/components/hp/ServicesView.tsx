'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useHp } from './store'
import { BH_SERVICES, waLink, type BhService } from '@/data/services'
import {
  Target, Laptop, TrendingUp, Camera, Handshake, Brain, ChevronDown, MessageCircle, Sparkles, ExternalLink,
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

export default function ServicesView() {
  const { bumpRefresh } = useHp()
  const { toast } = useToast()
  const [openId, setOpenId] = useState<string | null>(null)

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

  function inquire(svc: BhService) {
    toast({ title: 'Opening WhatsApp…', description: `Your inquiry about ${svc.title} is pre-filled — just hit send.` })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] tracking-[0.18em] text-brand font-semibold">SERVICES</p>
        <h1 className="font-display text-3xl">Professional services for your business</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Expert services for SA businesses — delivered by the team behind HustlePortal.
        </p>
      </div>

      {/* Free assessment banner */}
      <div className="rounded-2xl bg-sidebar text-sidebar-foreground p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-brand/15 p-3"><Sparkles className="h-6 w-6 text-brand" /></div>
          <div>
            <div className="font-medium">Not sure what you need?</div>
            <div className="text-sm text-sidebar-foreground/60 max-w-md">
              Our team will assess your business and recommend the right solution. Free, no strings.
            </div>
          </div>
        </div>
        <Button asChild>
          <a href={waLink("Hi HustlePortal team! I'd like a free business assessment, please.")} target="_blank" rel="noreferrer">
            <MessageCircle className="h-4 w-4 mr-1.5" /> Free Business Assessment
          </a>
        </Button>
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
                  <div className="mt-3 pt-3 border-t" style={{ borderColor: `${svc.color}22` }}>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">{svc.detail}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => { e.stopPropagation(); inquire(svc) }}
                      asChild
                    >
                      <a href={waLink(svc.waMsg)} target="_blank" rel="noreferrer">
                        <MessageCircle className="h-3.5 w-3.5 mr-1.5" /> Enquire on WhatsApp
                        <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
                      </a>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Services are quoted per project and delivered by the team behind HustlePortal —
        your dashboard, our craft.
      </p>
    </div>
  )
}
