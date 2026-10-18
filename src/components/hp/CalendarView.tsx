'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { api, type Appointment } from './shared'
import { useHp } from './store'
import { useToast } from '@/hooks/use-toast'
import ScanDiaryDialog from './ScanDiaryDialog'
import {
  Loader2, Mic, CalendarPlus, Video, Copy, Trash2, Download, CalendarDays, Radio, NotebookPen, Upload, RefreshCw, Link2, Link2Off,
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

interface IcsReport {
  imported: number
  duplicates: number
  total: number
  skipped: number
  message?: string
  feedSaved?: boolean
}

/**
 * IcsImportDialog — bring an existing calendar in: upload an .ics file, paste
 * its content, or connect a read-only feed link. Connected feeds get a
 * one-tap Sync now that only ever ADDS new events.
 */
function IcsImportDialog({ open, onOpenChange, onImported }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onImported: () => void
}) {
  const { toast } = useToast()
  const [icsText, setIcsText] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [saveFeed, setSaveFeed] = useState(true)
  const [connected, setConnected] = useState(false)
  const [connectedUrl, setConnectedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<IcsReport | null>(null)

  useEffect(() => {
    if (!open) return
    api<{ connected: boolean; url: string | null }>('/api/appointments/sync-ics')
      .then((r) => { setConnected(r.connected); setConnectedUrl(r.url) })
      .catch(() => {})
  }, [open])

  function readFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => setIcsText(String(reader.result || ''))
    reader.readAsText(f)
  }

  async function runImport() {
    const usingUrl = feedUrl.trim() !== ''
    if (!usingUrl && icsText.trim() === '') {
      toast({ title: 'Nothing to import yet', description: 'Upload or paste a calendar file, or give the feed link.' })
      return
    }
    setBusy(true)
    setReport(null)
    try {
      const res = await api<IcsReport>('/api/appointments/import-ics', {
        method: 'POST',
        body: JSON.stringify(usingUrl ? { url: feedUrl.trim(), saveFeed } : { ics: icsText }),
      })
      setReport(res)
      if (res.feedSaved) { setConnected(true); setConnectedUrl(feedUrl.trim()) }
      onImported()
    } catch (e) {
      toast({ title: 'Import failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setBusy(true)
    setReport(null)
    try {
      const res = await api<IcsReport>('/api/appointments/sync-ics', { method: 'POST' })
      setReport(res)
      onImported()
    } catch (e) {
      toast({ title: 'Sync failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    try {
      await api('/api/appointments/sync-ics', { method: 'DELETE' })
      setConnected(false); setConnectedUrl(null); setReport(null)
      toast({ title: 'Feed disconnected', description: 'Imported events stay on your calendar. Sync simply stops.' })
    } catch { /* non-fatal */ }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4 text-brand" /> Import your calendar</DialogTitle>
          <DialogDescription>
            Bring your existing diary in without retyping it. Upload the .ics file your calendar app exports, or connect its feed link and sync any time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ics-file">Upload an .ics file</Label>
            <Input id="ics-file" type="file" accept=".ics,text/calendar,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ics-text">…or paste the calendar file content</Label>
            <Textarea id="ics-text" rows={4} value={icsText} onChange={(e) => setIcsText(e.target.value)} placeholder="BEGIN:VCALENDAR…" />
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="ics-url">…or connect a calendar feed link</Label>
              <Input id="ics-url" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" inputMode="url" />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={saveFeed} onCheckedChange={(v) => setSaveFeed(v === true)} />
              Remember this link so Sync now works from the button
            </label>
            {connected && (
              <div className="flex items-center justify-between rounded-md bg-brand/5 border border-brand/25 px-2.5 py-2 text-xs">
                <span className="flex items-center gap-1.5 min-w-0"><Link2 className="h-3.5 w-3.5 text-brand shrink-0" /><span className="truncate text-muted-foreground">Feed connected</span></span>
                <span className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" onClick={syncNow} disabled={busy} className="h-7 text-[11px]"><RefreshCw className={`h-3 w-3 mr-1 ${busy ? 'animate-spin' : ''}`} /> Sync now</Button>
                  <Button size="sm" variant="ghost" onClick={disconnect} className="h-7 text-[11px] text-muted-foreground"><Link2Off className="h-3 w-3" /></Button>
                </span>
              </div>
            )}
          </div>
          <Button onClick={runImport} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import events
          </Button>
          {report && (
            <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-medium">{report.imported} imported · {report.duplicates} already on your calendar</p>
              {report.message && <p className="text-muted-foreground">{report.message}</p>}
              {report.feedSaved && <p className="text-brand">Feed saved. Sync now lives on the button whenever you need it.</p>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
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
  const [scanOpen, setScanOpen] = useState(false)
  const [icsOpen, setIcsOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl">Calendar</h2>
          <p className="text-sm text-muted-foreground">Appointments with shareable Jitsi meets, Google Calendar sync and voice capture.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setIcsOpen(true)}>
            <Upload className="h-4 w-4 mr-1.5 text-brand" /> Import or sync
          </Button>
          <Button variant="outline" onClick={() => setScanOpen(true)}>
            <NotebookPen className="h-4 w-4 mr-1.5 text-brand" /> Snap a diary page
          </Button>
        </div>
      </div>

      <IcsImportDialog open={icsOpen} onOpenChange={setIcsOpen} onImported={load} />

      <div className="grid lg:grid-cols-5 gap-4">
        {/* Create */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-4 space-y-4">
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

      <ScanDiaryDialog open={scanOpen} onOpenChange={setScanOpen} onDone={() => { bumpRefresh(); load() }} />
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
    <div className="rounded-lg border bg-card p-4">
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
                    <a href={a.meetLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-brand text-black px-2.5 py-1 text-[11px] font-semibold hover:bg-brand/90 transition">
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
