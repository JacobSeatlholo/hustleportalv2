'use client'

/**
 * PwaNotifications — opt-in web push for the installed app.
 * States: unsupported → default (can ask) → granted (subscribed / enable / test) → denied.
 * The VAPID public key comes from the server (stored in PlatformConfig, zero env setup).
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'
import { Bell, BellRing, Loader2, Send } from 'lucide-react'

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

  return { supported, permission, subscribed }
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
  } catch {
    return 'error'
  }
}

export async function sendTestPush(): Promise<boolean> {
  try {
    await api('/api/push', { method: 'POST', body: JSON.stringify({ action: 'test' }) })
    return true
  } catch {
    return false
  }
}

export default function PwaNotifications({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast()
  const { supported, permission, subscribed } = usePushState()
  const [busy, setBusy] = useState(false)

  if (!supported || permission === 'denied') {
    return compact ? null : (
      <p className="text-xs text-muted-foreground">
        {permission === 'denied'
          ? 'Notifications are blocked in your browser settings — unblock them for hustleportal.online to get reminders.'
          : 'This browser does not support push notifications.'}
      </p>
    )
  }

  async function onEnable() {
    setBusy(true)
    try {
      const r = await enablePush()
      if (r === 'granted') {
        toast({ title: 'Notifications on', description: 'Check your device — a welcome push just arrived.' })
        setTimeout(() => window.location.reload(), 800) // pick up subscribed state
      } else if (r === 'denied') {
        toast({ title: 'Permission declined', description: 'You can turn notifications on later from your browser settings.', variant: 'destructive' })
      } else {
        toast({ title: 'Could not enable notifications', description: 'Open the installed app and try again.', variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function onTest() {
    setBusy(true)
    try {
      const ok = await sendTestPush()
      toast(
        ok
          ? { title: 'Test sent', description: 'Look at your device — it should appear in a second or two.' }
          : { title: 'Test failed', description: 'Turn notifications on first, then send a test.', variant: 'destructive' }
      )
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
  )
}
