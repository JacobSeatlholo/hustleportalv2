/**
 * modules.ts — the modular workspace registry.
 *
 * The user tailors HustlePortal to their hustle: modules they do not use yet
 * come OFF the menu, so the app always feels like it was built for exactly
 * their business. This is a menu law, not a paywall law — every plan includes
 * every capability; tailoring decides what is VISIBLE, never what is POSSIBLE.
 *
 * Tutorials ride the same rails: a hidden module cannot be visited, so its
 * tutorial never nags. Turn a module on and its guided walkthrough is waiting.
 *
 * Storage: UserSetting key 'MODULES' = JSON array of DISABLED extra-module keys.
 * Default (unset) = everything on, which is the exact behaviour the platform
 * has always had. Nothing is removed by default.
 */

import type { ViewKey } from '@/components/hp/store'

export interface ModuleDef {
  key: Exclude<ViewKey, 'admin' | 'dashboard' | 'profile' | 'grow' | 'wallet' | 'leads' | 'clients' | 'tasks' | 'invoices'>
  label: string
  icon: string // lucide icon name, resolved client-side
  /** One honest line: what this module does for the business. */
  description: string
  /** Which hustle it feeds — shown as a chip so tailoring feels concrete. */
  feeds: string
}

/**
 * Modules a user can switch off. Core surfaces (Dashboard, Leads & Pipeline,
 * Clients, Tasks, Invoices, Wallet, Grow, Profile) are the spine of the
 * Business OS and stay on for everyone.
 */
export const MODULES: ModuleDef[] = [
  { key: 'inventory', label: 'Inventory', icon: 'Boxes', description: 'Stock counts, cost and selling prices, low stock warnings, CSV import for existing lists.', feeds: 'Retail, trade & stockists' },
  { key: 'calendar', label: 'Calendar', icon: 'CalendarDays', description: 'Appointments with auto meeting links, diary scanning and Google Calendar sync.', feeds: 'Bookings & site visits' },
  { key: 'finance', label: 'Finance', icon: 'TrendingUp', description: 'Money in, money out, category breakdowns and a clean export at tax time.', feeds: 'Knowing the numbers' },
  { key: 'reports', label: 'Reports', icon: 'LineChart', description: 'Pipeline velocity and revenue charts built from the work you already do.', feeds: 'Weekly reviews' },
  { key: 'mail', label: 'Mail & Campaigns', icon: 'Mail', description: 'AI drafts, the sending engine, bulk campaigns with read receipts and one-click unsubscribe.', feeds: 'Follow-up that closes' },
  { key: 'ai', label: 'AI Co-Founder', icon: 'BrainCircuit', description: 'Plans, pricing advice and answers grounded in your live pipeline and numbers.', feeds: 'Decisions' },
  { key: 'store', label: 'Store', icon: 'ShoppingCart', description: 'Packages and toolkits for your hustle, ordered in-app and delivered by the team.', feeds: 'Growth services' },
  { key: 'services', label: 'Services', icon: 'Briefcase', description: 'Your public service menu with prices — customers order while you sleep.', feeds: 'Taking bookings' },
  { key: 'resources', label: 'Resource Hub', icon: 'BookOpen', description: 'Playbooks and free tools written for South African small business.', feeds: 'Learning' },
  { key: 'integrations', label: 'Integrations', icon: 'PlugZap', description: 'Bring your own AI keys, Gmail sending, WhatsApp and calendar connections.', feeds: 'Power users' },
]

export const MODULE_KEYS = MODULES.map((m) => m.key)

export function isModuleKey(v: string): v is ModuleDef['key'] {
  return MODULE_KEYS.includes(v as ModuleDef['key'])
}

/** Parse the stored setting. Unknown keys are dropped; unset = all on. */
export function parseDisabledModules(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((k): k is string => typeof k === 'string' && isModuleKey(k))
  } catch {
    return []
  }
}

/** The nav order may name hidden modules — filter an ordered list to enabled keys. */
export function filterEnabled(ordered: { key: ViewKey }[], disabled: string[]): { key: ViewKey }[] {
  if (disabled.length === 0) return ordered
  return ordered.filter((n) => !disabled.includes(n.key))
}
