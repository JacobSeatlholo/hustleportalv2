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
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-3 text-xs text-muted-foreground">
          {/* Task 213: the trust footer, exactly as the owner specified. */}
          <p className="text-[11px] font-semibold tracking-wide text-foreground">
            BUSINESS HUSTLE · SIMPLE ETERNITY HOLDINGS (PTY) LTD
          </p>
          <p className="text-[11px]">
            HustlePortal™, 99 Kloof St, Gardens, Cape Town.
          </p>
          <p className="text-[11px]">We feed your pipeline. You run your business.</p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/legal/terms" className="text-brand underline underline-offset-2">Terms of Service</Link>
            <Link href="/legal/privacy" className="text-brand underline underline-offset-2">Privacy &amp; POPIA</Link>
            <Link href="/remove-listing" className="text-brand underline underline-offset-2">Remove my business</Link>
          </p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href="https://www.businesshustle.co.za" className="text-brand underline underline-offset-2">www.businesshustle.co.za</a>
            <span>@hustlebusiness</span>
            <span>@businesshustleworldwide</span>
          </p>
        </div>
      </footer>
    </div>
  )
}
