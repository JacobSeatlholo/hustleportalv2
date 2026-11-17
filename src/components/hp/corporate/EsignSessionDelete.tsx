'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2 } from 'lucide-react'

// Removes a signing session from the deal room (same gate key as the room):
// QA rows, mistaken sends, tests. The signed copy is stored inside the
// session row, so removing the session removes its stored copy with it —
// the room keeps saying the truth about which documents are executed.
export default function EsignSessionDelete({ slug, gateKey, token, name }: { slug: string; gateKey: string; token: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!window.confirm(`Remove the signing session "${name}"? The stored signed copy goes with it.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/corporate/${slug}/esign?key=${encodeURIComponent(gateKey)}&token=${encodeURIComponent(token)}`, { method: 'DELETE' })
      if (res.ok) {
        setGone(true)
        router.refresh()
      } else {
        setError(`Could not remove (${res.status}).`)
      }
    } catch {
      setError('Could not remove the session.')
    } finally {
      setBusy(false)
    }
  }

  if (gone) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={remove}
        disabled={busy}
        aria-label={`Remove signing session ${name}`}
        title="Remove this session"
        className="inline-flex items-center justify-center rounded-lg border border-border p-1.5 text-muted-foreground transition hover:border-red-300 hover:text-red-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  )
}
