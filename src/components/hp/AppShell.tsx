'use client'

import { useEffect, useRef, useState } from 'react'
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
import ClientsView from './ClientsView'
import ServicesView from './ServicesView'
import MailView from './MailView'
import CalendarView from './CalendarView'
import InvoicesView from './InvoicesView'
import ReportsView from './ReportsView'
import IntegrationsView from './IntegrationsView'
import GrowView from './GrowView'
import WelcomeTour from './WelcomeTour'
import {
  LayoutDashboard, Target, ListTodo, Wallet, BrainCircuit, TrendingUp,
  UserCog, ShieldCheck, Menu, X, Sparkles, LogOut, ShoppingCart, BookOpen, Users, Briefcase,
  Mail, CalendarDays, ReceiptText, LineChart, PlugZap, Building2, ChevronDown, CreditCard, Gift,
} from 'lucide-react'

const NAV: { key: ViewKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'leads', label: 'Leads & CRM', icon: <Target className="h-4 w-4" /> },
  { key: 'clients', label: 'Clients', icon: <Users className="h-4 w-4" /> },
  { key: 'tasks', label: 'Tasks', icon: <ListTodo className="h-4 w-4" /> },
  { key: 'calendar', label: 'Calendar', icon: <CalendarDays className="h-4 w-4" /> },
  { key: 'invoices', label: 'Invoices', icon: <ReceiptText className="h-4 w-4" /> },
  { key: 'finance', label: 'Finance', icon: <TrendingUp className="h-4 w-4" /> },
  { key: 'reports', label: 'Reports', icon: <LineChart className="h-4 w-4" /> },
  { key: 'mail', label: 'Mail', icon: <Mail className="h-4 w-4" /> },
  { key: 'ai', label: 'AI Co-Founder', icon: <BrainCircuit className="h-4 w-4" /> },
  { key: 'integrations', label: 'Integrations', icon: <PlugZap className="h-4 w-4" /> },
  { key: 'store', label: 'Store', icon: <ShoppingCart className="h-4 w-4" /> },
  { key: 'services', label: 'Services', icon: <Briefcase className="h-4 w-4" /> },
  { key: 'resources', label: 'Resources', icon: <BookOpen className="h-4 w-4" /> },
  { key: 'wallet', label: 'Wallet', icon: <Wallet className="h-4 w-4" /> },
  { key: 'grow', label: 'Grow & Earn', icon: <Gift className="h-4 w-4" /> },
  { key: 'profile', label: 'Profile & Team', icon: <UserCog className="h-4 w-4" /> },
]

// XP level that nudges the user to link their Yoco card
const CARD_LINK_XP_LEVEL = 3 // Operator level @ 300 XP
const CARD_BANNER_KEY = 'hp_card_banner_dismissed'

export default function AppShell() {
  const { session, view, setView, logout, loadSession } = useHp()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [cardBannerDismissed, setCardBannerDismissed] = useState(true)

  useEffect(() => {
    queueMicrotask(() => {
      setCardBannerDismissed(localStorage.getItem(CARD_BANNER_KEY) === '1')
    })
  }, [])

  // wallet navigation from anywhere + tour replay
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail as ViewKey
      if (target) setView(target)
    }
    window.addEventListener('hp:navigate', handler)
    const replay = () => {
      // replaying the tour re-arms it for one show
      window.dispatchEvent(new CustomEvent('hp:tour-fire'))
    }
    window.addEventListener('hp:tour-replay', replay)
    return () => {
      window.removeEventListener('hp:navigate', handler)
      window.removeEventListener('hp:tour-replay', replay)
    }
  }, [])

  // silent background refresh to keep XP/wallet fresh (never flips boot loader)
  useEffect(() => {
    loadSession(true)
    const t = setInterval(() => loadSession(true), 60000)
    return () => clearInterval(t)

  }, [])

  if (!session) return null

  const doneChallenges = session.challenges.filter((c) => c.done).length
  const showCardBanner =
    !cardBannerDismissed &&
    session.level.level >= CARD_LINK_XP_LEVEL &&
    view !== 'wallet'

  const dismissCardBanner = () => {
    localStorage.setItem(CARD_BANNER_KEY, '1')
    setCardBannerDismissed(true)
  }

  const content = (() => {
    switch (view) {
      case 'dashboard': return <DashboardView />
      case 'leads': return <LeadsView />
      case 'clients': return <ClientsView />
      case 'tasks': return <TasksView />
      case 'finance': return <FinanceView />
      case 'ai': return <AiView />
      case 'mail': return <MailView />
      case 'calendar': return <CalendarView />
      case 'invoices': return <InvoicesView />
      case 'reports': return <ReportsView />
      case 'integrations': return <IntegrationsView />
      case 'store': return <StoreView />
      case 'services': return <ServicesView />
      case 'resources': return <ResourcesView />
      case 'wallet': return <WalletView />
      case 'grow': return <GrowView />
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
            <ProjectSwitcher />
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

          {/* XP-threshold → link your Yoco card */}
          {showCardBanner && (
            <div className="bg-brand/10 border-t border-brand/30">
              <div className="max-w-6xl mx-auto px-4 py-2 flex flex-wrap items-center gap-2 text-sm">
                <CreditCard className="h-4 w-4 text-brand shrink-0" />
                <span className="flex-1 min-w-[16rem]">
                  <span className="font-medium">{session.level.icon} {session.level.name} level unlocked.</span>{' '}
                  <span className="text-muted-foreground">Link your card in the Wallet to take Yoco payments and top up credits in one tap.</span>
                </span>
                <button
                  onClick={() => setView('wallet')}
                  className="rounded-full bg-brand text-black px-3 py-1 text-xs font-semibold hover:brightness-110 transition"
                >
                  Link your card
                </button>
                <button onClick={dismissCardBanner} className="text-muted-foreground hover:text-foreground text-xs px-1" aria-label="Dismiss">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </header>

        <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto">
          {content}
        </main>

        <WelcomeTour />

        <footer className="mt-auto border-t bg-background/60 backdrop-blur">
          <div className="max-w-6xl mx-auto px-6 py-3 text-[11px] text-muted-foreground flex flex-wrap justify-between gap-2">
            <span>BUSINESS HUSTLE · SIMPLE ETERNITY HOLDINGS (PTY) LTD</span>
            <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-brand" /> HustlePortal™ — <span className="text-brand font-medium tracking-wide">Explore. Adapt. Evolve.</span></span>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** Company/project workspace switcher — every view scopes its data to this workspace. */
function ProjectSwitcher() {
  const { session, activeProjectId, setActiveProject } = useHp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const projects = session?.projects ?? []
  const active = projects.find((p) => p.id === activeProjectId) || projects.find((p) => p.isDefault) || projects[0] || null

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  if (!active) return null

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="hidden sm:flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium hover:border-brand/60 transition max-w-[16rem]"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch company workspace"
      >
        <Building2 className="h-4 w-4 text-brand shrink-0" />
        <span className="truncate">{active.name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
      {/* Mobile: just show the name */}
      <div className="sm:hidden flex items-center gap-1.5 text-sm font-medium text-muted-foreground max-w-[8rem]">
        <Building2 className="h-3.5 w-3.5 text-brand shrink-0" />
        <span className="truncate">{active.name}</span>
      </div>

      {open && (
        <div
          role="listbox"
          aria-label="Company workspaces"
          className="absolute left-0 top-full mt-2 w-72 rounded-xl border bg-popover shadow-xl z-50 overflow-hidden"
        >
          <div className="px-3 py-2 text-[10px] font-semibold tracking-[0.18em] uppercase text-muted-foreground border-b">
            Company workspaces
          </div>
          <div className="max-h-64 overflow-y-auto hp-scroll py-1">
            {projects.map((p) => (
              <button
                key={p.id}
                role="option"
                aria-selected={p.id === active.id}
                onClick={() => { setActiveProject(p.id); setOpen(false); window.dispatchEvent(new CustomEvent('hp:project-switched')) }}
                className={`w-full text-left px-3 py-2.5 text-sm transition flex items-center justify-between gap-2 ${p.id === active.id ? 'bg-brand/10 text-brand' : 'hover:bg-white/5'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {p.counts.leads} leads · {p.counts.clients} clients · {p.counts.invoices} invoices
                  </span>
                </span>
                {p.isDefault && <Badge variant="secondary" className="text-[9px] h-4 shrink-0">DEFAULT</Badge>}
              </button>
            ))}
          </div>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setOpen(false); window.dispatchEvent(new CustomEvent('hp:navigate', { detail: 'profile' as ViewKey })) }}
            className="block border-t px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground transition"
          >
            + Manage workspaces in Profile &amp; Team
          </a>
        </div>
      )}
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
