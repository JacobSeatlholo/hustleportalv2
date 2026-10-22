'use client'

/**
 * ScanDiaryDialog, "Snap my diary": photo of a paper diary/notebook in,
 * AI reads the entries out, user reviews/edits in a checklist, then commit
 * flows through the existing POST /api/tasks and POST /api/appointments
 * endpoints (so gamification, Jitsi links and GCal sync all keep working).
 *
 * Mounted from TasksView ("Scan diary") and CalendarView ("Snap a page").
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'
import { Camera, Loader2, ListChecks, NotebookPen, CalendarClock, CheckCircle2 } from 'lucide-react'

interface OcrTask { key: string; include: boolean; title: string; notes: string | null; dueDate: string | null; priority: string }
interface OcrEvent { key: string; include: boolean; title: string; location: string | null; startsAt: string; endsAt: string | null; notes: string | null; clientName: string | null }

const isoToDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
const isoToLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const localInputToIso = (v: string) => (v ? new Date(v).toISOString() : null)

export default function ScanDiaryDialog({
  open, onOpenChange, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; onDone: (tasks: number, events: number) => void }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [thumb, setThumb] = useState<string | null>(null)
  const [tasks, setTasks] = useState<OcrTask[]>([])
  const [events, setEvents] = useState<OcrEvent[]>([])
  const [scanned, setScanned] = useState(false)

  useEffect(() => {
    if (!open) {
      setThumb(null); setTasks([]); setEvents([]); setScanned(false)
    }
  }, [open])

  async function scan(f: File | undefined) {
    if (!f) return
    if (!f.type.startsWith('image/')) {
      toast({ title: 'That is not an image', description: 'Upload a photo (PNG/JPG) of your diary page.', variant: 'destructive' })
      return
    }
    if (f.size > 8 * 1024 * 1024) {
      toast({ title: 'Image too big (max 8 MB)', variant: 'destructive' })
      return
    }
    setBusy(true)
    setThumb(URL.createObjectURL(f))
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result || ''))
        r.onerror = () => reject(new Error('Could not read the image'))
        r.readAsDataURL(f)
      })
      const res = await api<{ ok: boolean; tasks: { title: string; notes: string | null; dueDate: string | null; priority: string }[]; events: { title: string; location: string | null; startsAt: string; endsAt: string | null; notes: string | null; clientName: string | null }[] }>(
        '/api/ai/ocr-diary',
        { method: 'POST', body: JSON.stringify({ imageBase64: b64, mimeType: f.type || 'image/jpeg' }) }
      )
      setTasks(res.tasks.map((t, i) => ({ ...t, key: `t${i}`, include: true })))
      setEvents(res.events.map((e, i) => ({ ...e, key: `e${i}`, include: true })))
      setScanned(true)
      if (!res.tasks.length && !res.events.length) {
        toast({ title: 'No entries found', description: 'Lighting a bit better or a closer shot usually does the trick.', variant: 'destructive' })
      } else {
        toast({ title: `AI read ${res.tasks.length} task${res.tasks.length === 1 ? '' : 's'} and ${res.events.length} event${res.events.length === 1 ? '' : 's'}`, description: 'Untick anything you do not want, then save.' })
      }
    } catch (e) {
      toast({ title: 'Scan failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    const tSel = tasks.filter((t) => t.include && t.title.trim())
    const eSel = events.filter((e) => e.include && e.title.trim())
    if (!tSel.length && !eSel.length) return
    setCommitting(true)
    let okT = 0, okE = 0
    try {
      for (const t of tSel) {
        try {
          await api('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({ title: t.title.trim(), notes: t.notes, priority: t.priority, dueDate: t.dueDate || undefined }),
          })
          okT++
        } catch {}
      }
      for (const e of eSel) {
        try {
          await api('/api/appointments', {
            method: 'POST',
            body: JSON.stringify({
              title: e.title.trim(), location: e.location, notes: e.notes, clientName: e.clientName,
              startsAt: e.startsAt, endsAt: e.endsAt || undefined,
            }),
          })
          okE++
        } catch {}
      }
      toast({ title: `${okT} task${okT === 1 ? '' : 's'} + ${okE} event${okE === 1 ? '' : 's'} added ✓`, description: 'Straight from your diary into the plan.' })
      onDone(okT, okE)
      onOpenChange(false)
    } finally {
      setCommitting(false)
    }
  }

  const canCommit = tasks.some((t) => t.include && t.title.trim()) || events.some((e) => e.include && e.title.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-brand" /> Snap your diary
          </DialogTitle>
          <DialogDescription>
            Photograph a diary or notebook page, AI reads the handwriting and queues every to-do into Tasks and every
            appointment into your Calendar. You approve the list before anything is saved.
          </DialogDescription>
        </DialogHeader>

        {!scanned ? (
          <label
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-brand/40 bg-brand/5 p-6 cursor-pointer hover:border-brand/60 transition-colors ${busy ? 'pointer-events-none opacity-70' : ''}`}
          >
            {thumb ? (
              <img src={thumb} alt="Diary page" className="max-h-40 rounded object-contain border" />
            ) : busy ? (
              <Loader2 className="h-8 w-8 animate-spin text-brand" />
            ) : (
              <Camera className="h-8 w-8 text-brand" />
            )}
            <span className="text-sm font-medium">{busy ? 'AI is reading your page…' : 'Upload or snap a photo of the page'}</span>
            <span className="text-xs text-muted-foreground">Clear lighting, flat page = best results · PNG or JPG, max 8 MB</span>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { scan(e.target.files?.[0]); e.currentTarget.value = '' }} />
          </label>
        ) : (
          <div className="space-y-4">
            {tasks.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <ListChecks className="h-3.5 w-3.5 text-brand" /> Tasks ({tasks.filter((t) => t.include).length}/{tasks.length})
                </p>
                {tasks.map((t) => (
                  <div key={t.key} className="flex items-start gap-2 rounded-lg border p-2">
                    <Checkbox checked={t.include} onCheckedChange={(v) => setTasks((arr) => arr.map((x) => (x.key === t.key ? { ...x, include: v === true } : x)))} className="mt-2" />
                    <div className="flex-1 space-y-1.5">
                      <Input value={t.title} onChange={(e) => setTasks((arr) => arr.map((x) => (x.key === t.key ? { ...x, title: e.target.value } : x)))} className="h-8 text-sm" />
                      <div className="flex gap-2">
                        <Input type="date" value={isoToDateInput(t.dueDate)} onChange={(e) => setTasks((arr) => arr.map((x) => (x.key === t.key ? { ...x, dueDate: e.target.value || null } : x)))} className="h-7 w-40 text-xs" />
                        <Select value={t.priority} onValueChange={(v) => setTasks((arr) => arr.map((x) => (x.key === t.key ? { ...x, priority: v } : x)))}>
                          <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="HIGH">High</SelectItem>
                            <SelectItem value="MEDIUM">Medium</SelectItem>
                            <SelectItem value="LOW">Low</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {events.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 text-brand" /> Calendar ({events.filter((e) => e.include).length}/{events.length})
                </p>
                {events.map((e) => (
                  <div key={e.key} className="flex items-start gap-2 rounded-lg border p-2">
                    <Checkbox checked={e.include} onCheckedChange={(v) => setEvents((arr) => arr.map((x) => (x.key === e.key ? { ...x, include: v === true } : x)))} className="mt-2" />
                    <div className="flex-1 space-y-1.5">
                      <Input value={e.title} onChange={(ev) => setEvents((arr) => arr.map((x) => (x.key === e.key ? { ...x, title: ev.target.value } : x)))} className="h-8 text-sm" />
                      <div className="flex flex-wrap gap-2">
                        <Input type="datetime-local" value={isoToLocalInput(e.startsAt)} onChange={(ev) => setEvents((arr) => arr.map((x) => (x.key === e.key ? { ...x, startsAt: localInputToIso(ev.target.value) || x.startsAt } : x)))} className="h-7 w-56 text-xs" />
                        {e.clientName && <span className="text-[11px] text-muted-foreground self-center">client: {e.clientName}</span>}
                        {e.location && <span className="text-[11px] text-muted-foreground self-center">@ {e.location}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setThumb(null); setTasks([]); setEvents([]); setScanned(false) }}>Scan another page</Button>
              <Button onClick={commit} disabled={committing || !canCommit}>
                {committing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                Add to plan
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
