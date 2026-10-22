'use client'

import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import Landing from '@/components/hp/Landing'
import AppShell from '@/components/hp/AppShell'
import { useHp, type ViewKey } from '@/components/hp/store'

const VALID_VIEWS: ViewKey[] = [
  'dashboard', 'leads', 'clients', 'tasks', 'inventory', 'finance', 'ai', 'mail', 'calendar',
  'invoices', 'reports', 'integrations', 'store', 'resources', 'services',
  'wallet', 'grow', 'profile', 'admin',
]

export default function Home() {
  const { session, sessionLoading, loadSession } = useHp()

  useEffect(() => {
    // PWA / shortcut deep-links: /?view=leads opens that module directly
    // (start_url is "/", /dashboard etc. do not exist in this single-page app).
    const params = new URLSearchParams(window.location.search)
    const target = params.get('view') as ViewKey | null
    if (target && VALID_VIEWS.includes(target)) useHp.getState().setView(target)
    loadSession()
  }, [])

  // SEO / AI discoverability: the Landing markup is always rendered (server
  // render included), so crawlers that never run JavaScript, Google first
  // pass, GPTBot, ClaudeBot, PerplexityBot, social preview bots, see the
  // full marketing content instead of an empty splash. While the session
  // check runs, the branded splash overlays it, so signed in members keep
  // the exact load experience they had before.
  return (
    <>
      {session ? <AppShell /> : <Landing />}
      {sessionLoading && (
        <div className="fixed inset-0 z-[90] hp-gradient-bg flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="font-display text-3xl">
              HUSTLE<span className="text-brand">PORTAL</span>
              <span className="text-[10px] align-super">™</span>
            </div>
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-brand" />
          </div>
        </div>
      )}
    </>
  )
}
