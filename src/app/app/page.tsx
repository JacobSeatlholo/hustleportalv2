'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import AppShell from '@/components/hp/AppShell'
import Landing from '@/components/hp/Landing'
import { useHp, type ViewKey } from '@/components/hp/store'

// ============ /app — the workspace, reachable on EVERY host (Task 219) ============
// The strategist's own domain (app.trinitydirect.co.za) serves the marketing
// door at '/', so the product needed a fixed path of its own. This route is
// that path: the same single-page app, at /app on the main domain AND on
// partner domains. Two flows depend on it:
//  - the door's signup form lands here the moment the account opens
//    (redirecting to '/' bounced partners straight back to their door);
//  - the door's "Sign in" link points here, so his clients log in without
//    ever leaving his domain.
// The boot splash is brand-neutral on purpose: on a strategist's domain no
// engine name flashes while the session check runs.

const VALID_VIEWS: ViewKey[] = [
  'dashboard', 'leads', 'clients', 'tasks', 'inventory', 'finance', 'ai', 'mail', 'calendar',
  'invoices', 'reports', 'integrations', 'store', 'resources', 'services',
  'wallet', 'grow', 'profile', 'admin',
]

export default function AppEntry() {
  const { session, sessionLoading, loadSession } = useHp()

  useEffect(() => {
    // Same deep-link law as /: /app?view=leads opens that module directly.
    const params = new URLSearchParams(window.location.search)
    const target = params.get('view') as ViewKey | null
    if (target && VALID_VIEWS.includes(target)) useHp.getState().setView(target)
    loadSession()
  }, [])

  return (
    <>
      {session ? <AppShell /> : <Landing />}
      {sessionLoading && (
        <div className="fixed inset-0 z-[90] hp-gradient-bg flex items-center justify-center">
          <div className="text-center space-y-3">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-brand" />
            <p className="text-sm text-muted-foreground">Opening your workspace…</p>
          </div>
        </div>
      )}
    </>
  )
}
