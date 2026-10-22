'use client'

/**
 * VideoStudioDialog — members build their own pitch video and attach it to
 * the email they are writing. The Remotion Player shows a live preview, and
 * the final MP4 is rendered BY THE MEMBER'S OWN BROWSER with
 * @remotion/web-renderer, so the platform pays zero render cost and runs no
 * video servers. The only server side piece is the mail attachment itself.
 *
 * v2: logo upload (downscaled client side, transparency detected so JPG logos
 * get the hero plate treatment and never an ugly floating white box), and a
 * quality selector — Maximum is 1080p at a controlled 5.5 Mbps bitrate with
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
  const [supported, setSupported] = useState<boolean | null>(null)
  const [businessName, setBusinessName] = useState(defaults.businessName || 'My Business')
  const [tagline, setTagline] = useState('')
  const [services, setServices] = useState<string[]>(['', '', ''])
  const [city, setCity] = useState(defaults.city || '')
  const [phone, setPhone] = useState(defaults.phone || '')
  const [accentKey, setAccentKey] = useState('ember')
  const [qualityKey, setQualityKey] = useState('max')
  const [logo, setLogo] = useState<{ dataUrl: string; hasAlpha: boolean; name: string } | null>(null)
  const [rendering, setRendering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ url: string; blob: Blob; filename: string } | null>(null)
  const resultRef = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const accent = ACCENT_PRESETS.find((a) => a.key === accentKey)?.color || '#f97316'
  const preset = QUALITY_PRESETS.find((q) => q.key === qualityKey) || QUALITY_PRESETS[0]

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
    }),
    [businessName, smartTagline, services, city, phone, accent, logo, defaults.industry]
  )

  useEffect(() => {
    if (!open) return
    let alive = true
    setSupported(null)
    canRenderMediaOnWeb({ width: preset.width, height: preset.height, container: 'mp4', videoCodec: 'h264' })
      .then((r) => { if (alive) setSupported(Boolean(r.canRender)) })
      .catch(() => { if (alive) setSupported(false) })
    return () => { alive = false }
  }, [open, preset.width, preset.height])

  useEffect(() => {
    // revoke the previous result object URL when it changes or on close
    return () => {
      if (resultRef.current) {
        URL.revokeObjectURL(resultRef.current)
        resultRef.current = null
      }
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
    if (supported === false || rendering) return
    setRendering(true)
    setProgress(0)
    setResult(null)
    try {
      const { getBlob } = await renderMediaOnWeb({
        composition: {
          id: 'pitch',
          component: LooseVideo,
          durationInFrames: PITCH_DURATION,
          fps: PITCH_FPS,
          width: preset.width,
          height: preset.height,
        },
        inputProps: inputProps as unknown as Record<string, unknown>,
        container: 'mp4',
        videoCodec: 'h264',
        videoBitrate: preset.bitrate,
        hardwareAcceleration: 'prefer-hardware',
        onProgress: ({ progress: p }) => setProgress(Math.round((p || 0) * 100)),
      })
      const blob = await getBlob()
      if (blob.size > MAX_ATTACH_BYTES) {
        toast({
          title: 'The video came out too big to email',
          description: qualityKey === 'max' ? 'Switch quality to Sharp 720p and render again. Same video, smaller file.' : 'Shorten a service line or try again. The honest cap is about 9 megabytes.',
          variant: 'destructive',
        })
        return
      }
      const filename = `pitch-${cleanName}.mp4`
      const url = URL.createObjectURL(blob)
      resultRef.current = url
      setResult({ url, blob, filename })
    } catch (e) {
      console.error('[video] render failed', e)
      toast({ title: 'The render stopped', description: 'Try Chrome or Edge on a computer for the smoothest run, then export again.', variant: 'destructive' })
    } finally {
      setRendering(false)
    }
  }, [supported, rendering, inputProps, cleanName, toast, preset, qualityKey])

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
            Build a 12 second pitch video from your business details, watch it live, then attach it to this email. Add your logo, pick the quality, and your own browser renders it at no cost.
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
              <div className="grid grid-cols-2 gap-2">
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

            {supported === false ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                This browser cannot render video at this quality. Open HustlePortal in Chrome or Edge on a computer, or Safari on iPhone with iOS 16.4 or newer, and export from there. Sharp 720p has the widest support.
              </div>
            ) : (
              <Button className="w-full" onClick={onExport} disabled={rendering || supported !== true}>
                {rendering ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Film className="h-4 w-4 mr-1" />}
                {rendering ? `Rendering ${progress}%` : 'Create the video'}
              </Button>
            )}

            {rendering && (
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-[var(--brand)] transition-all" style={{ width: `${progress}%` }} />
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

// Remotion's loose Record types vs our strict PitchProps — one bridge, used twice
const LooseVideo = PitchVideo as unknown as React.FC<Record<string, unknown>>
