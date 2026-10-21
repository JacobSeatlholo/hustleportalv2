'use client'

/**
 * VideoStudioDialog — members build their own pitch video and attach it to
 * the email they are writing. The Remotion Player shows a live preview, and
 * the final MP4 is rendered BY THE MEMBER'S OWN BROWSER with
 * @remotion/web-renderer, so the platform pays zero render cost and runs no
 * video servers. The only server side piece is the mail attachment itself.
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
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { Clapperboard, Download, Film, Loader2, Paperclip } from 'lucide-react'
import {
  ACCENT_PRESETS,
  PITCH_DURATION,
  PITCH_FPS,
  PITCH_HEIGHT,
  PITCH_WIDTH,
  PitchVideo,
  type PitchProps,
} from './PitchVideo'

export interface VideoAttach {
  filename: string
  base64: string
  sizeBytes: number
}

const MAX_ATTACH_BYTES = 9.5 * 1024 * 1024

interface VideoStudioDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  onAttach: (a: VideoAttach) => void
  defaults: { businessName: string; city: string; phone: string; industry: string }
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
  const [rendering, setRendering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ url: string; blob: Blob; filename: string } | null>(null)
  const resultRef = useRef<string | null>(null)

  const accent = ACCENT_PRESETS.find((a) => a.key === accentKey)?.color || '#f97316'

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
      city: city.trim() || undefined,
      phone: phone.trim() || undefined,
      accent,
    }),
    [businessName, smartTagline, services, city, phone, accent]
  )

  useEffect(() => {
    if (!open) return
    let alive = true
    canRenderMediaOnWeb({ width: PITCH_WIDTH, height: PITCH_HEIGHT, container: 'mp4', videoCodec: 'h264' })
      .then((r) => { if (alive) setSupported(Boolean(r.canRender)) })
      .catch(() => { if (alive) setSupported(false) })
    return () => { alive = false }
  }, [open])

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

  const onExport = useCallback(async () => {
    if (supported === false || rendering) return
    setRendering(true)
    setProgress(0)
    setResult(null)
    try {
      const { getBlob } = await renderMediaOnWeb({
        composition: {
          id: pitchCompositionMeta.id,
          component: LooseVideo,
          durationInFrames: PITCH_DURATION,
          fps: PITCH_FPS,
          width: PITCH_WIDTH,
          height: PITCH_HEIGHT,
        },
        inputProps: inputProps as unknown as Record<string, unknown>,
        container: 'mp4',
        videoCodec: 'h264',
        onProgress: ({ progress: p }) => setProgress(Math.round((p || 0) * 100)),
      })
      const blob = await getBlob()
      if (blob.size > MAX_ATTACH_BYTES) {
        toast({ title: 'The video came out too big to email', description: 'Shorten a service line or try again. The honest cap is about 9 megabytes.', variant: 'destructive' })
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
  }, [supported, rendering, inputProps, cleanName, toast])

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
            Build a 12 second pitch video from your business details, watch it live, then attach it to this email. Your own browser renders it, so it costs you nothing.
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
                compositionWidth={PITCH_WIDTH}
                compositionHeight={PITCH_HEIGHT}
                style={{ width: '100%' }}
                controls
                loop
              />
            </div>

            {supported === false ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                This browser cannot render video. Open HustlePortal in Chrome or Edge on a computer, or Safari on iPhone with iOS 16.4 or newer, and export from there.
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

// kept in sync with PitchVideo.tsx — renderMediaOnWeb takes the metadata inline
const pitchCompositionMeta = { id: 'pitch' }

// Remotion's loose Record types vs our strict PitchProps — one bridge, used twice
const LooseVideo = PitchVideo as unknown as React.FC<Record<string, unknown>>
