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
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
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
