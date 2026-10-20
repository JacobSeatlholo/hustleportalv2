'use client'

/**
 * PwaNotifications — opt-in web push for the installed app.
 * States: unsupported → default (can ask) → granted (subscribed / enable / test) → denied.
 * The VAPID public key comes from the server (stored in PlatformConfig, zero env setup).
 *
 * Task 92 debugging notes baked in:
 *  - iPhone Safari only allows web push inside the installed Home Screen app
 *    (iOS 16.4+). In the regular browser tab we now SAY that instead of a
 *    generic failure, so the user knows the one step that unlocks it.
 *  - Task 96 fix: in the Safari tab Apple never exposes the Notification API
 *    at all, so supported goes false and the old early return showed the dead
 *    end message and never reached the amber guidance card. iPhone tabs now
 *    get the Add to Home Screen steps in both the menu and the profile screen.
 *  - The test action returns the honest per-device truth (stored / sent /
 *    pruned / refused) and the toast repeats exactly that — the old version
 *    answered the same "turn notifications on first" for every failure.
 *  - A push that arrives while the app is open and visible is relayed by the
 *    service worker as a message; PushInAppRelay (mount once in AppShell)
 *    shows it as a toast, because Android Chrome drops OS notifications in
 *    the foreground and the user otherwise never sees a live push.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'
import { Bell, BellRing, Loader2, Send, Smartphone } from 'lucide-react'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export function usePushState() {
  const [supported, setSupported] = useState(true)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [subscribed, setSubscribed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in window) || !('PushManager' in window)) {
      setSupported(false)
      setPermission('unsupported')
      return
    }
    setPermission(Notification.permission)
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {})
  }, [])

  const refresh = useCallback(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    setPermission(Notification.permission)
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {})
  }, [])

  return { supported, permission, subscribed, refresh }
}

/** iPhone or iPad Safari running as a normal browser tab (not the installed app). */
function isIOSBrowserTab(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && ((navigator as { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 1)
  const standalone = (navigator as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches
  return ios && !standalone
}

export async function enablePush(): Promise<'granted' | 'denied' | 'error'> {
  if (!('Notification' in window) || !('serviceWorker' in window) || !('PushManager' in window)) return 'error'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    const { publicKey } = await api<{ publicKey: string }>('/api/push')
    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      }))
    await api('/api/push', {
      method: 'POST',
      body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON() }),
    })
    return 'granted'
  } catch (e) {
    // keep the reason in the console — the toast stays human
    console.error('[push] enable failed', e)
    return 'error'
  }
}

export interface TestPushResult {
  ok: boolean
  sent?: number
  subscriptions?: number
  pruned?: number
  error?: string
}

export async function sendTestPush(): Promise<TestPushResult> {
  try {
    return await api<TestPushResult>('/api/push', {
      method: 'POST',
      body: JSON.stringify({ action: 'test' }),
    })
  } catch (e) {
    const err = e as { data?: { error?: string; subscriptions?: number; pruned?: number } }
    // the api helper throws with .data on non 200 — the diagnostics ride along
    return { ok: false, error: err?.data?.error || 'The test could not be sent.', subscriptions: err?.data?.subscriptions, pruned: err?.data?.pruned }
  }
}

/** Mount ONCE in the app shell — shows in app toasts for pushes that arrive
 *  while the app is open (the service worker relays those as messages). */
export function PushInAppRelay() {
  const { toast } = useToast()
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const d = event.data as { type?: string; payload?: { title?: string; body?: string; url?: string } } | null
      if (d?.type !== 'hp:push' || !d.payload) return
      toast({
        title: d.payload.title || 'HustlePortal',
        description: d.payload.body || 'Open HustlePortal for the latest.',
      })
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [toast])
  return null
}

export default function PwaNotifications({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast()
  const { supported, permission, subscribed, refresh } = usePushState()
  const [busy, setBusy] = useState(false)
  const iosTab = isIOSBrowserTab() && !subscribed

  if (!supported || permission === 'denied') {
    if (permission === 'denied') {
      return compact ? null : (
        <p className="text-xs text-muted-foreground">
          Notifications are blocked in your browser settings — unblock them for hustleportal.online to get reminders.
        </p>
      )
    }
    if (iosTab) {
      return compact ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <Smartphone className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Add HustlePortal to your Home Screen first. Tap Share, Add to Home Screen, open from the icon, then turn notifications on there.</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <Smartphone className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="space-y-1">
            <span className="block font-medium">On iPhone, notifications live in the installed app, not in this Safari tab.</span>
            <span className="block">1. Tap the Share button at the bottom of Safari.</span>
            <span className="block">2. Choose Add to Home Screen.</span>
            <span className="block">3. Open HustlePortal from the new icon.</span>
            <span className="block">4. Open the menu, tap Get notifications, then Allow.</span>
            <span className="block">iOS 16.4 or newer is required. If the option fails, update iOS in Settings and try again.</span>
          </span>
        </div>
      )
    }
    return compact ? null : (
      <p className="text-xs text-muted-foreground">This browser does not support push notifications.</p>
    )
  }

  async function onEnable() {
    setBusy(true)
    try {
      const r = await enablePush()
      if (r === 'granted') {
        // The welcome push arrives while this app is open — the in app relay
        // shows it, so no reload is needed to prove the pipe works.
        refresh()
        toast({ title: 'Notifications on', description: 'Your device is subscribed. Reminders now reach you even when the app is closed.' })
      } else if (r === 'denied') {
        toast({ title: 'Permission declined', description: 'You can turn notifications on later from your browser settings.', variant: 'destructive' })
      } else {
        toast({
          title: 'Could not enable notifications',
          description: iosTab
            ? 'On iPhone, notifications need the installed app — add HustlePortal to your Home Screen, open it from the icon, then try here again.'
            : 'Open the installed app and try again.',
          variant: 'destructive',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  async function onTest() {
    setBusy(true)
    try {
      const r = await sendTestPush()
      if (r.ok) {
        toast({ title: 'Test sent', description: `Delivered to ${r.sent} device${r.sent === 1 ? '' : 's'}. Look at your phone — it should be there within seconds.` })
      } else {
        toast({ title: 'Test did not go through', description: r.error || 'Turn notifications on first, then send a test.', variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  if (compact) {
    if (subscribed) return null
    return (
      <button
        onClick={onEnable}
        disabled={busy}
        className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} Get notifications
      </button>
    )
  }

  return (
    <div className="space-y-2">
      {iosTab && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <Smartphone className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            On iPhone, push notifications only work inside the installed app. Tap the share button on this page and choose Add to Home Screen, then open
            HustlePortal from the icon and turn notifications on there.
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {subscribed ? (
          <>
            <span className="text-sm text-emerald-600 flex items-center gap-1.5"><BellRing className="h-4 w-4" /> Notifications are on for this device</span>
            <Button variant="outline" size="sm" onClick={onTest} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Send test
            </Button>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">Get reminders on this device — tasks due, pipeline nudges.</span>
            <Button size="sm" onClick={onEnable} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4 mr-1" />} Turn on
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
