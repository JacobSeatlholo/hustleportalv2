'use client'

/**
 * EmailPreviewDialog — click any sent email, read exactly what landed.
 *
 * One read view for every surface that shows a sent email: the mail log, the
 * campaign read-out, the lead's email activity, the exec sent-mail archive.
 * Given a log row it replays the send from what the log kept (words + look):
 * branded sends render in a sandboxed frame that mirrors the recipient's
 * inbox, plain/legacy sends show the words as they went. A small toggle flips
 * between the two on branded sends — on a phone call the plain words are
 * often the faster reference, and both are one tap apart.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Eye, Mail, Type } from 'lucide-react'
import { api } from './shared'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

/** The shape every surface can hand over. EmailLogRow, CampaignRow (mapped),
 *  LeadEmailLog and the exec archive row all satisfy it. */
export interface EmailPreviewRow {
  id: string
  toEmail: string
  subject: string
  body: string
  status: string
  error?: string | null
  theme?: string | null
  provider?: string | null
  campaign?: string | null
  openCount?: number | null
  openedAt?: string | null
  sentAt?: string | null
  createdAt: string
}

const LOOK_LABELS: Record<string, string> = {
  boardroom: 'Boardroom look',
  goldrush: 'Gold Rush look',
  nightshift: 'Nightshift look',
}

function statusStyle(s: string): string {
  return s === 'SENT' ? 'border-emerald-500/40 text-emerald-500'
    : s === 'FAILED' || s === 'BOUNCED' ? 'border-rose-500/40 text-rose-500'
    : 'border-yellow-500/40 text-yellow-500'
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function EmailPreviewDialog({ row, onOpenChange, extraDescription }: { row: EmailPreviewRow | null; onOpenChange: (open: boolean) => void; /** Surface-specific context that rides under the subject (e.g. the exec archive's sender line). */ extraDescription?: ReactNode }) {
  // Campaign rows with no look on record rode the engine default (goldrush);
  // everything else replays the look it actually carries, 'plain' stays text.
  const look = row?.campaign ? (row.theme || 'goldrush') : (row?.theme || '')
  const branded = !!look && look !== 'plain'
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Branded sends start as-sent; one tap flips to the plain words.
  const [mode, setMode] = useState<'sent' | 'text'>('sent')

  useEffect(() => {
    setHtml(null)
    setMode('sent')
    if (!row || !branded) return
    let dead = false
    setLoading(true)
    api<{ html: string | null }>('/api/emails/preview', {
      method: 'POST',
      body: JSON.stringify({
        body: row.body,
        theme: look,
        provider: row.provider || null,
        campaign: row.campaign || null,
        rowId: row.campaign ? row.id : null,
      }),
    })
      .then((r) => { if (!dead) setHtml(r.html || null) })
      .catch(() => { if (!dead) setHtml(null) })
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id])

  if (!row) return null
  const opened = row.openedAt
    ? `${row.openCount && row.openCount > 1 ? `Opened ${row.openCount} times` : 'Opened'} · ${fmt(row.openedAt)}`
    : null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto hp-scroll">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug flex items-start gap-2">
            <Mail className="h-4 w-4 mt-0.5 text-brand shrink-0" />
            <span>{row.subject || '(no subject)'}</span>
          </DialogTitle>
          <DialogDescription>
            to {row.toEmail} · {fmt(row.sentAt || row.createdAt)}
            {row.campaign ? ` · ${row.campaign}` : ''}
            {extraDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] ${statusStyle(row.status)}`}>{row.status}</Badge>
          {branded && <Badge variant="outline" className="text-[10px] border-brand/40 text-brand">{LOOK_LABELS[look] || look}</Badge>}
          {opened && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">{opened}</Badge>}
          {branded && html && (
            <button
              onClick={() => setMode(mode === 'sent' ? 'text' : 'sent')}
              className="ml-auto text-[11px] font-medium text-muted-foreground hover:text-brand transition flex items-center gap-1"
              aria-label={mode === 'sent' ? 'Show the plain text words' : 'Show the email as it was sent'}
            >
              {mode === 'sent' ? <><Type className="h-3 w-3" /> Plain words</> : <><Eye className="h-3 w-3" /> As sent</>}
            </button>
          )}
        </div>

        {row.status === 'FAILED' && row.error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{row.error}</div>
        )}

        {loading ? (
          <div className="space-y-2 rounded-lg border bg-card p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : branded && html && mode === 'sent' ? (
          <iframe
            title="Email as it was sent"
            sandbox=""
            srcDoc={html}
            className="w-full rounded-lg border bg-white"
            style={{ height: 480 }}
          />
        ) : (
          <div className="rounded-lg border bg-card px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed break-words">{row.body || '(empty body)'}</div>
        )}

        <p className="text-[10px] text-muted-foreground">
          {branded && html
            ? 'Replayed from the sent words and the look on record — what landed in their inbox.'
            : 'This send went out as plain text — the words above are exactly what they read.'}
        </p>
      </DialogContent>
    </Dialog>
  )
}
