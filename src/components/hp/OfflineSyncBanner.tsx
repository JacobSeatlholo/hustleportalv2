'use client'

/**
 * The offline strip: tells the truth in one line — you're offline, the app
 * keeps working, notes save on this device and sync automatically on reconnect.
 * Mounts once in AppShell (member area); listens to the outbox module's count
 * events so the queued number is always the real one.
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { pendingOfflineCount, flushOfflineOutbox, OUTBOX_EVENT } from '@/lib/offlineOutbox'

export default function OfflineSyncBanner() {
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    setOnline(navigator.onLine)
    setPending(pendingOfflineCount())
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    const onOutbox = (e: Event) => {
      const detail = (e as CustomEvent<{ pending?: number }>).detail
      setPending(typeof detail?.pending === 'number' ? detail.pending : pendingOfflineCount())
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    window.addEventListener(OUTBOX_EVENT, onOutbox)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener(OUTBOX_EVENT, onOutbox)
    }
  }, [])

  if (online && pending === 0) return null

  const sync = async () => {
    setSyncing(true)
    try {
      await flushOfflineOutbox()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="fixed top-0 inset-x-0 z-[60] px-3 py-1.5 text-xs text-amber-950 bg-amber-300/95 backdrop-blur flex items-center justify-center gap-2 print:hidden">
      {online ? (
        <>
          <span>
            {pending === 0
              ? 'Back online — everything synced.'
              : `Back online — ${pending} offline note${pending === 1 ? '' : 's'} syncing…`}
          </span>
          {pending > 0 && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={sync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </>
      ) : (
        <span>
          Offline — the app still works. Notes save on this device{pending > 0 ? ` (${pending} queued)` : ''} and sync automatically when you reconnect.
        </span>
      )}
    </div>
  )
}
