'use client'

/**
 * InstallApp — "Take HustlePortal home" helper.
 * iOS Safari hides install prompts, so we teach it (Share → Add to Home Screen)
 * in a precise, visual dialog. Android/desktop Chrome gets the native prompt via
 * beforeinstallprompt, with an instruction fallback.
 * Open from: the sidebar chip, the WelcomeTour step, or Profile ("Replay the tour").
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Download, Share, PlusSquare, MoreVertical, CheckCircle2, Smartphone } from 'lucide-react'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const standaloneMQ = window.matchMedia?.('(display-mode: standalone)').matches
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return Boolean(standaloneMQ || iosStandalone)
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ masquerades as Macintosh with touch support
  const iPadMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  return /iPhone|iPod/.test(ua) || iPadMac || (/iPad/.test(ua))
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function InstallApp() {
  const [hidden, setHidden] = useState(true) // hidden until we know it's relevant
  const [open, setOpen] = useState(false)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isStandalone()) return // already installed — nothing to teach
    setHidden(false)

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    const fire = () => { setOpen(true) }
    window.addEventListener('hp:install-fire', fire)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('hp:install-fire', fire)
    }
  }, [])

  async function install() {
    if (deferred) {
      await deferred.prompt()
      const choice = await deferred.userChoice.catch(() => null)
      setDeferred(null)
      if (choice?.outcome === 'accepted') { setOpen(false); setHidden(true) }
    } else {
      setOpen(true)
    }
  }

  const ios = isIOS()

  return (
    <>
      {!hidden && (
        <button
          onClick={install}
          className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
        >
          <Download className="h-4 w-4 shrink-0" /> Install the app
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md border-brand/30">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 mb-1">
              <Badge className="bg-brand text-black hover:bg-brand font-semibold">One-time setup</Badge>
              <span className="text-[11px] text-muted-foreground">30 seconds</span>
            </div>
            <DialogTitle className="font-display text-2xl flex items-center gap-3">
              <Smartphone className="h-6 w-6 text-brand" /> Add HustlePortal to your home screen
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed pt-1">
              Put your Business OS one tap away — full screen, no browser bars, opens like any other app.
            </DialogDescription>
          </DialogHeader>

          {ios ? (
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">1</span>
                <span>Tap the <b>Share</b> button <Share className="inline h-4 w-4 -mt-0.5 text-brand" /> at the bottom of Safari.</span>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">2</span>
                <span>Scroll down and tap <b>Add to Home Screen</b> <PlusSquare className="inline h-4 w-4 -mt-0.5 text-brand" />.</span>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">3</span>
                <span>Tap <b>Add</b> — HustlePortal appears on your home screen like a native app.</span>
              </li>
            </ol>
          ) : (
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">1</span>
                <span>Open your browser menu <MoreVertical className="inline h-4 w-4 -mt-0.5 text-brand" /> (top-right, three dots).</span>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">2</span>
                <span>Tap <b>Install app</b> or <b>Add to Home screen</b>.</span>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">3</span>
                <span>Confirm — HustlePortal opens full screen from your home screen or desktop.</span>
              </li>
            </ol>
          )}

          <div className="rounded-lg border border-brand/20 bg-brand/5 p-2.5 text-xs text-muted-foreground flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-brand mt-0.5 shrink-0" />
            Works offline for your layout and caches your last screen — your data stays safe on HustlePortal servers either way.
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => setOpen(false)} className="bg-brand text-black hover:bg-brand/90 font-semibold">
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Open the install tutorial from anywhere (WelcomeTour step, Profile). */
export function openInstallTutorial() {
  window.dispatchEvent(new CustomEvent('hp:install-fire'))
}
