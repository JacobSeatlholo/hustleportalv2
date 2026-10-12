'use client'

import { EmptyState, ErrorState, LoadingRows } from '@/components/hustle/kit'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiFetch, useResource } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Pin, PinOff, Plus, StickyNote, Trash2 } from 'lucide-react'
import { useState } from 'react'

type Note = {
  id: string; title: string; content: string; color: string; pinned: boolean; updatedAt: string
}

const COLORS = [
  { key: 'default', label: 'Paper', card: 'bg-card', dot: 'bg-zinc-400' },
  { key: 'yellow', label: 'Yellow', card: 'bg-amber-50 border-amber-200 dark:bg-amber-950/50 dark:border-amber-900', dot: 'bg-amber-400' },
  { key: 'green', label: 'Green', card: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-900', dot: 'bg-emerald-400' },
  { key: 'rose', label: 'Rose', card: 'bg-rose-50 border-rose-200 dark:bg-rose-950/50 dark:border-rose-900', dot: 'bg-rose-400' },
  { key: 'violet', label: 'Violet', card: 'bg-violet-50 border-violet-200 dark:bg-violet-950/50 dark:border-violet-900', dot: 'bg-violet-400' },
]

const EMPTY = { title: '', content: '', color: 'default', pinned: false }

export function NotesView() {
  const notesRes = useResource<Note[]>('/api/notes')
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  function startCreate() {
    setEditing(null)
    setForm({ ...EMPTY })
    setOpen(true)
  }

  function startEdit(n: Note) {
    setEditing(n)
    setForm({ title: n.title, content: n.content, color: n.color, pinned: n.pinned })
    setOpen(true)
  }

  async function save() {
    if (!form.title.trim()) {
      toast({ title: 'Title is required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await apiFetch(editing ? `/api/notes/${editing.id}` : '/api/notes', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      })
      toast({ title: editing ? 'Note updated' : 'Note created', description: form.title })
      setOpen(false)
      notesRes.refresh()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function togglePin(n: Note) {
    try {
      await apiFetch(`/api/notes/${n.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !n.pinned }) })
      notesRes.refresh()
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  async function remove(n: Note) {
    if (!confirm(`Delete note "${n.title}"?`)) return
    try {
      await apiFetch(`/api/notes/${n.id}`, { method: 'DELETE' })
      toast({ title: 'Note deleted' })
      notesRes.refresh()
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{notesRes.data?.length ?? 0} notes</span>
        <Button onClick={startCreate}><Plus className="mr-1.5 h-4 w-4" aria-hidden /> New note</Button>
      </div>

      {notesRes.loading ? <LoadingRows rows={4} /> : notesRes.error ? (
        <ErrorState message={notesRes.error} onRetry={notesRes.refresh} />
      ) : (notesRes.data?.length ?? 0) === 0 ? (
        <EmptyState icon={StickyNote} title="No notes yet" hint="Jot down pricing rules, client preferences, ideas — the brain of the operation." />
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4">
          {notesRes.data!.map((n) => {
            const color = COLORS.find((c) => c.key === n.color) ?? COLORS[0]
            return (
              <div key={n.id} className={cn('break-inside-avoid rounded-xl border p-4 shadow-sm transition-shadow hover:shadow-md', color.card)}>
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 text-left" onClick={() => startEdit(n)} aria-label={`Edit ${n.title}`}>
                    <p className="truncate text-sm font-semibold">{n.title}</p>
                  </button>
                  <div className="flex shrink-0 gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => togglePin(n)} aria-label={n.pinned ? `Unpin ${n.title}` : `Pin ${n.title}`}>
                      {n.pinned ? <Pin className="h-3 w-3 text-amber-600" /> : <PinOff className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600" onClick={() => remove(n)} aria-label={`Delete ${n.title}`}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <button className="mt-1 w-full whitespace-pre-wrap text-left text-xs leading-relaxed text-muted-foreground" onClick={() => startEdit(n)}>
                  {n.content || '—'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit note' : 'New note'}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="n-title">Title *</Label>
              <Input id="n-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="n-content">Content</Label>
              <Textarea id="n-content" rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setForm({ ...form, color: c.key })}
                    aria-label={`Color ${c.label}`}
                    className={cn('h-8 w-8 rounded-full border-2 p-1', form.color === c.key ? 'border-foreground' : 'border-transparent')}
                  >
                    <span className={cn('block h-full w-full rounded-full', c.dot)} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create note'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
