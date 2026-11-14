/**
 * Offline outbox — the write path when the network is gone.
 *
 * v1 scope: client notes. A note saved offline lands in localStorage with an
 * idempotency key and replays automatically on reconnect (online event, tab
 * visible again, app open). The server dedupes on that key, so a retry that
 * fires after a lost response can never duplicate a note.
 * The read path (recently visited pages / API GETs) is the service worker's
 * job (sw.js v3); the two never overlap — the worker never touches POSTs.
 */

const KEY = 'hp_offline_outbox_v1'
export const OUTBOX_EVENT = 'hp:outbox'

type OutboxEntry = {
  id: string // uuid — travels as the Idempotency-Key header
  url: string
  payload: string // JSON body, saved verbatim
  createdAt: number
  tries: number
}

function read(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as OutboxEntry[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list: OutboxEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage full or private mode — the banner still reflects the count */
  }
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { pending: list.length } }))
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `hp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Queue a note for later replay. Called from UI save paths when offline. */
export function queueOfflineNote(clientId: string, body: string): void {
  const list = read()
  list.push({
    id: uuid(),
    url: `/api/clients/${clientId}/timeline`,
    payload: JSON.stringify({ body }),
    createdAt: Date.now(),
    tries: 0,
  })
  write(list)
}

export function pendingOfflineCount(): number {
  return read().length
}

/**
 * Replay every queued write. Stops at the first non-2xx (a dead session after
 * a long offline stretch, a server error) so we never hammer: the note stays
 * queued and the next trigger retries from the same row.
 */
export async function flushOfflineOutbox(): Promise<number> {
  const list = read()
  let synced = 0
  for (const entry of list) {
    try {
      const res = await fetch(entry.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': entry.id },
        body: entry.payload,
      })
      if (res.ok) {
        synced++
        write(read().filter((e) => e.id !== entry.id))
        continue
      }
      break
    } catch {
      break // still offline, or the server is unreachable
    }
  }
  return synced
}

// Auto-replay triggers: back online, tab visible again, app (re)opened.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flushOfflineOutbox()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) void flushOfflineOutbox()
  })
  window.addEventListener('load', () => {
    if (navigator.onLine) void flushOfflineOutbox()
  })
}
