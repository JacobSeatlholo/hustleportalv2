'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useHp, type ViewKey } from './store'
import { rands } from './shared'
import DashboardView from './DashboardView'
import LeadsView from './LeadsView'
import TasksView from './TasksView'
import WalletView from './WalletView'
import AiView from './AiView'
import FinanceView from './FinanceView'
import ProfileView from './ProfileView'
import AdminView from './AdminView'
import StoreView from './StoreView'
import ResourcesView from './ResourcesView'
import {
  LayoutDashboard, Target, ListTodo, Wallet, BrainCircuit, TrendingUp,
  UserCog, ShieldCheck, Menu, X, Sparkles, LogOut, ShoppingCart, BookOpen,
} from 'lucide-react'

const NAV: { key: ViewKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'leads', label: 'Leads & CRM', icon: <Target className="h-4 w-4" /> },
  { key: 'tasks', label: 'Tasks', icon: <ListTodo className="h-4 w-4" /> },
  { key: 'finance', label: 'Finance', icon: <TrendingUp className="h-4 w-4" /> },
  { key: 'ai', label: 'AI Co-Founder', icon: <BrainCircuit className="h-4 w-4" /> },
  { key: 'store', label: 'Store', icon: <ShoppingCart className="h-4 w-4" /> },
  { key: 'resources', label: 'Resources', icon: <BookOpen className="h-4 w-4" /> },
  { key: 'wallet', label: 'Wallet', icon: <Wallet className="h-4 w-4" /> },
  { key: 'profile', label: 'Profile & Team', icon: <UserCog className="h-4 w-4" /> },
]

export default function AppShell() {
  const { session, view, setView, logout, loadSession } = useHp()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // wallet navigation from anywhere
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail as ViewKey
      if (target) setView(target)
    }
    window.addEventListener('hp:navigate', handler)
    return () => window.removeEventListener('hp:navigate', handler)
     
  }, [])

  // silent background refresh to keep XP/wallet fresh (never flips boot loader)
  useEffect(() => {
    loadSession(true)
    const t = setInterval(() => loadSession(true), 60000)
    return () => clearInterval(t)
     
  }, [])

  if (!session) return null

  const doneChallenges = session.challenges.filter((c) => c.done).length

  const content = (() => {
    switch (view) {
      case 'dashboard': return <DashboardView />
      case 'leads': return <LeadsView />
      case 'tasks': return <TasksView />
      case 'finance': return <FinanceView />
      case 'ai': return <AiView />
      case 'store': return <StoreView />
      case 'resources': return <ResourcesView />
      case 'wallet': return <WalletView />
      case 'profile': return <ProfileView />
      case 'admin': return <AdminView />
      default: return <DashboardView />
    }
  })()

  return (
    <div className="min-h-screen hp-gradient-bg flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground fixed inset-y-0 z-40">
        <SidebarContent
          view={view}
          setView={setView}
          session={session}
          doneChallenges={doneChallenges}
          totalChallenges={session.challenges.length}
          logout={logout}
        />
      </aside>

      {/* Sidebar — mobile drawer */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-64 bg-sidebar text-sidebar-foreground flex flex-col">
            <button className="absolute top-3 right-3 text-white/60" onClick={() => setSidebarOpen(false)}>
              <X className="h-5 w-5" />
            </button>
            <SidebarContent
              view={view}
              setView={(v) => { setView(v); setSidebarOpen(false) }}
              session={session}
              doneChallenges={doneChallenges}
              totalChallenges={session.challenges.length}
              logout={async () => { setSidebarOpen(false); await logout() }}
            />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 md:ml-60 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="font-display text-lg md:hidden">
              HUSTLE<span className="text-brand">PORTAL</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setView('wallet')}
                className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:border-brand transition flex items-center gap-1.5"
              >
                <Wallet className="h-3.5 w-3.5 text-brand" />
                {rands(session.wallet.balance)}
              </button>
              <button
                onClick={() => setView('profile')}
                className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:border-brand transition flex items-center gap-1.5"
                title={`${session.level.name} · ${session.user.xp} XP`}
              >
                <span>{session.level.icon}</span>
                <span className="hidden sm:inline">{session.level.name}</span>
                <Badge variant="secondary" className="text-[10px] h-4">{session.user.xp} XP</Badge>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto">
          {content}
        </main>

        <footer className="mt-auto border-t bg-background/60 backdrop-blur">
          <div className="max-w-6xl mx-auto px-6 py-3 text-[11px] text-muted-foreground flex flex-wrap justify-between gap-2">
            <span>BUSINESS HUSTLE · SIMPLE ETERNITY HOLDINGS (PTY) LTD</span>
            <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-brand" /> HustlePortal™ — your business, levelled up</span>
          </div>
        </footer>
      </div>
    </div>
  )
}

function SidebarContent({ view, setView, session, doneChallenges, totalChallenges, logout }: {
  view: ViewKey
  setView: (v: ViewKey) => void
  session: { user: { name: string; businessName: string | null; role: string }; level: { icon: string; name: string } }
  doneChallenges: number
  totalChallenges: number
  logout: () => Promise<void>
}) {
  const nav = session.user.role === 'ADMIN'
    ? [...NAV, { key: 'admin' as ViewKey, label: 'Admin', icon: <ShieldCheck className="h-4 w-4" /> }]
    : NAV

  return (
    <>
      <div className="p-5">
        <div className="font-display text-2xl tracking-wide text-white">
          HUSTLE<span className="text-brand">PORTAL</span>
          <span className="text-[9px] align-super">™</span>
        </div>
        <p className="text-[10px] text-white/40 mt-0.5 tracking-widest">BUSINESS OS</p>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto hp-scroll">
        {nav.map((n) => (
          <button
            key={n.key}
            onClick={() => setView(n.key)}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              view === n.key
                ? 'bg-brand text-black'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            {n.icon} {n.label}
          </button>
        ))}
      </nav>

      {/* challenges mini-widget */}
      <div className="mx-3 mb-3 rounded-xl bg-white/5 border border-white/10 p-3">
        <div className="flex items-center justify-between text-[11px] text-white/50 mb-1.5">
          <span>Daily challenges</span>
          <span>{doneChallenges}/{totalChallenges}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all"
            style={{ width: `${totalChallenges ? (doneChallenges / totalChallenges) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="h-9 w-9 rounded-full bg-brand text-black flex items-center justify-center text-sm font-bold shrink-0">
            {session.user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-white truncate">{session.user.name}</div>
            <div className="text-[11px] text-white/40 truncate">{session.level.icon} {session.level.name}</div>
          </div>
          <button onClick={logout} className="text-white/40 hover:text-white transition" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  )
}
