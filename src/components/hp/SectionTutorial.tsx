'use client'

/**
 * SectionTutorial, "How this works" for EVERY section, so a user never gets lost.
 *
 *  - A floating Tutorial button stays in thumb reach on every view.
 *  - Core sections auto-open their walkthrough once, on first visit
 *    (per-view localStorage flag, never nags again).
 *  - Steps are plain-language outcome cards (same skeleton as the welcome tour),
 *    so nothing depends on fragile element-positioning.
 *
 * Replay/programmatic fire: window.dispatchEvent(new CustomEvent('hp:section-tutorial'))
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { GraduationCap, ArrowRight, Zap, LayoutDashboard, Target, Sparkles, Users, Unlock, MessageSquare, Plus, Building2, Camera, Package, AlertTriangle, FileText, Wallet, Bell, TrendingUp, PieChart, FileDown, Send, Repeat, Bot, ShieldCheck, CalendarDays, Video, Plug, Stethoscope, Globe, RotateCcw, ShoppingCart, Store, Share2, CreditCard, Gift, Pause, BarChart3, BookOpen } from 'lucide-react'
import { useHp, type ViewKey } from './store'
import { SECTION_TUTORIALS, type SectionTutorialDef } from './tutorials'

const ICONS: Record<string, React.ReactNode> = {
  LayoutDashboard: <LayoutDashboard className="h-7 w-7 text-brand" />,
  Target: <Target className="h-7 w-7 text-brand" />,
  Sparkles: <Sparkles className="h-7 w-7 text-brand" />,
  Users: <Users className="h-7 w-7 text-brand" />,
  Unlock: <Unlock className="h-7 w-7 text-brand" />,
  MessageSquare: <MessageSquare className="h-7 w-7 text-brand" />,
  Plus: <Plus className="h-7 w-7 text-brand" />,
  Building2: <Building2 className="h-7 w-7 text-brand" />,
  Camera: <Camera className="h-7 w-7 text-brand" />,
  Package: <Package className="h-7 w-7 text-brand" />,
  AlertTriangle: <AlertTriangle className="h-7 w-7 text-brand" />,
  FileText: <FileText className="h-7 w-7 text-brand" />,
  Wallet: <Wallet className="h-7 w-7 text-brand" />,
  Bell: <Bell className="h-7 w-7 text-brand" />,
  TrendingUp: <TrendingUp className="h-7 w-7 text-brand" />,
  PieChart: <PieChart className="h-7 w-7 text-brand" />,
  FileDown: <FileDown className="h-7 w-7 text-brand" />,
  Send: <Send className="h-7 w-7 text-brand" />,
  Repeat: <Repeat className="h-7 w-7 text-brand" />,
  Bot: <Bot className="h-7 w-7 text-brand" />,
  ShieldCheck: <ShieldCheck className="h-7 w-7 text-brand" />,
  CalendarDays: <CalendarDays className="h-7 w-7 text-brand" />,
  Video: <Video className="h-7 w-7 text-brand" />,
  Plug: <Plug className="h-7 w-7 text-brand" />,
  Stethoscope: <Stethoscope className="h-7 w-7 text-brand" />,
  Globe: <Globe className="h-7 w-7 text-brand" />,
  RotateCcw: <RotateCcw className="h-7 w-7 text-brand" />,
  ShoppingCart: <ShoppingCart className="h-7 w-7 text-brand" />,
  Store: <Store className="h-7 w-7 text-brand" />,
  Share2: <Share2 className="h-7 w-7 text-brand" />,
  CreditCard: <CreditCard className="h-7 w-7 text-brand" />,
  Gift: <Gift className="h-7 w-7 text-brand" />,
  Pause: <Pause className="h-7 w-7 text-brand" />,
  BarChart3: <BarChart3 className="h-7 w-7 text-brand" />,
  BookOpen: <BookOpen className="h-7 w-7 text-brand" />,
}

function seenKey(view: ViewKey) {
  return `hp_tut_seen_${view}`
}

export default function SectionTutorial() {
  const view = useHp((s) => s.view)
  const [openView, setOpenView] = useState<ViewKey | null>(null)
  const [step, setStep] = useState(0)

  // Auto-open ONCE per view for the core sections, after the view settles.
  useEffect(() => {
    const def = SECTION_TUTORIALS[view]
    if (!def?.auto) return
    if (typeof window === 'undefined') return
    let ls: string | null = null
    try { ls = localStorage.getItem(seenKey(view)) } catch { /* private mode */ }
    if (ls === '1') return
    const t = setTimeout(() => { setStep(0); setOpenView(view) }, 900)
    return () => clearTimeout(t)
  }, [view])

  // Programmatic fire (Profile replay, help links): hp:section-tutorial {detail?: view}
  useEffect(() => {
    const fire = (e: Event) => {
      const target = (e as CustomEvent<ViewKey | undefined>).detail || useHp.getState().view
      if (!SECTION_TUTORIALS[target]) return
      setStep(0)
      setOpenView(target)
    }
    window.addEventListener('hp:section-tutorial', fire)
    return () => window.removeEventListener('hp:section-tutorial', fire)
  }, [])

  const finish = useCallback((fireView?: ViewKey) => {
    const v = fireView || openView
    if (v) {
      try { localStorage.setItem(seenKey(v), '1') } catch { /* private mode */ }
    }
    setOpenView(null)
  }, [openView])

  const def: SectionTutorialDef | null = openView ? SECTION_TUTORIALS[openView] || null : null
  const steps = def?.steps || []
  const s = steps[step]
  const last = steps.length > 0 && step === steps.length - 1

  return (
    <>
      {/* Floating Tutorial button, thumb reach on phones, corner on desktop.
          Hidden while the dialog is open or the current view has no tutorial. */}
      {!openView && SECTION_TUTORIALS[view] && (
        <button
          onClick={() => { setStep(0); setOpenView(view) }}
          className="fixed z-30 right-4 bottom-24 md:bottom-6 flex items-center gap-1.5 rounded-full border bg-card pl-3 pr-3.5 min-h-[44px] text-xs font-medium shadow-lg hover:border-brand transition"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          aria-label={`How ${SECTION_TUTORIALS[view].title} works`}
        >
          <GraduationCap className="h-4 w-4 text-brand" />
          Tutorial
        </button>
      )}

      <Dialog open={!!def} onOpenChange={(v) => { if (!v) finish() }}>
        <DialogContent className="sm:max-w-md border-brand/30">
          {def && s && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <Badge className="bg-brand text-black hover:bg-brand font-semibold">{def.kicker}</Badge>
                  <span className="text-[11px] text-muted-foreground">{step + 1} / {steps.length}</span>
                </div>
                <DialogTitle className="font-display text-xl flex items-start gap-3">
                  <span className="shrink-0 mt-0.5">{ICONS[s.icon] || <GraduationCap className="h-7 w-7 text-brand" />}</span>
                  {s.title}
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed pt-1">{s.body}</DialogDescription>
              </DialogHeader>

              <Progress value={((step + 1) / steps.length) * 100} className="h-1.5" />

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  onClick={() => finish()}
                  className="text-xs text-muted-foreground hover:text-foreground transition"
                >
                  Got it, close
                </button>
                <div className="flex gap-2">
                  {step > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setStep((v) => v - 1)}>
                      Back
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => (last ? finish() : setStep((v) => v + 1))}
                    className="bg-brand text-black hover:bg-brand/90 font-semibold"
                  >
                    {last ? 'Let\u2019s go' : 'Next'} {!last && <ArrowRight className="h-3.5 w-3.5" />}
                    {last && <Zap className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
