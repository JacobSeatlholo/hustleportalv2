'use client'

/**
 * VideoStudioDialog, members build their own pitch video and attach it to
 * the email they are writing. The Remotion Player shows a live preview, and
 * the final MP4 is rendered BY THE MEMBER'S OWN BROWSER with
 * @remotion/web-renderer, so the platform pays zero render cost and runs no
 * video servers. The only server side piece is the mail attachment itself.
 *
 * v4: theme switcher. Machine (default, the retro computer) or Clean (the
 * classic bold services list from v2). The choice is remembered per device.
 *
 * v3: the machine scene. The member's services boot up and play INSIDE a
 * retro computer on screen: CRT power on, boot text with their name, slides
 * with scanlines and phosphor glow, then the camera dives into the screen.
 * Bitrates rebalanced so 15 seconds at Maximum stays inside the email cap.
 *
 * v2: logo upload (downscaled client side, transparency detected so JPG logos
 * get the hero plate treatment and never an ugly floating white box), and a
 * quality selector, Maximum is 1080p at a controlled 5.5 Mbps bitrate with
 * hardware acceleration preferred, Sharp is 720p. Both are honest about file
 * size against the email attachment cap.
 *
 * Browser support: WebCodecs. Chrome and Edge are solid, Safari 16.4+
 * carries it, Firefox may refuse. canRenderMediaOnWeb() decides, and the
 * dialog says exactly that instead of failing silently.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Player } from '@remotion/player'
import { canRenderMediaOnWeb, renderMediaOnWeb } from '@remotion/web-renderer'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { Clapperboard, Download, Film, ImagePlus, Loader2, Paperclip, X } from 'lucide-react'
import {
  ACCENT_PRESETS,
  PITCH_DURATION,
  PITCH_FPS,
  QUALITY_PRESETS,
  PitchVideo,
  type PitchProps,
} from './PitchVideo'

export interface VideoAttach {
  filename: string
  base64: string
  sizeBytes: number
}

const MAX_ATTACH_BYTES = 9.5 * 1024 * 1024
const MAX_LOGO_BYTES = 4 * 1024 * 1024

interface VideoStudioDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  onAttach: (a: VideoAttach) => void
  defaults: { businessName: string; city: string; phone: string; industry: string }
}

/** Draw the uploaded image to a max 512px canvas and detect real transparency. */
async function processLogo(file: File): Promise<{ dataUrl: string; hasAlpha: boolean }> {
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error('The logo is bigger than 4 megabytes')
  }
  if (file.type === 'image/svg+xml') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result || ''))
      fr.onerror = () => reject(new Error('read failed'))
      fr.readAsDataURL(file)
    })
    return { dataUrl, hasAlpha: true }
  }
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('decode failed'))
      im.src = objectUrl
    })
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight)
    const scale = longEdge > 512 ? 512 / longEdge : 1
    const w = Math.max(2, Math.round(img.naturalWidth * scale))
    const h = Math.max(2, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.drawImage(img, 0, 0, w, h)
    // Corner probe: a logo with transparent corners sits clean on the dark stage,
    // an opaque one (JPG) gets the hero plate instead of a white box.
    let hasAlpha = false
    try {
      const d = ctx.getImageData(0, 0, w, h).data
      const corners = [
        [0, 0],
        [w - 1, 0],
        [0, h - 1],
        [w - 1, h - 1],
      ]
      hasAlpha = corners.some(([x, y]) => d[(y * w + x) * 4 + 3] < 250)
    } catch {
      hasAlpha = false
    }
    return { dataUrl: canvas.toDataURL('image/png'), hasAlpha }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export default function VideoStudioDialog({ open, onOpenChange, onAttach, defaults }: VideoStudioDialogProps) {
  const { toast } = useToast()
  const [support, setSupport] = useState<Record<string, boolean | null>>({})
  const [businessName, setBusinessName] = useState(defaults.businessName || 'My Business')
  const [tagline, setTagline] = useState('')
  const [services, setServices] = useState<string[]>(['', '', ''])
  const [city, setCity] = useState(defaults.city || '')
  const [phone, setPhone] = useState(defaults.phone || '')
  const [accentKey, setAccentKey] = useState('ember')
  const [qualityKey, setQualityKey] = useState('max')
  // Theme choice is remembered per device: machine (the retro computer) or
  // clean (the classic bold list). The template itself defaults to machine.
  const [theme, setTheme] = useState<'machine' | 'clean'>(() => {
    if (typeof window === 'undefined') return 'machine'
    try {
      return window.localStorage.getItem('hp-video-theme') === 'clean' ? 'clean' : 'machine'
    } catch {
      return 'machine'
    }
  })
  const [logo, setLogo] = useState<{ dataUrl: string; hasAlpha: boolean; name: string } | null>(null)
  const [rendering, setRendering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ url: string; blob: Blob; filename: string } | null>(null)
  const resultRef = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stallRef = useRef({ value: 0, at: 0 })
  const stallTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem('hp-video-theme', theme)
    } catch {
      // Private mode or storage blocked, the choice just lives for this visit
    }
  }, [theme])

  const accent = ACCENT_PRESETS.find((a) => a.key === accentKey)?.color || '#f97316'
  const preset = QUALITY_PRESETS.find((q) => q.key === qualityKey) || QUALITY_PRESETS[0]
  const presetIndex = QUALITY_PRESETS.findIndex((q) => q.key === preset.key)
  const anySupported = Object.values(support).some((v) => v === true)
  const supportKnown = Object.keys(support).length > 0

  const smartTagline = useMemo(() => {
    if (tagline.trim()) return tagline.trim()
    const what = defaults.industry?.trim()
    if (what && city.trim()) return `Your trusted ${what.toLowerCase()} in ${city.trim()}`
    if (what) return `Your trusted ${what.toLowerCase()}`
    if (city.trim()) return `Proudly serving ${city.trim()}`
    return 'Quality work. Honest service.'
  }, [tagline, defaults.industry, city])

  const inputProps: PitchProps = useMemo(
    () => ({
      businessName: businessName.trim() || 'My Business',
      tagline: smartTagline,
      services,
      kicker: defaults.industry?.trim() || undefined,
      city: city.trim() || undefined,
      phone: phone.trim() || undefined,
      accent,
      logoSrc: logo?.dataUrl,
      logoHasAlpha: logo?.hasAlpha,
      theme,
    }),
    [businessName, smartTagline, services, city, phone, accent, logo, defaults.industry, theme]
  )

  useEffect(() => {
    if (!open) return
    let alive = true
    setSupport({})
    // Probe EVERY rung of the ladder once, so a machine that cannot do 1080p
    // but can do 720p or 540p still gets a working export instead of a wall.
    Promise.all(
      QUALITY_PRESETS.map(async (q) => {
        try {
          const r = await canRenderMediaOnWeb({ width: q.width, height: q.height, container: 'mp4', videoCodec: 'h264' })
          return [q.key, Boolean(r.canRender)] as const
        } catch {
          return [q.key, false] as const
        }
      }),
    )
      .then((entries) => {
        if (alive) setSupport(Object.fromEntries(entries))
      })
      .catch(() => {
        if (alive) setSupport(Object.fromEntries(QUALITY_PRESETS.map((q) => [q.key, false])))
      })
    return () => { alive = false }
  }, [open])

  // The selected rung is impossible on this machine: step down to the best
  // one that can render, and say so. Nobody gets silently dead ended.
  useEffect(() => {
    if (!supportKnown || rendering) return
    if (support[preset.key] === false) {
      const firstOk = QUALITY_PRESETS.find((q) => support[q.key] === true)
      if (firstOk) {
        setQualityKey(firstOk.key)
        toast({
          title: `${preset.label} is not available on this machine`,
          description: `Switched to ${firstOk.label} quality. Same video, it will render.`,
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportKnown, qualityKey])

  useEffect(() => {
    // Revoke the PREVIOUS result URL when a new one replaces it or on unmount.
    // The closure must capture its own url: reading the ref at cleanup time
    // revoked the FRESH url every single time, so the preview video and the
    // Save link pointed at a dead blob right after every successful render.
    if (!result) return
    const url = result.url
    return () => {
      URL.revokeObjectURL(url)
      if (resultRef.current === url) resultRef.current = null
    }
  }, [result])

  const cleanName = (businessName.trim() || 'my-business').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-business'

  const onLogoFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return
    try {
      const processed = await processLogo(file)
      setLogo({ ...processed, name: file.name })
      toast({ title: 'Logo added', description: 'It rides through the whole video.' })
    } catch (e) {
      toast({
        title: 'That logo did not make it in',
        description: e instanceof Error && /megabyte/.test(e.message) ? 'Keep it under 4 megabytes.' : 'Use a PNG, JPG or SVG image.',
        variant: 'destructive',
      })
    }
  }, [toast])

  const onExport = useCallback(async () => {
    if (rendering) return
    setRendering(true)
    setProgress(0)
    setResult(null)
    // THE FALLBACK LADDER: every rung from the selected quality down, so a
    // machine that refuses one exact encoder config still lands an export.
    const attempts = QUALITY_PRESETS.slice(Math.max(0, presetIndex))
    const controller = new AbortController()
    abortRef.current = controller
    stallRef.current = { value: 0, at: Date.now() }
    // Watchdog: a WebCodecs worker that dies quietly would otherwise freeze
    // the dialog at the same percent forever. 45 seconds without any progress
    // movement means stuck, the abort ends it and the honest error shows.
    if (stallTimerRef.current) clearInterval(stallTimerRef.current)
    stallTimerRef.current = setInterval(() => {
      if (Date.now() - stallRef.current.at > 45_000) {
        controller.abort()
      }
    }, 2_000)
    try {
      for (let i = 0; i < attempts.length; i++) {
        const p = attempts[i]
        try {
          setProgress(0)
          stallRef.current = { value: 0, at: Date.now() }
          const { getBlob } = await renderMediaOnWeb({
            composition: {
              id: 'pitch',
              component: LooseVideo,
              durationInFrames: PITCH_DURATION,
              fps: PITCH_FPS,
              width: p.width,
              height: p.height,
            },
            inputProps: inputProps as unknown as Record<string, unknown>,
            container: 'mp4',
            videoCodec: 'h264',
            videoBitrate: p.bitrate,
            hardwareAcceleration: 'no-preference',
            // The composition carries no audio track, so the output was always
            // silent, muting skips the AAC encoder worker entirely and removes
            // a whole class of "audio worker failed" render failures.
            muted: true,
            licenseKey: 'free-license',
            signal: controller.signal,
            onProgress: ({ progress: p2 }) => {
              const value = Math.round((p2 || 0) * 100)
              setProgress(value)
              if (value !== stallRef.current.value) stallRef.current = { value, at: Date.now() }
            },
          })
          const blob = await getBlob()
          // A broken encoder can resolve with an empty shell instead of
          // throwing. A video under a kilobyte is not a video, treat it as a
          // failed rung and climb down the ladder instead of attaching junk.
          if (!blob || blob.size < 1000) {
            throw new Error('the render came back empty')
          }
          if (blob.size > MAX_ATTACH_BYTES) {
            const lower = attempts[i + 1]
            toast({
              title: 'The video came out too big to email',
              description: lower
                ? `Try ${lower.label} quality and render again. Same video, smaller file.`
                : 'Shorten a service line or try again. The honest cap is about 9 megabytes.',
              variant: 'destructive',
            })
            return
          }
          const filename = `pitch-${cleanName}.mp4`
          const url = URL.createObjectURL(blob)
          resultRef.current = url
          setResult({ url, blob, filename })
          return
        } catch (e) {
          if (controller.signal.aborted) {
            // The watchdog or the member stopped this run. If the watchdog did,
            // there may still be life lower down the ladder, so climb once.
            const stalled = Date.now() - stallRef.current.at > 45_000
            if (!stalled || i >= attempts.length - 1) {
              console.warn('[video] render aborted', e)
              toast({
                title: stalled ? 'The render stalled and was stopped' : 'Render cancelled',
                description: stalled
                  ? 'Try again, or pick a lower quality. Light 540p runs on the weakest devices.'
                  : 'Nothing was attached.',
                variant: stalled ? 'destructive' : 'default',
              })
              return
            }
            console.warn('[video] watchdog stopped this rung, dropping down', e)
            continue
          }
          if (i < attempts.length - 1) {
            console.warn('[video] encoder refused this quality, dropping down the ladder', e)
            toast({
              title: `${p.label} is not available on this machine`,
              description: `Rendering in ${attempts[i + 1].label} instead. Same video.`,
            })
            continue
          }
          throw e
        }
      }
    } catch (e) {
      console.error('[video] render failed', e)
      toast({ title: 'The render stopped', description: 'Try Chrome or Edge on a computer for the smoothest run, then export again.', variant: 'destructive' })
    } finally {
      if (stallTimerRef.current) {
        clearInterval(stallTimerRef.current)
        stallTimerRef.current = null
      }
      abortRef.current = null
      setRendering(false)
    }
  }, [rendering, inputProps, cleanName, toast, presetIndex])

  const onCancelRender = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const toBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '')
      fr.onerror = () => reject(new Error('read failed'))
      fr.readAsDataURL(blob)
    })

  const onAttachClick = useCallback(async () => {
    if (!result) return
    try {
      const base64 = await toBase64(result.blob)
      onAttach({ filename: result.filename, base64, sizeBytes: result.blob.size })
      toast({ title: 'Video attached', description: 'It rides along when you send this email.' })
      onOpenChange(false)
    } catch {
      toast({ title: 'Could not attach the video', description: 'Download it instead and attach it by hand.', variant: 'destructive' })
    }
  }, [result, onAttach, onOpenChange, toast])

  const setService = (i: number, v: string) => setServices((prev) => prev.map((s, j) => (j === i ? v : s)))

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!rendering) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clapperboard className="h-4 w-4 text-brand" /> Video Studio</DialogTitle>
          <DialogDescription>
            Build a 15 second pitch video from your business details, watch it live, then attach it to this email. Pick a theme, the retro computer or the classic clean look, add your logo, and your own browser renders it at no cost.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="vs-name">Business name</Label>
              <Input id="vs-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={40} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vs-tagline">Tagline (optional)</Label>
              <Input id="vs-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={smartTagline} maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label>Three things you do</Label>
              {services.map((s, i) => (
                <Input key={i} value={s} onChange={(e) => setService(i, e.target.value)} placeholder={i === 0 ? 'e.g. Kitchen renovations' : i === 1 ? 'e.g. Built in cupboards' : 'e.g. Same week quotes'} maxLength={40} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="vs-city">City</Label>
                <Input id="vs-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={30} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vs-phone">Phone</Label>
                <Input id="vs-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Your logo</Label>
              {logo ? (
                <div className="flex items-center gap-2.5 rounded-lg border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo.dataUrl} alt="Logo preview" className="h-9 w-9 rounded object-contain bg-muted" />
                  <span className="text-xs text-muted-foreground flex-1 truncate">{logo.name}</span>
                  <button type="button" onClick={() => setLogo(null)} aria-label="Remove logo" className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground hover:border-brand/60 hover:text-foreground transition"
                >
                  <ImagePlus className="h-4 w-4" /> Add your logo. PNG or JPG, it lands in every scene.
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => { onLogoFile(e.target.files?.[0]); e.target.value = '' }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <div className="flex gap-2">
                {ACCENT_PRESETS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => setAccentKey(a.key)}
                    aria-label={a.label}
                    className={`h-7 w-7 rounded-full border-2 transition ${accentKey === a.key ? 'border-white/80 scale-110' : 'border-transparent opacity-70 hover:opacity-100'}`}
                    style={{ background: a.color }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Theme</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTheme('machine')}
                  className={`rounded-lg border px-3 py-2 text-left transition ${theme === 'machine' ? 'border-brand bg-brand/10' : 'hover:border-muted-foreground/40'}`}
                >
                  <span className="block text-sm font-medium">Machine</span>
                  <span className="block text-[11px] text-muted-foreground">Your services boot up inside a retro computer</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('clean')}
                  className={`rounded-lg border px-3 py-2 text-left transition ${theme === 'clean' ? 'border-brand bg-brand/10' : 'hover:border-muted-foreground/40'}`}
                >
                  <span className="block text-sm font-medium">Clean</span>
                  <span className="block text-[11px] text-muted-foreground">Bold text on the dark stage, the classic look</span>
                </button>
              </div>
            </div>
            <div className="rounded-xl border bg-black/40 overflow-hidden">
              <Player
                component={LooseVideo}
                inputProps={inputProps as unknown as Record<string, unknown>}
                durationInFrames={PITCH_DURATION}
                fps={PITCH_FPS}
                compositionWidth={preset.width}
                compositionHeight={preset.height}
                style={{ width: '100%' }}
                controls
                loop
              />
            </div>

            <div className="space-y-1.5">
              <Label>Quality</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {QUALITY_PRESETS.map((q) => (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => setQualityKey(q.key)}
                    className={`rounded-lg border px-3 py-2 text-left transition ${qualityKey === q.key ? 'border-brand bg-brand/10' : 'hover:border-muted-foreground/40'}`}
                  >
                    <span className="block text-sm font-medium">{q.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{q.note}</span>
                  </button>
                ))}
              </div>
              {qualityKey === 'max' && (
                <p className="text-[11px] text-muted-foreground">Full HD at a high bitrate. The render takes a moment longer, the result is worth it.</p>
              )}
            </div>

            {supportKnown && !anySupported ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                This browser cannot render video at any quality. Open HustlePortal in Chrome or Edge on a computer and export from there.
              </div>
            ) : (
              <Button className="w-full" onClick={onExport} disabled={rendering || (supportKnown && support[preset.key] === false)}>
                {rendering ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Film className="h-4 w-4 mr-1" />}
                {rendering ? `Rendering ${progress}%` : !supportKnown ? 'Checking this browser' : 'Create the video'}
              </Button>
            )}

            {rendering && (
              <div className="space-y-2">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-[var(--brand)] transition-all" style={{ width: `${progress}%` }} />
                </div>
                <button
                  type="button"
                  onClick={onCancelRender}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Cancel the render
                </button>
              </div>
            )}

            {result && !rendering && (
              <div className="space-y-2 rounded-lg border p-3">
                <video src={result.url} controls className="w-full rounded-md" />
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={onAttachClick}>
                    <Paperclip className="h-4 w-4 mr-1" /> Attach to this email
                  </Button>
                  <a href={result.url} download={result.filename}>
                    <Button size="sm" variant="outline">
                      <Download className="h-4 w-4" /> Save
                    </Button>
                  </a>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {(result.blob.size / (1024 * 1024)).toFixed(1)} MB. The file lives in this tab only until you attach or save it.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Remotion's loose Record types vs our strict PitchProps, one bridge, used twice
const LooseVideo = PitchVideo as unknown as React.FC<Record<string, unknown>>
