'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useHp, type ViewKey } from './store'
import { api, rands } from './shared'
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
import InventoryView from './InventoryView'
import WelcomeTour from './WelcomeTour'
import UpgradeListener from './useUpgrade'
import SectionTutorial from './SectionTutorial'
import TaskReminders from './TaskReminders'
import InstallApp from './InstallApp'
import PwaNotifications from './PwaNotifications'
import {
  LayoutDashboard, Target, ListTodo, Wallet, BrainCircuit, TrendingUp,
  UserCog, ShieldCheck, Menu, X, Sparkles, LogOut, ShoppingCart, BookOpen, Users, Briefcase,
  Mail, CalendarDays, ReceiptText, LineChart, PlugZap, Building2, ChevronDown, CreditCard, Gift,
  Boxes, LayoutGrid,
} from 'lucide-react'

const NAV: { key: ViewKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'leads', label: 'Leads & CRM', icon: <Target className="h-4 w-4" /> },
  { key: 'clients', label: 'Clients', icon: <Users className="h-4 w-4" /> },
  { key: 'tasks', label: 'Tasks', icon: <ListTodo className="h-4 w-4" /> },
  { key: 'inventory', label: 'Inventory', icon: <Boxes className="h-4 w-4" /> },
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

/** Thumb-reach bottom bar (phones only): the 4 most-used views + More → opens the full menu. */
const BOTTOM_NAV: { key: ViewKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Home', icon: <LayoutDashboard className="h-5 w-5" /> },
  { key: 'leads', label: 'Leads', icon: <Target className="h-5 w-5" /> },
  { key: 'tasks', label: 'Tasks', icon: <ListTodo className="h-5 w-5" /> },
  { key: 'invoices', label: 'Invoices', icon: <ReceiptText className="h-5 w-5" /> },
]

const TILT_TIP_KEY = 'hp_tilt_tip_dismissed'

// XP level that nudges the user to link their Yoco card
const CARD_LINK_XP_LEVEL = 3 // Operator level @ 300 XP
const CARD_BANNER_KEY = 'hp_card_banner_dismissed'

export default function AppShell() {
  const { session, view, setView, logout, loadSession } = useHp()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [cardBannerDismissed, setCardBannerDismissed] = useState(true)
  const [showTiltTip, setShowTiltTip] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      setCardBannerDismissed(localStorage.getItem(CARD_BANNER_KEY) === '1')
    })
  }, [])

  // Push notifications: register the service worker once per session.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  // One-time reachability tip (installed app on a phone): the user asked for a
  // prompt suggesting the tilt trick — but the honest fix is the bottom menu bar.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const standalone = window.matchMedia('(display-mode: standalone)').matches
        const phone = window.matchMedia('(max-width: 767px)').matches
        if (standalone && phone && localStorage.getItem(TILT_TIP_KEY) !== '1') setShowTiltTip(true)
      } catch { /* private mode — skip the tip */ }
    }, 4000)
    return () => clearTimeout(t)
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
      case 'inventory': return <InventoryView />
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
        {/* Topbar — taller touch targets + safe-area padding so nothing hides under a notch */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="flex items-center gap-2 px-3 py-2.5 min-h-[56px]">
            <Button variant="ghost" size="icon" className="md:hidden h-11 w-11" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
            <div className="font-display text-lg md:hidden">
              HUSTLE<span className="text-brand">PORTAL</span>
            </div>
            <ProjectSwitcher />
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setView('wallet')}
                className="rounded-full border bg-card px-3.5 min-h-[40px] text-xs font-medium hover:border-brand transition flex items-center gap-1.5"
              >
                <Wallet className="h-3.5 w-3.5 text-brand" />
                {rands(session.wallet.balance)}
              </button>
              <button
                onClick={() => setView('profile')}
                className="rounded-full border bg-card px-3.5 min-h-[40px] text-xs font-medium hover:border-brand transition flex items-center gap-1.5"
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

        <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto pb-24 md:pb-6">
          {content}
        </main>

        <WelcomeTour />
        <SectionTutorial />
        <TaskReminders />
        <UpgradeListener />

        {/* Thumb-reach bottom navigation (phones only) — the fix for top-bar buttons
            being out of comfortable reach on tall screens. */}
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 backdrop-blur"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          aria-label="Main menu"
        >
          <div className="grid grid-cols-5">
            {BOTTOM_NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition min-h-[56px] justify-center ${
                  view === n.key ? 'text-brand' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {n.icon}
                {n.label}
              </button>
            ))}
            <button
              onClick={() => setSidebarOpen(true)}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition min-h-[56px] justify-center ${
                BOTTOM_NAV.some((n) => n.key === view) ? 'text-muted-foreground hover:text-foreground' : 'text-brand'
              }`}
            >
              <LayoutGrid className="h-5 w-5" />
              More
            </button>
          </div>
        </nav>

        {/* One-time reachability tip — the user asked for the tilt trick prompt */}
        <Dialog open={showTiltTip} onOpenChange={(o) => { if (!o) { localStorage.setItem(TILT_TIP_KEY, '1'); setShowTiltTip(false) } }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /> Quick tip for your phone</DialogTitle>
              <DialogDescription>
                If buttons at the top of the screen feel out of reach, tilt your screen back slightly — that usually does the trick.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-xl border border-brand/30 bg-brand/5 p-3 text-sm space-y-1.5">
                <p className="font-medium">Even better: the menu is now at the bottom.</p>
                <p className="text-muted-foreground text-[13px]">
                  Home, Leads, Tasks and Invoices sit in the bar at the bottom of the screen — thumb distance on any phone.
                  Tap <b>More</b> for the full menu, and hold-and-drag menu items to sort them your way.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => { localStorage.setItem(TILT_TIP_KEY, '1'); setShowTiltTip(false) }}
              >
                Got it
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <footer className="mt-auto border-t bg-background/60 backdrop-blur">
          <div className="max-w-6xl mx-auto px-6 py-3 text-[11px] text-muted-foreground space-y-1.5">
            <div className="flex flex-wrap justify-between gap-2">
              <span>BUSINESS HUSTLE · SIMPLE ETERNITY HOLDINGS (PTY) LTD</span>
              <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-brand" /> HustlePortal™ — <span className="text-brand font-medium tracking-wide">We feed your pipeline. You run your business.</span></span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <a href="https://businesshustle.co.za/terms" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">Terms of Service</a>
              <a href="https://businesshustle.co.za/privacy" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">Privacy &amp; POPIA</a>
              <a href="https://businesshustle.co.za" target="_blank" rel="noreferrer" className="text-brand hover:underline">www.businesshustle.co.za</a>
            </div>
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
            onClick={(e) => {
              e.preventDefault()
              setOpen(false)
              sessionStorage.setItem('hp:open-new-project', '1')
              window.dispatchEvent(new CustomEvent('hp:navigate', { detail: 'profile' as ViewKey }))
            }}
            className="block border-t px-3 py-2.5 text-xs font-medium text-brand hover:text-foreground transition"
          >
            + New project in Profile &amp; Team
          </a>
        </div>
      )}
    </div>
  )
}

const ADMIN_NAV: { key: ViewKey; label: string; icon: React.ReactNode } = {
  key: 'admin',
  label: 'Admin',
  icon: <ShieldCheck className="h-4 w-4" />,
}

/**
 * SidebarContent — the user's personal menu.
 * Long-press (hold ~1/3s) any menu item, then drag to sort the menu YOUR priority order.
 * Click still navigates; the order persists per user (UserSetting: NAV_ORDER).
 */
function SidebarContent({ view, setView, session, doneChallenges, totalChallenges, logout }: {
  view: ViewKey
  setView: (v: ViewKey) => void
  session: { user: { name: string; businessName: string | null; role: string }; level: { icon: string; name: string } }
  doneChallenges: number
  totalChallenges: number
  logout: () => Promise<void>
}) {
  const isAdmin = session.user.role === 'ADMIN'

  // personal menu order (persisted per user)
  const [order, setOrder] = useState<ViewKey[] | null>(null)
  const orderRef = useRef<ViewKey[] | null>(null)
  const [dragKey, setDragKey] = useState<ViewKey | null>(null)
  const itemRefs = useRef(new Map<ViewKey, HTMLButtonElement>())
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressPos = useRef({ x: 0, y: 0 })
  const suppressClick = useRef(false)

  useEffect(() => {
    api<{ settings: { key: string; value: string }[] }>('/api/settings')
      .then((r) => {
        const row = r.settings.find((s) => s.key === 'NAV_ORDER')
        if (!row) return
        try {
          const parsed = JSON.parse(row.value)
          if (Array.isArray(parsed) && parsed.length) {
            const clean = parsed.filter((k): k is ViewKey => typeof k === 'string')
            orderRef.current = clean
            setOrder(clean)
          }
        } catch { /* corrupt order — fall back to default */ }
      })
      .catch(() => {})
  }, [])

  const nav = useMemo(() => {
    if (!order || order.length === 0) return NAV
    const known = NAV.filter((n) => order.includes(n.key)).sort(
      (a, b) => order.indexOf(a.key) - order.indexOf(b.key)
    )
    const rest = NAV.filter((n) => !order.includes(n.key))
    return [...known, ...rest]
  }, [order])

  // While dragging, stop the browser scrolling the menu out from under the finger.
  useEffect(() => {
    if (!dragKey) return
    const stop = (e: TouchEvent) => e.preventDefault()
    document.addEventListener('touchmove', stop, { passive: false })
    return () => document.removeEventListener('touchmove', stop)
  }, [dragKey])

  function applyOrder(next: ViewKey[], persist: boolean) {
    orderRef.current = next
    setOrder(next)
    if (persist) {
      api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ key: 'NAV_ORDER', value: JSON.stringify(next) }),
      }).catch(() => {})
    }
  }

  function reorderAt(key: ViewKey, clientY: number) {
    const list = orderRef.current
      ? NAV.filter((n) => orderRef.current!.includes(n.key)).sort(
          (a, b) => orderRef.current!.indexOf(a.key) - orderRef.current!.indexOf(b.key)
        ).concat(NAV.filter((n) => !orderRef.current!.includes(n.key)))
      : NAV
    const fromIdx = list.findIndex((n) => n.key === key)
    if (fromIdx < 0) return
    let toIdx = fromIdx
    for (let i = 0; i < list.length; i++) {
      const el = itemRefs.current.get(list[i].key)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) { toIdx = i; break }
      toIdx = i
    }
    if (toIdx !== fromIdx) {
      const nextKeys = [...list]
      nextKeys.splice(toIdx, 0, nextKeys.splice(fromIdx, 1)[0])
      applyOrder(nextKeys.map((n) => n.key), false) // persist once, on drop
    }
  }

  function onItemPointerDown(e: React.PointerEvent, key: ViewKey) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pressPos.current = { x: e.clientX, y: e.clientY }
    if (pressTimer.current) clearTimeout(pressTimer.current)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not fatal */ }
    pressTimer.current = setTimeout(() => {
      setDragKey(key)
      try { navigator.vibrate?.(25) } catch { /* no haptics — fine */ }
    }, 320)
  }

  function onItemPointerMove(e: React.PointerEvent, key: ViewKey) {
    if (dragKey === key) {
      e.preventDefault()
      reorderAt(key, e.clientY)
      return
    }
    // drifted before activation — that is a scroll, not a hold
    const dx = e.clientX - pressPos.current.x
    const dy = e.clientY - pressPos.current.y
    if (dx * dx + dy * dy > 100 && pressTimer.current) clearTimeout(pressTimer.current)
  }

  function endItemInteraction(key: ViewKey, cancelled: boolean) {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    if (dragKey === key) {
      suppressClick.current = true
      setDragKey(null)
      if (!cancelled && orderRef.current) applyOrder(orderRef.current, true)
      setTimeout(() => { suppressClick.current = false }, 250)
    }
  }

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
            ref={(el) => { if (el) itemRefs.current.set(n.key, el); else itemRefs.current.delete(n.key) }}
            onClick={() => { if (suppressClick.current) return; setView(n.key) }}
            onPointerDown={(e) => onItemPointerDown(e, n.key)}
            onPointerMove={(e) => onItemPointerMove(e, n.key)}
            onPointerUp={() => endItemInteraction(n.key, false)}
            onPointerCancel={() => endItemInteraction(n.key, true)}
            onContextMenu={(e) => { if (dragKey) e.preventDefault() }}
            style={{ touchAction: dragKey === n.key ? 'none' : undefined }}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition select-none ${
              dragKey === n.key
                ? 'relative z-10 bg-brand text-black ring-2 ring-brand shadow-lg scale-[1.02]'
                : view === n.key
                  ? 'bg-brand text-black'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
            } ${dragKey && dragKey !== n.key ? 'transition-transform' : ''}`}
          >
            {n.icon} {n.label}
          </button>
        ))}
        {isAdmin && (
          <button
            onClick={() => setView(ADMIN_NAV.key)}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              view === ADMIN_NAV.key
                ? 'bg-brand text-black'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            {ADMIN_NAV.icon} {ADMIN_NAV.label}
          </button>
        )}
        <p className="text-[10px] text-white/30 px-3 pt-2 pb-1 leading-relaxed">
          Hold a menu item and drag it to sort your menu your way.
        </p>
      </nav>

      <div className="px-3">
        <InstallApp />
      </div>

      {/* Push notifications opt-in (installed app) */}
      <div className="px-3 mt-1">
        <PwaNotifications compact />
      </div>

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
