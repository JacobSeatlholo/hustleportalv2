import { db } from '@/lib/db'

// The statement→lead matching law, the twin of statementSync's account match:
// find the ONE pipeline lead a sent statement belongs to, or admit there is
// none to guess. Never guesses (0 hits → NONE, ≥2 hits → AMBIGUOUS) — the
// boss's pipeline is his book, and a wrong auto-move would lie in it.
//
// Order of evidence, strongest first:
//   1. EMAIL, exact case-insensitive — an address is the person; if exactly
//      one owned lead carries it, that is the lead.
//   2. NAME, normalized equality or containment both ways (statementSync's
//      clientName law: "Acme Trading" matches "Acme" and vice versa) against
//      the lead's company.
// Matching runs against the sender's OWN leads — the sender's pipeline is the
// one the statement should land in (the email log is created under the same
// userId).

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface LeadMatchLead {
  id: string
  company: string
  contactName: string | null
  stage: string
}

export type LeadMatch =
  | { kind: 'NONE' }
  | { kind: 'ONE'; lead: LeadMatchLead }
  | { kind: 'AMBIGUOUS' }

export async function matchLead(userId: string, email: string | null, name: string | null): Promise<LeadMatch> {
  try {
    const leads = await db.lead.findMany({
      where: { userId },
      select: { id: true, company: true, contactName: true, stage: true, email: true },
    })
    const to = (email || '').trim().toLowerCase()
    if (to) {
      const byEmail = leads.filter((l) => (l.email || '').trim().toLowerCase() === to)
      if (byEmail.length === 1) {
        const { email: _e, ...lead } = byEmail[0]
        return { kind: 'ONE', lead }
      }
      if (byEmail.length > 1) return { kind: 'AMBIGUOUS' }
    }
    const target = norm(name || '')
    if (!target) return { kind: 'NONE' }
    const byName = leads.filter((l) => {
      const n = norm(l.company)
      return !!n && (n === target || n.includes(target) || target.includes(n))
    })
    if (byName.length === 1) {
      const { email: _e, ...lead } = byName[0]
      return { kind: 'ONE', lead }
    }
    if (byName.length > 1) return { kind: 'AMBIGUOUS' }
    return { kind: 'NONE' }
  } catch {
    // The send already went out; a matching stumble must never read as a
    // failed email. Silence → the boss just doesn't get the prompt.
    return { kind: 'NONE' }
  }
}
