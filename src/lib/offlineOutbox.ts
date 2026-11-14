/**
 * Offline outbox — the write path when the network is gone.
 *
 * v2 scope: any create/save the member makes offline. An entry lands in
 * localStorage with an idempotency key and replays automatically on reconnect
 * (online event, tab visible again, app open). Notes are deduped server-side
 * on that key, so a retry that fires after a lost response can never duplicate
 * a note; creates and patches elsewhere queue ONLY on a hard network failure
 * (the request provably never left the device — see isOfflineFailure), never
 * on a server rejection, so a replayed write is always a write the server has
 * not seen yet.
 * The read path (recently visited pages / API GETs) is the service worker's
 * job (sw.js v3); the two never overlap — the worker never touches POSTs.
 */

const KEY = 'hp_offline_outbox_v1'
export const OUTBOX_EVENT = 'hp:outbox'

type OutboxEntry = {
  id: string // uuid — travels as the Idempotency-Key header
  url: string
  payload: string // JSON body, saved verbatim
  method?: 'POST' | 'PATCH' | 'PUT'
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

/** Queue ANY write for later replay. Called from UI save paths when offline. */
export function queueOfflineWrite(url: string, body: unknown, method: 'POST' | 'PATCH' | 'PUT' = 'POST'): void {
  const list = read()
  list.push({
    id: uuid(),
    url,
    payload: JSON.stringify(body),
    method,
    createdAt: Date.now(),
    tries: 0,
  })
  write(list)
}

/** A client timeline note, the offline flow that started the outbox (v1). */
export function queueOfflineNote(clientId: string, body: string): void {
  queueOfflineWrite(`/api/clients/${clientId}/timeline`, { body })
}

/**
 * TRUE only when the failure proves the request never reached the server:
 * the device is offline, or fetch itself threw (DNS, timeout, connection
 * reset, request interception). A server rejection (4xx/5xx) is a real
 * answer with a real message and must never queue — the user sees the
 * error and can act on it.
 */
export function isOfflineFailure(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (e instanceof TypeError) return true // fetch: Failed to fetch / Load failed
  return e instanceof Error && /failed to fetch|networkerror|load failed|fetch failed/i.test(e.message)
}

export function pendingOfflineCount(): number {
  return read().length
}

/**
 * Replay every queued write. Stops at the first non-2xx (a dead session after
 * a long offline stretch, a server error) so we never hammer: the entry stays
 * queued and the next trigger retries from the same row.
 */
export async function flushOfflineOutbox(): Promise<number> {
  const list = read()
  let synced = 0
  for (const entry of list) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method || 'POST',
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
