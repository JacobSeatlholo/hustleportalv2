'use client'

import { create } from 'zustand'
import { api, type SessionData } from './shared'

export type ViewKey =
  | 'dashboard'
  | 'leads'
  | 'clients'
  | 'tasks'
  | 'inventory'
  | 'finance'
  | 'ai'
  | 'mail'
  | 'calendar'
  | 'invoices'
  | 'reports'
  | 'integrations'
  | 'store'
  | 'resources'
  | 'services'
  | 'wallet'
  | 'grow'
  | 'profile'
  | 'admin'

export interface HpProject {
  id: string
  name: string
  isDefault: boolean
  counts: { id: string; leads: number; clients: number; invoices: number }
}

interface HpState {
  session: SessionData | null
  sessionLoading: boolean
  view: ViewKey
  setView: (v: ViewKey) => void
  loadSession: (silent?: boolean) => Promise<void>
  logout: () => Promise<void>
  aiBarQuery: string
  setAiBarQuery: (q: string) => void
  refreshTick: number
  bumpRefresh: () => void
  activeProjectId: string | null
  setActiveProject: (id: string) => void
  /** Deep-link target: a shop item title a touchpoint wants the Store to open. */
  storeFocus: string | null
  setStoreFocus: (title: string | null) => void
}

export const useHp = create<HpState>((set) => ({
  session: null,
  sessionLoading: true,
  view: 'dashboard',
  setView: (v) => set({ view: v }),
  activeProjectId: typeof window !== 'undefined' ? localStorage.getItem('hp_active_project') : null,
  setActiveProject: (id) => {
    if (typeof window !== 'undefined') localStorage.setItem('hp_active_project', id)
    set({ activeProjectId: id })
  },
  loadSession: async (silent = false) => {
    // silent: background refresh, never flip the boot loader
    if (!silent) set({ sessionLoading: true })
    try {
      const data = await api<SessionData>('/api/auth/me')
      set({ session: data, sessionLoading: false })
    } catch {
      set({ session: null, sessionLoading: false })
    }
  },
  logout: async () => {
    await api('/api/auth/logout', { method: 'POST' })
    set({ session: null, view: 'dashboard' })
  },
  aiBarQuery: '',
  setAiBarQuery: (q) => set({ aiBarQuery: q }),
  storeFocus: null,
  setStoreFocus: (title) => set({ storeFocus: title }),
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}))

if (typeof window !== 'undefined') {
  (window as unknown as { __hpDebug: () => void }).__hpDebug = () => {
    const s = useHp.getState()
    return { loading: s.sessionLoading, hasSession: !!s.session, view: s.view }
  }
}
