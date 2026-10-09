'use client'

import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import Landing from '@/components/hp/Landing'
import AppShell from '@/components/hp/AppShell'
import { useHp } from '@/components/hp/store'

export default function Home() {
  const { session, sessionLoading, loadSession } = useHp()

  useEffect(() => {
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
