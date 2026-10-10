'use client'

import { create } from 'zustand'
import { api, type SessionData } from './shared'

export type ViewKey =
  | 'dashboard'
  | 'leads'
  | 'tasks'
  | 'finance'
  | 'ai'
  | 'store'
  | 'resources'
  | 'wallet'
  | 'profile'
  | 'admin'

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
}

export const useHp = create<HpState>((set) => ({
  session: null,
  sessionLoading: true,
  view: 'dashboard',
  setView: (v) => set({ view: v }),
  loadSession: async (silent = false) => {
    // silent: background refresh — never flip the boot loader
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
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}))

if (typeof window !== 'undefined') {
  (window as unknown as { __hpDebug: () => void }).__hpDebug = () => {
    const s = useHp.getState()
    return { loading: s.sessionLoading, hasSession: !!s.session, view: s.view }
  }
}
