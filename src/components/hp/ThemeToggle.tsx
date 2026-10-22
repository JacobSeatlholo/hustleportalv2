'use client'

import { useSyncExternalStore } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export type HpTheme = 'console' | 'calm'

const KEY = 'hp_theme'

const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function emit() {
  listeners.forEach((l) => l())
}

function getSnapshot(): HpTheme {
  try {
    return localStorage.getItem(KEY) === 'calm' ? 'calm' : 'console'
  } catch {
    return 'console'
  }
}

function getServerSnapshot(): HpTheme {
  return 'console'
}

function applyTheme(t: HpTheme) {
  try {
    document.documentElement.classList.toggle('calm', t === 'calm')
    localStorage.setItem(KEY, t)
  } catch { /* private mode, theme stays for the session only */ }
}

/** Read the current theme reactively (used by surfaces that render their own toggle). */
export function useHpTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const set = (t: HpTheme) => {
    applyTheme(t)
    emit()
  }
  const toggle = () => set(getSnapshot() === 'calm' ? 'console' : 'calm')
  return { theme, set, toggle }
}

/**
 * ThemeToggle, Console vs Calm display.
 * One small switch, everywhere it matters: landing header, app sidebar,
 * profile settings. Calm drops the contrast: muted brass, softer surfaces.
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useHpTheme()
  const calm = theme === 'calm'

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={calm ? 'Switch to the standard display' : 'Switch to Calm display (lower contrast)'}
        aria-label={calm ? 'Switch to the standard display' : 'Switch to Calm display (lower contrast)'}
        className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-brand/60 transition"
      >
        {calm ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={calm}
      className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition"
      title={calm ? 'Standard display: full contrast' : 'Calm display: lower contrast, easier on the eyes'}
    >
      {calm ? <Eye className="h-3.5 w-3.5 text-brand" /> : <EyeOff className="h-3.5 w-3.5" />}
      <span>{calm ? 'Calm display on' : 'Calm display'}</span>
      <span
        className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full transition-colors ${calm ? 'bg-brand' : 'bg-border'}`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${calm ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  )
}
