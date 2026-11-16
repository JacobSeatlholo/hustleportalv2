'use client'

// Task 208: the corporate pages' shell. Wraps /corporate and /corporate/<slug>
// with the light or dark look. Light is the DEFAULT: white field, warm black
// ink, gold accents — the B2B trust read (colour psychology: white = clean and
// honest, black = authority, gold = premium). Dark keeps the gold-rush ink for
// nights and screens the boss prefers. The choice rides localStorage; no
// flash: the class is applied on first render inside the client shell, and
// the shell wraps everything the page paints.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Moon, Sun } from 'lucide-react'

const KEY = 'corporate-theme'

export default function CorporateShell({ children }: { children: React.ReactNode }) {
  const [light, setLight] = useState(true)

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY)
    if (saved === 'dark') setLight(false)
  }, [])

  function toggle() {
    setLight((v) => {
      const next = !v
      try {
        window.localStorage.setItem(KEY, next ? 'light' : 'dark')
      } catch {
        /* private mode: the toggle still works for the session */
      }
      return next
    })
  }

  return (
    <div className={(light ? 'corporate-light ' : '') + 'min-h-screen bg-background text-foreground transition-colors'}>
      <button
        onClick={toggle}
        aria-label={light ? 'Switch to dark look' : 'Switch to light look'}
        className="fixed top-4 right-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-accent"
      >
        {light ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4 text-brand" />}
      </button>
      {children}
      <footer className="border-t border-border bg-card">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-2 text-xs text-muted-foreground">
          <p>
            HustlePortal Corporate · Business Hustle, 99 Kloof St, Gardens, Cape Town.
          </p>
          <p>
            Owner operator or small team? The main{' '}
            <Link href="/" className="text-brand underline underline-offset-2">HustlePortal</Link>{' '}
            experience starts you with R99 in free lead credits and every tool included.
          </p>
        </div>
      </footer>
    </div>
  )
}
