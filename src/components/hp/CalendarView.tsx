'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api, type Appointment } from './shared'
import { useHp } from './store'
import { useToast } from '@/hooks/use-toast'
import {
  Loader2, Mic, CalendarPlus, Video, Copy, Trash2, Download, CalendarDays, Radio,
} from 'lucide-react'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

function localDT(v: string | null | undefined) {
  if (!v) return '—'
  return new Date(v).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function icsHref(appts: Appointment[]): string {
  const lines = appts.map((a) => ({ uid: a.id, title: a.title, description: a.notes, location: a.meetLink, startsAt: new Date(a.startsAt), endsAt: a.endsAt ? new Date(a.endsAt) : null }))
  // Lazy import-free ICS build (client copy of the server format, minimal fields)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  const body = lines.map((e) => {
    const end = e.endsAt || new Date(e.startsAt.getTime() + 3600000)
    return ['BEGIN:VEVENT', `UID:${e.uid}@hustleportal`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(e.startsAt)}`, `DTEND:${fmt(end)}`, `SUMMARY:${esc(e.title)}`, e.location ? `LOCATION:${esc(e.location)}` : null, 'END:VEVENT'].filter(Boolean).join('\r\n')
  }).join('\r\n')
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//HustlePortal//EN\r\n${body}\r\nEND:VCALENDAR`
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`
}

function gcalTemplate(a: Appointment): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const end = a.endsAt ? new Date(a.endsAt) : new Date(new Date(a.startsAt).getTime() + 3600000)
  const p = new URLSearchParams({ action: 'TEMPLATE', text: a.title, dates: `${fmt(new Date(a.startsAt))}/${fmt(end)}`, details: a.notes || '', location: a.meetLink || '' })
  return `https://calendar.google.com/calendar/render?${p}`
}

export default function CalendarView() {
  const { activeProjectId, bumpRefresh } = useHp()
  const { toast } = useToast()
  const [upcoming, setUpcoming] = useState<Appointment[]>([])
  const [past, setPast] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [parsing, setParsing] = useState(false)

  const [title, setTitle] = useState('')
  const [clientName, setClientName] = useState('')
  const [when, setWhen] = useState('')
  const [duration, setDuration] = useState(60)
  const [notes, setNotes] = useState('')

  const recRef = useRef<SpeechRecognitionLike | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [up, pa] = await Promise.all([
        api<{ appointments: Appointment[] }>('/api/appointments?scope=upcoming'),
        api<{ appointments: Appointment[] }>('/api/appointments?scope=past'),
      ])
      setUpcoming(up.appointments)
      setPast(pa.appointments)
    } catch (e) {
      toast({ title: 'Could not load calendar', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  function startVoice() {
    const W = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition
    if (!SR) {
      toast({ title: 'Voice not supported', description: 'This browser has no speech recognition — type the details instead.', variant: 'destructive' })
      return
    }
    const rec = new SR()
    rec.lang = 'en-ZA'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = (e) => {
      const text = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join(' ')
      setTranscript(text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    setTranscript('')
    setListening(true)
    rec.start()
  }

  async function parseTranscript() {
    if (!transcript.trim()) return
    setParsing(true)
    try {
      const res = await api<{ parsed: { title: string; clientName: string | null; notes: string | null; startsAt: string; endsAt: string } }>(
        '/api/ai/parse-appointment',
        { method: 'POST', body: JSON.stringify({ transcript }) },
      )
      setTitle(res.parsed.title)
      setClientName(res.parsed.clientName || '')
      setNotes(res.parsed.notes || '')
      // local datetime input format
      const s = new Date(res.parsed.startsAt)
      setWhen(new Date(s.getTime() - s.getTimezoneOffset() * 60000).toISOString().slice(0, 16))
      const mins = Math.round((new Date(res.parsed.endsAt).getTime() - s.getTime()) / 60000)
      setDuration(mins > 0 ? mins : 60)
      toast({ title: 'Captured ✓', description: 'Check the details, then save.' })
    } catch (e) {
      toast({ title: 'Voice parse failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setParsing(false)
    }
  }

  async function create(source: 'MANUAL' | 'VOICE') {
    if (!title.trim() || !when) {
      toast({ title: 'Missing details', description: 'A title and a date & time are required.', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const startsAt = new Date(when)
      const res = await api<{ appointment: Appointment; gcalSynced: boolean }>('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          title, clientName, notes, source,
          projectId: activeProjectId,
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + duration * 60000).toISOString(),
        }),
      })
      toast({
        title: 'Appointment saved ✓',
        description: res.gcalSynced ? 'Synced to Google Calendar.' : `Jitsi link ready: ${res.appointment.meetLink}`,
      })
      setTitle(''); setClientName(''); setWhen(''); setNotes(''); setTranscript('')
      bumpRefresh()
      load()
    } catch (e) {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/appointments/${id}`, { method: 'DELETE' })
      setUpcoming((rows) => rows.filter((r) => r.id !== id))
    } catch {
      // non-fatal
    }
  }

  const voiceSupported = typeof window !== 'undefined' && !!((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl">Calendar</h2>
        <p className="text-sm text-muted-foreground">Appointments with shareable Jitsi meets, Google Calendar sync and voice capture.</p>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* Create */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-4 space-y-4">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <CalendarPlus className="h-4 w-4 text-brand" /> New appointment
          </h3>

          {/* Voice capture */}
          <div className="rounded-lg border border-brand/25 bg-brand/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5"><Mic className="h-3.5 w-3.5 text-brand" /> Capture by voice</span>
              {voiceSupported ? (
                <Button size="sm" variant={listening ? 'destructive' : 'secondary'} onClick={() => (listening ? recRef.current?.stop() : startVoice())}>
                  {listening ? <><Radio className="h-3.5 w-3.5 animate-pulse" /> Stop</> : <><Mic className="h-3.5 w-3.5" /> Record</>}
                </Button>
              ) : (
                <Badge variant="outline" className="text-[10px]">not supported here</Badge>
              )}
            </div>
            {listening && <p className="text-xs text-brand animate-pulse">Listening… say it naturally: &ldquo;Meeting with Sipho tomorrow at 2pm about the website&rdquo;</p>}
            <Textarea3 value={transcript} onChange={setTranscript} />
            <Button size="sm" variant="outline" onClick={parseTranscript} disabled={parsing || !transcript.trim()} className="w-full">
              {parsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SparkleIcon />}
              Parse with Gemini
            </Button>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="a-title">Title</Label>
              <Input id="a-title" placeholder="Discovery call — Bloom Beauty" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="a-client">Client (optional)</Label>
                <Input id="a-client" placeholder="Sipho Ndlovu" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-dur">Duration (min)</Label>
                <Input id="a-dur" type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 60)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-when">Date &amp; time</Label>
              <Input id="a-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-notes">Notes (optional)</Label>
              <Input id="a-notes" placeholder="Bring the quote…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => create('MANUAL')} disabled={creating} className="flex-1">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Save
              </Button>
              <Button onClick={() => create('VOICE')} disabled={creating || !transcript.trim()} variant="outline" className="flex-1">
                <Mic className="h-4 w-4" /> Save as voice
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Every appointment gets a shareable Jitsi meet link. If you connected Google Calendar in Integrations, it syncs automatically.</p>
          </div>
        </div>

        {/* Lists */}
        <div className="lg:col-span-3 space-y-4">
          <Section title={`Upcoming (${upcoming.length})`} loading={loading} empty="Nothing booked — capture your next meeting by voice." appts={upcoming} onDelete={remove} />
          <Section title={`Past (${past.length})`} loading={loading} empty="No history yet." appts={past.slice(0, 10)} onDelete={remove} past />
        </div>
      </div>
    </div>
  )
}

function Textarea3({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      rows={2}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="…or paste/type the transcript here"
      className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs"
    />
  )
}

function SparkleIcon() {
  return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" /></svg>
}

function Section({ title, loading, empty, appts, onDelete, past = false }: {
  title: string
  loading: boolean
  empty: string
  appts: Appointment[]
  onDelete: (id: string) => void
  past?: boolean
}) {
  const { toast } = useToast()
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="font-medium text-sm mb-3">{title}</h3>
      {loading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-14 rounded-md bg-white/5 animate-pulse" />)}</div>
      ) : appts.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{empty}</p>
      ) : (
        <div className="space-y-2">
          {appts.map((a) => (
            <div key={a.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{localDT(a.startsAt)}{a.clientName ? ` · ${a.clientName}` : ''}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {a.source === 'VOICE' && <Badge variant="outline" className="text-[10px] border-brand/40 text-brand"><Mic className="h-2.5 w-2.5 mr-0.5" />VOICE</Badge>}
                  {a.gcalEventId && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">GCal</Badge>}
                </div>
              </div>
              {a.notes && <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{a.notes}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {a.meetLink && (
                  <>
                    <a href={a.meetLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-brand text-black px-2.5 py-1 text-[11px] font-semibold hover:brightness-110 transition">
                      <Video className="h-3 w-3" /> Join meet
                    </a>
                    <button
                      onClick={() => { navigator.clipboard.writeText(a.meetLink!).then(() => toast({ title: 'Link copied' })) }}
                      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] hover:border-brand transition"
                    >
                      <Copy className="h-3 w-3" /> Copy link
                    </button>
                  </>
                )}
                <a href={gcalTemplate(a)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] hover:border-brand transition">
                  <CalendarDays className="h-3 w-3" /> Google
                </a>
                <a href={icsHref([a])} download={`${a.title.replace(/\s+/g, '-').toLowerCase()}.ics`} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] hover:border-brand transition">
                  <Download className="h-3 w-3" /> .ics
                </a>
                <button onClick={() => onDelete(a.id)} className="ml-auto text-muted-foreground hover:text-rose-400 transition" aria-label="Delete appointment">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {past ? null : (
        appts.length > 0 && (
          <a href={icsHref(appts)} download="hustleportal-appointments.ics" className="mt-3 inline-flex items-center gap-1 text-xs text-brand hover:underline">
            <Download className="h-3 w-3" /> Export all upcoming (.ics)
          </a>
        )
      )}
    </div>
  )
}
