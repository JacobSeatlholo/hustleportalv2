'use client'
/**
 * Due-time reminders, the moment a task hits its due time while the app is
 * open, a local notification fires (service worker when available, plain
 * Notification otherwise). Server push covers the morning summary; this covers
 * the exact minute, zero extra infrastructure.
 * Silent no-op when notification permission was never granted.
 */
import { useEffect } from 'react'
import { api, type Task } from './shared'

export default function TaskReminders() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    let tasks: Task[] = []
    const fired = new Set<string>()
    let alive = true

    async function load() {
      try {
        const r = await api<{ tasks: Task[] }>('/api/tasks?scope=mine')
        if (alive) tasks = r.tasks
      } catch { /* offline or logged out, try again on the next poll */ }
    }

    async function tick() {
      if (Notification.permission !== 'granted') return
      const now = Date.now()
      for (const t of tasks) {
        if (!t.dueDate || t.status === 'DONE' || fired.has(t.id)) continue
        const due = new Date(t.dueDate).getTime()
        const lateBy = now - due
        if (lateBy >= 0 && lateBy < 90_000) {
          fired.add(t.id)
          try {
            const reg = await navigator.serviceWorker?.getRegistration()
            const options: NotificationOptions = {
              body: 'It is time. Open HustlePortal and get it done.',
              tag: `task-due-${t.id}`,
              icon: '/icon-192.png',
            }
            if (reg) await reg.showNotification(t.title, options)
            else new Notification(t.title, options)
          } catch { /* a courtesy, never a blocker */ }
        }
      }
    }

    load()
    const poll = setInterval(load, 5 * 60_000)
    const timer = setInterval(tick, 30_000)
    return () => { alive = false; clearInterval(poll); clearInterval(timer) }
  }, [])

  return null
}
