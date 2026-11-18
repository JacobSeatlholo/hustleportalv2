'use client'

// ============ EXEC TESTIMONIAL MODERATION (Task 219, owner) ============
// The desk's yes/no over what the world may read, mounted on the executive
// dashboard. Pending first; approve goes live on the doors and the landing,
// delete removes the row. Same exec gate as every admin/exec surface.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquareQuote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'

type Row = {
  id: string
  name: string
  business: string | null
  location: string | null
  body: string
  rating: number
  refSlug: string | null
  approved: boolean
  createdAt: string
  user: { email: string } | null
}

export default function ExecTestimonials() {
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<{ testimonials: Row[] }>('/api/admin/exec/testimonials')
      setRows(d.testimonials)
    } catch {
      setRows([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function act(id: string, action: 'approve' | 'delete') {
    setBusyId(id)
    try {
      await api('/api/admin/exec/testimonials', { method: 'POST', body: JSON.stringify({ id, action }) })
      toast({ title: action === 'approve' ? 'Testimonial is live' : 'Testimonial deleted' })
      await load()
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const pending = rows?.filter((r) => !r.approved) ?? []

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <MessageSquareQuote className="h-4 w-4 text-brand" />
          <p className="text-sm font-semibold">Testimonials</p>
          {pending.length > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 border border-amber-500/40">
              {pending.length} waiting for your yes
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="h-7 px-2 text-xs">
          <Loader2 className={`h-3 w-3 ${rows === null ? 'animate-spin' : 'opacity-0'}`} /> Refresh
        </Button>
      </div>
      {rows === null ? (
        <div className="px-4 py-4 text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-4 text-sm text-muted-foreground">
          No testimonials submitted yet. The doors and the landing carry the submit form.
        </div>
      ) : (
        <div className="divide-y">
          {rows.slice(0, 10).map((r) => (
            <div key={r.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {r.name}
                    {r.business ? <span className="text-muted-foreground font-normal"> · {r.business}</span> : ''}
                    {r.location ? <span className="text-muted-foreground font-normal"> · {r.location}</span> : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.rating}/5 · {r.refSlug ? `door ${r.refSlug}` : 'main site'} ·{' '}
                    {r.approved ? 'live' : 'pending'}
                    {r.user ? ` · member ${r.user.email}` : ''}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {!r.approved && (
                    <Button size="sm" className="h-7 px-2.5 text-xs" disabled={busyId === r.id} onClick={() => act(r.id, 'approve')}>
                      Approve
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled={busyId === r.id} onClick={() => act(r.id, 'delete')}>
                    Delete
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">{r.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
