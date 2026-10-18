'use client'

/**
 * The personalization brain behind the post signup survey.
 *
 * Two answers power everything:
 *   profession — what they do (accountant, lawyer, solopreneur...)
 *   persona    — what they want first (find customers, get paid, stay on
 *                top of work, run everything)
 *
 * Each persona carries a mastery track: three moves in the order that pays,
 * deep linked into the exact section, with done checks that read REAL work
 * (a client exists, an invoice was sent, a lead moved) rather than taps.
 * Psychology on purpose, honesty always: the survey echoes their own words
 * back (commitment), the track shows progress (momentum), and every step
 * lands in a tool that actually does the job it promises.
 *
 * Copy law: no hyphens, no emoji, simple English, power words, truthful.
 */

export type Persona = 'FIND_CLIENTS' | 'GET_PAID' | 'STAY_ON_TOP' | 'RUN_EVERYTHING'
export type Profession = 'ACCOUNTANT' | 'ADVISOR' | 'LAWYER' | 'ENTREPRENEUR' | 'SOLOPRENEUR' | 'OTHER'

export interface TrackStep {
  label: string
  why: string
  view: string
  /** 'live' checks read real workspace data; 'visit' marks done on first open. */
  check: 'live' | 'visit'
  /** Machine key for the live check (evaluated in DashboardView). */
  signal?: 'profile' | 'leads' | 'pipeline_moved' | 'won' | 'clients' | 'invoices' | 'revenue' | 'tasks' | 'tasks_done'
}

export interface PersonaDef {
  key: Persona
  label: string
  verb: string
  blurb: string
  today: string
  homeView: string
  track: TrackStep[]
}

export const PERSONAS: Record<Persona, PersonaDef> = {
  FIND_CLIENTS: {
    key: 'FIND_CLIENTS',
    label: 'Find customers',
    verb: 'find customers',
    blurb: 'The Lead Finder, your pipeline and follow ups that never get forgotten.',
    today: 'Today moves your pipeline.',
    homeView: 'leads',
    track: [
      {
        label: 'Tell the AI what you sell',
        why: 'One line about your business sharpens every lead, pitch and email.',
        view: 'profile',
        check: 'live',
        signal: 'profile',
      },
      {
        label: 'Run your first search',
        why: 'Name the businesses you want and your city. Verified faces only.',
        view: 'leads',
        check: 'live',
        signal: 'leads',
      },
      {
        label: 'Move one forward',
        why: 'A lead turns into money when it moves. Contacted, then won.',
        view: 'leads',
        check: 'live',
        signal: 'pipeline_moved',
      },
    ],
  },
  GET_PAID: {
    key: 'GET_PAID',
    label: 'Get paid',
    verb: 'get paid',
    blurb: 'Clients, invoices and one honest view of the money.',
    today: 'Today moves your money.',
    homeView: 'clients',
    track: [
      {
        label: 'Add a client',
        why: 'Every invoice hangs off a client. One minute to add.',
        view: 'clients',
        check: 'live',
        signal: 'clients',
      },
      {
        label: 'Send your first invoice',
        why: 'Build it in a minute, send it by email, see when it opens.',
        view: 'invoices',
        check: 'live',
        signal: 'invoices',
      },
      {
        label: 'Watch the money',
        why: 'Income, expenses and profit in one place. Numbers you can trust.',
        view: 'finance',
        check: 'live',
        signal: 'revenue',
      },
    ],
  },
  STAY_ON_TOP: {
    key: 'STAY_ON_TOP',
    label: 'Stay on top of work',
    verb: 'stay on top of your work',
    blurb: 'Tasks, deadlines and your calendar in one line of sight.',
    today: 'Today clears your desk.',
    homeView: 'tasks',
    track: [
      {
        label: 'Add a task',
        why: 'Capture it now, forget nothing. Due dates keep you honest.',
        view: 'tasks',
        check: 'live',
        signal: 'tasks',
      },
      {
        label: 'Clear one task',
        why: 'Mark something done today. Momentum pays first.',
        view: 'tasks',
        check: 'live',
        signal: 'tasks_done',
      },
      {
        label: 'Plan your week',
        why: 'Meetings and deadlines on one calendar, syncs with Google.',
        view: 'calendar',
        check: 'visit',
      },
    ],
  },
  RUN_EVERYTHING: {
    key: 'RUN_EVERYTHING',
    label: 'Run everything',
    verb: 'run the whole operation',
    blurb: 'The whole Business OS, arranged in the order that pays.',
    today: 'Today moves the whole show.',
    homeView: 'leads',
    track: [
      {
        label: 'Find customers',
        why: 'Search your city, reveal real businesses, load your pipeline.',
        view: 'leads',
        check: 'live',
        signal: 'leads',
      },
      {
        label: 'Get paid',
        why: 'Client, invoice, money. The loop that feeds everything else.',
        view: 'invoices',
        check: 'live',
        signal: 'invoices',
      },
      {
        label: 'Ask the AI advisor',
        why: 'Pricing, follow ups, next moves. It reads your real numbers.',
        view: 'ai',
        check: 'visit',
      },
    ],
  },
}

export const PROFESSIONS: { key: Profession; label: string; blurb: string }[] = [
  { key: 'ACCOUNTANT', label: 'Accountant', blurb: 'Books, invoices and records, clean and on time.' },
  { key: 'ADVISOR', label: 'Financial advisor', blurb: 'Clients to find, meetings to keep, advice to sell.' },
  { key: 'LAWYER', label: 'Lawyer', blurb: 'Matters, clients and hours that turn into invoices.' },
  { key: 'ENTREPRENEUR', label: 'Entrepreneur', blurb: 'You run the whole show. Every part, one place.' },
  { key: 'SOLOPRENEUR', label: 'Solopreneur', blurb: 'Every hat at once. Find the work, do the work, get paid.' },
  { key: 'OTHER', label: 'Something else', blurb: 'Your hustle, your way. The OS bends to fit it.' },
]

export function personaOf(key: string | null | undefined): PersonaDef | null {
  if (!key) return null
  return (PERSONAS as Record<string, PersonaDef>)[key] || null
}

export function professionLabel(key: string | null | undefined): string | null {
  if (!key) return null
  return PROFESSIONS.find((p) => p.key === key)?.label || null
}

/** Lowercase plural that reads right in a sentence: "built for accountants". */
export function professionPlural(key: string | null | undefined): string | null {
  const label = professionLabel(key)
  if (!label || label === 'Something else') return null
  return `${label.toLowerCase()}s`
}

/** The one line the dashboard hero whispers back at them. */
export function personalLine(persona: string | null | undefined, profession: string | null | undefined): string | null {
  const p = personaOf(persona)
  if (!p) return null
  const f = professionPlural(profession)
  return f ? `${p.today} Built for ${f}.` : p.today
}
