'use client'

import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import Landing from '@/components/hp/Landing'
import AppShell from '@/components/hp/AppShell'
import { useHp, type ViewKey } from '@/components/hp/store'

const VALID_VIEWS: ViewKey[] = [
  'dashboard', 'leads', 'clients', 'tasks', 'finance', 'ai', 'mail', 'calendar',
  'invoices', 'reports', 'integrations', 'store', 'resources', 'services',
  'wallet', 'grow', 'profile', 'admin',
]

export default function Home() {
  const { session, sessionLoading, loadSession } = useHp()

  useEffect(() => {
    // PWA / shortcut deep-links: /?view=leads opens that module directly
    // (start_url is "/" — /dashboard etc. do not exist in this single-page app).
    const params = new URLSearchParams(window.location.search)
    const target = params.get('view') as ViewKey | null
    if (target && VALID_VIEWS.includes(target)) useHp.getState().setView(target)
    loadSession()
  }, [])

  if (sessionLoading) {
    return (
      <div className="min-h-screen hp-gradient-bg flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="font-display text-3xl">
            HUSTLE<span className="text-brand">PORTAL</span>
            <span className="text-[10px] align-super">™</span>
          </div>
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-brand" />
        </div>
      </div>
    )
  }

  return session ? <AppShell /> : <Landing />
}
