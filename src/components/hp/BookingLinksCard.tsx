'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { api } from './shared'
import { useToast } from '@/hooks/use-toast'
import { BOOKING_KINDS, bookingKind } from '@/lib/booking'
import { CalendarCheck, Copy, Loader2, Plus, Trash2, ExternalLink, Pencil } from 'lucide-react'

/**
 * Booking links, the calendar's public front door. The owner publishes what
 * they make available; guests book themselves in from a shareable page that
 * looks like the brand and lands the slot on the owner's calendar CONFIRMED.
 * Built for the practitioner who loses hours to phone tag and surprise
 * walk-ins: a doctor, a therapist, anyone whose diary must not be a guess.
 */

interface BookingLinkRow {
  id: string
  slug: string
  title: string
  kind: string
  durationMin: number
  bufferMin: number
  location: string | null
  description: string | null
  avail: string
  logoUrl: string | null
  bookings: number
  active: boolean
}

interface RecentBooking {
  id: string
  bookingLinkId: string
  title: string
  clientName: string | null
  startsAt: string
  notes: string | null
}

interface ApiShape {
  links: BookingLinkRow[]
  recent: RecentBooking[]
}

interface Draft {
  id?: string
  title: string
  kind: string
  durationMin: number
  bufferMin: number
  location: string
  description: string
  avail: Record<string, Array<{ s: string; e: string }>>
  logoSvg: string | null
  logoPreview: string | null
  active: boolean
}

const DAY_ROWS: Array<{ key: string; label: string; dow: string }> = [
  { key: '1', label: 'Mon', dow: '1' },
  { key: '2', label: 'Tue', dow: '2' },
  { key: '3', label: 'Wed', dow: '3' },
  { key: '4', label: 'Thu', dow: '4' },
  { key: '5', label: 'Fri', dow: '5' },
  { key: '6', label: 'Sat', dow: '6' },
  { key: '0', label: 'Sun', dow: '0' },
]

const KIND_HINT: Record<string, string> = {
  PHONE: 'Guests must leave a number — you call them at the booked time.',
  VIDEO: 'A video-call link is created automatically and sent with both confirmations.',
  HOUSE_CALL: 'You travel to the guest — put the area you cover in the venue field.',
}

function freshDraft(): Draft {
  return {
    title: '',
    kind: 'MEETING',
    durationMin: 30,
    bufferMin: 0,
    location: '',
    description: '',
    avail: {
      '1': [{ s: '09:00', e: '17:00' }],
      '2': [{ s: '09:00', e: '17:00' }],
      '3': [{ s: '09:00', e: '17:00' }],
      '4': [{ s: '09:00', e: '17:00' }],
      '5': [{ s: '09:00', e: '17:00' }],
    },
    logoSvg: null,
    logoPreview: null,
    active: true,
  }
}

export default function BookingLinksCard() {
  const { toast } = useToast()
  const [data, setData] = useState<ApiShape | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(freshDraft())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await api<ApiShape>('/api/booking-links'))
    } catch {
      // the card stays quiet if the section is briefly unavailable
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setDraft(freshDraft())
    setOpen(true)
  }

  function openEdit(l: BookingLinkRow) {
    let avail: Draft['avail'] = {}
    try { avail = JSON.parse(l.avail || '{}') } catch { /* keep empty */ }
    setDraft({
      id: l.id,
      title: l.title,
      kind: l.kind,
      durationMin: l.durationMin,
      bufferMin: l.bufferMin,
      location: l.location || '',
      description: l.description || '',
      avail,
      logoSvg: null,
      logoPreview: l.logoUrl,
      active: l.active,
    })
    setOpen(true)
  }

  function readLogo(f: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      setDraft((d) => ({ ...d, logoSvg: text, logoPreview: text.startsWith('data:') ? text : `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}` }))
    }
    reader.readAsText(f)
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        id: draft.id,
        title: draft.title,
        kind: draft.kind,
        durationMin: draft.durationMin,
        bufferMin: draft.bufferMin,
        location: draft.location,
        description: draft.description,
        avail: draft.avail,
        ...(draft.logoSvg !== null ? { logoSvg: draft.logoSvg } : {}),
      }
      if (draft.id) {
        await api('/api/booking-links', { method: 'PATCH', body: JSON.stringify(payload) })
        toast({ title: 'Booking link updated ✓' })
      } else {
        await api('/api/booking-links', { method: 'POST', body: JSON.stringify(payload) })
        toast({ title: 'Booking link live ✓', description: 'Copy the link and put it anywhere your clients already look.' })
      }
      setOpen(false)
      load()
    } catch (e) {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(l: BookingLinkRow) {
    try {
      await api('/api/booking-links', { method: 'PATCH', body: JSON.stringify({ id: l.id, active: !l.active }) })
      load()
    } catch {
      // non-fatal
    }
  }

  async function remove(l: BookingLinkRow) {
    try {
      await api(`/api/booking-links?id=${l.id}`, { method: 'DELETE' })
      toast({ title: 'Link removed', description: 'Bookings already made stay on your calendar.' })
      load()
    } catch {
      // non-fatal
    }
  }

  function copyLink(l: BookingLinkRow) {
    navigator.clipboard.writeText(`https://www.hustleportal.online/book/${l.slug}`).then(() => {
      toast({ title: 'Booking link copied', description: 'Paste it in your WhatsApp status, bio, email signature — anywhere.' })
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="font-medium text-sm flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-brand" /> Booking links
          <span className="text-xs font-normal text-muted-foreground">— let clients book themselves in</span>
        </h3>
        <Button size="sm" variant="outline" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> New booking link</Button>
      </div>

      {!data ? (
        <div className="h-10 rounded-md bg-white/5 animate-pulse" />
      ) : data.links.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4">
          No booking links yet. Create one, set the hours you make available, and share the link — clients pick a
          time that is actually free and it lands on this calendar confirmed. No phone tag, no surprise walk-ins.
        </p>
      ) : (
        <div className="space-y-2">
          {data.links.map((l) => {
            const url = `https://www.hustleportal.online/book/${l.slug}`
            const upcoming = data.recent.filter((r) => r.bookingLinkId === l.id)
            return (
              <div key={l.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{l.title} <span className="text-xs text-muted-foreground font-normal">· {l.durationMin} min{bufferNote(l.bufferMin)}</span></p>
                    <p className="text-xs text-muted-foreground truncate">{url}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{bookingKind(l.kind).icon} {bookingKind(l.kind).label}</Badge>
                    {!l.active && <Badge variant="outline" className="text-[10px] text-muted-foreground">paused</Badge>}
                    {l.bookings > 0 && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">{l.bookings} booked</Badge>}
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copyLink(l)} aria-label="Copy link"><Copy className="h-3.5 w-3.5" /></Button>
                    <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center justify-center rounded-md px-2 hover:bg-muted" aria-label="Open page"><ExternalLink className="h-3.5 w-3.5" /></a>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(l)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-rose-400" onClick={() => remove(l)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                    <Switch checked={l.active} onCheckedChange={() => toggleActive(l)} aria-label="Pause or resume" />
                  </div>
                </div>
                {upcoming.length > 0 && (
                  <div className="mt-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs space-y-1">
                    {upcoming.slice(0, 3).map((b) => (
                      <p key={b.id} className="truncate"><span className="text-brand font-medium">{new Date(b.startsAt).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> — {b.clientName || b.title}</p>
                    ))}
                    {upcoming.length > 3 && <p className="text-muted-foreground">+{upcoming.length - 3} more on the calendar</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft.id ? 'Edit booking link' : 'New booking link'}</DialogTitle>
            <DialogDescription>
              Guests see a page in the HustlePortal look, pick a slot that is actually free, and it lands on your
              calendar confirmed. Times are South African time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bl-title">What are they booking?</Label>
              <Input id="bl-title" placeholder="Consultation, Check-in, Demo…" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select
                  className="w-full rounded-md border bg-background px-2.5 py-2 text-sm"
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                >
                  {BOOKING_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>{k.icon} {k.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-dur">Minutes</Label>
                <Input id="bl-dur" type="number" min={10} max={480} step={5} value={draft.durationMin} onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) || 30 })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-buf">Buffer (min)</Label>
                <Input id="bl-buf" type="number" min={0} max={120} step={5} value={draft.bufferMin} onChange={(e) => setDraft({ ...draft, bufferMin: Number(e.target.value) || 0 })} />
              </div>
            </div>
            {KIND_HINT[draft.kind] && (
              <p className="text-[11px] text-muted-foreground -mt-2">{KIND_HINT[draft.kind]}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="bl-loc">Location (optional)</Label>
              <Input id="bl-loc" placeholder={bookingKind(draft.kind).locationPlaceholder} value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} maxLength={160} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bl-desc">What should guests know? (optional)</Label>
              <Textarea id="bl-desc" rows={2} placeholder="Bring your ID and medical aid card…" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={800} />
            </div>
            <div className="space-y-2">
              <Label>Your weekly availability</Label>
              {DAY_ROWS.map((row) => {
                const win = draft.avail[row.dow]?.[0]
                const on = Boolean(win)
                return (
                  <div key={row.key} className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-2 w-20 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          const next = { ...draft.avail }
                          if (e.target.checked) next[row.dow] = [{ s: '09:00', e: '17:00' }]
                          else delete next[row.dow]
                          setDraft({ ...draft, avail: next })
                        }}
                      />
                      {row.label}
                    </label>
                    {on && win ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input type="time" value={win.s} onChange={(e) => setDraft({ ...draft, avail: { ...draft.avail, [row.dow]: [{ ...win, s: e.target.value }] } })} className="h-8" />
                        <span className="text-xs text-muted-foreground">to</span>
                        <Input type="time" value={win.e} onChange={(e) => setDraft({ ...draft, avail: { ...draft.avail, [row.dow]: [{ ...win, e: e.target.value }] } })} className="h-8" />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground flex-1">not available</span>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bl-logo">Your logo (optional, SVG)</Label>
              <Input id="bl-logo" type="file" accept=".svg,image/svg+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) readLogo(f) }} />
              {draft.logoPreview && (
                <div className="flex items-center gap-2 mt-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={draft.logoPreview} alt="Logo preview" className="h-9 w-9 rounded border object-contain bg-white p-1" />
                  <button className="text-xs text-muted-foreground hover:text-rose-400" onClick={() => setDraft({ ...draft, logoSvg: '', logoPreview: null })}>Remove logo</button>
                </div>
              )}
            </div>
            <Button onClick={save} disabled={saving || draft.title.trim().length < 2} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
              {draft.id ? 'Save changes' : 'Create booking link'}
            </Button>
            {draft.logoSvg === '' && <p className="text-[11px] text-muted-foreground -mt-2">Logo will be removed when you save.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function bufferNote(bufferMin: number): string {
  return bufferMin > 0 ? ` · ${bufferMin} min buffer` : ''
}
