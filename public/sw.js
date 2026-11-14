/* HustlePortal service worker — push notifications + notification click routing.
 *
 * v2 (task 92, push debugging):
 *  - Foreground relay: Android Chrome and the iPhone home screen app refuse to
 *    DISPLAY an OS notification while the app is open and visible. The old
 *    worker always called showNotification, so every welcome and test push
 *    fired invisibly while the user stared at the open app. Now the worker
 *    checks for a visible app window first and hands the payload to it as a
 *    message (the app shows an in app banner); a real OS notification only
 *    fires when the app is background or closed, where it actually shows.
 *  - pushsubscriptionchange: iOS rotates web push endpoints periodically.
 *    Without this handler the device silently died at rotation time. The
 *    worker now re-subscribes with the server key and re-stores itself.
 */
 * v3 (offline mode): same-origin GET caching so the app opens and recent
 * screens read offline. Writes never touch the worker — the client outbox
 * (src/lib/offlineOutbox.ts) owns them and replays with an Idempotency-Key.
 */
const STATIC_CACHE = 'hp-static-v3'
const PAGE_CACHE = 'hp-pages-v3'
const API_CACHE = 'hp-api-v3'
const OFFLINE_URL = '/offline'
const NEVER_CACHE_API = ['/api/auth', '/api/push', '/api/cron', '/api/webhooks', '/api/admin']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll([OFFLINE_URL, '/icon-192.png', '/manifest.webmanifest']))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Runtime caches start fresh with every worker version: a deploy can move
      // chunks, and serving last week's payloads offline breaks pages.
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== STATIC_CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })()
  )
})

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'HustlePortal', body: event.data ? event.data.text() : '' }
  }
  const payload = {
    title: data.title || 'HustlePortal',
    body: data.body || '',
    url: data.url || '/',
    tag: data.tag || null,
  }
  event.waitUntil(
    (async () => {
      // Visible app open right now? Deliver in app instead. An OS notification
      // fired while the app is foreground never shows on Android Chrome, so
      // this relay is the only way the user ever sees a push during a test.
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const visible = clientList.find((c) => c.visibilityState === 'visible')
      if (visible) {
        visible.postMessage({ type: 'hp:push', payload })
        return
      }
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: payload.tag || undefined,
        renotify: Boolean(payload.tag),
        data: { url: payload.url },
        vibrate: [80, 40, 80],
      })
    })()
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Same-origin fetch from the worker carries the session cookie, so the
        // key fetch and the re-store only work for a signed in member — the
        // right scope. Best effort: if anything fails, the next manual enable
        // from the profile screen still fixes the device.
        const keyRes = await fetch('/api/push')
        if (!keyRes.ok) return
        const { publicKey } = await keyRes.json()
        if (!publicKey) return
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(publicKey),
        })
        await fetch('/api/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'subscribe',
            subscription: sub.toJSON(),
            previousEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : undefined,
          }),
        })
      } catch (e) {
        /* best effort — never throw out of the worker */
      }
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})

/* v3 (offline mode): fetch handling — reads work offline, writes pass through. */
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  // Immutable build output + brand assets: cache-first (their urls change
  // when content changes).
  if (
    url.pathname.startsWith('/_next/static') ||
    url.pathname.startsWith('/icon') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.startsWith('/brand/')
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      })
    )
    return
  }

  // API GETs: network-first; successful JSON (never a Set-Cookie response)
  // lands in the cache so timelines and dashboards re-open offline.
  if (url.pathname.startsWith('/api/')) {
    if (NEVER_CACHE_API.some((p) => url.pathname.startsWith(p))) return
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          if (res.ok && !res.headers.get('set-cookie') && (res.headers.get('content-type') || '').includes('json')) {
            const cache = await caches.open(API_CACHE)
            cache.put(req, res.clone())
          }
          return res
        } catch (e) {
          const hit = await caches.match(req)
          if (hit) return hit
          return Response.json({ error: 'Offline and not cached yet.' }, { status: 503 })
        }
      })()
    )
    return
  }

  // Page navigations: network-first, then the cached copy of this exact page,
  // then the offline shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          if (res.ok) {
            const cache = await caches.open(PAGE_CACHE)
            cache.put(req, res.clone())
          }
          return res
        } catch (e) {
          const hit = await caches.match(req)
          return hit || (await caches.match(OFFLINE_URL)) || Response.error()
        }
      })()
    )
  }
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
