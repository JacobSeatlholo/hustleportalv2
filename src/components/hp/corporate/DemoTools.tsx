'use client'

// ============ DASHBOARD DEMO TOOLS (owner, Task 221 round 4) ============
// Seed and reset for the Kelo walkthrough: dummy floor accounts, referrals
// attributed to the boss's test account, reveal and top-up figures behind
// every KPI. This component renders ONLY when the dashboard URL carries
// &demo=1 — the URL Kelo receives never has it, so he sees a fully
// populated dashboard and the boss holds the reset. The key gates the
// endpoint; the slug is derived server-side, never sent by the client.

import { useState } from 'react'
import { FlaskConical, Loader2 } from 'lucide-react'

export default function DemoTools({ slug, dashKey }: { slug: string; dashKey: string }) {
  const [busy, setBusy] = useState<'seed' | 'reset' | null>(null)
  const [line, setLine] = useState('')
  const [err, setErr] = useState(false)

  async function call(action: 'seed' | 'reset') {
    setBusy(action)
    setLine('')
    setErr(false)
    try {
      const res = await fetch('/api/corporate/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: dashKey, action }),
      })
      const j = (await res.json().catch(() => null)) as {
        ok?: boolean; already?: boolean; seeded?: number; removed?: number; reveals?: number
        referrerBonusCents?: number; restoredCents?: number; referrer?: { name: string; email: string }; error?: string
      } | null
      if (res.ok && j?.ok) {
        setErr(false)
        setLine(
          action === 'seed'
            ? `Demo loaded: ${j.seeded} floor accounts, ${j.reveals} managed reveals, R${Math.round((j.referrerBonusCents || 0) / 100)} attributed to ${j.referrer?.name} (${j.referrer?.email}). Refresh to see the dashboard read them.`
            : `Demo cleared: ${j.removed} accounts removed, R${Math.round((j.restoredCents || 0) / 100)} restored off the referrer's wallet. Refresh for the clean view.`
        )
      } else {
        setErr(true)
        setLine(j?.error || 'Something went wrong. Try again.')
      }
    } catch {
      setErr(true)
      setLine('Network hiccup. Try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-2xl border border-dashed border-sky-500/50 bg-sky-500/5 p-4 space-y-2">
      <p className="flex items-center gap-2 text-sm font-semibold text-sky-700 dark:text-sky-400">
        <FlaskConical className="h-4 w-4" /> Demo tools for the walkthrough — only visible with &amp;demo=1 in the address bar
      </p>
      <p className="text-xs text-muted-foreground">
        Load dummy floor accounts, introductions and earnings on {slug}&apos;s dashboard, walk Kelo through the live view, then
        reset everything to zero. The dashboard your partner sees carries none of these buttons.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => call('seed')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
        >
          {busy === 'seed' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Load demo data
        </button>
        <button
          onClick={() => call('reset')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/50 px-4 py-2 text-sm font-semibold text-sky-700 dark:text-sky-400 transition hover:bg-sky-500/10 disabled:opacity-50"
        >
          {busy === 'reset' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Reset everything to zero
        </button>
      </div>
      {line && <p className={`text-xs ${err ? 'text-rose-600' : 'text-sky-700 dark:text-sky-400'}`}>{line}</p>}
    </div>
  )
}
