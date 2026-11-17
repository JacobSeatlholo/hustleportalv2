import { randomInt } from 'node:crypto'
import { db } from '@/lib/db'
import { getStrategistMember, STRATEGISTS } from '@/lib/corporate'

// ============ CORPORATE ACCESS GATE (Task 215) ============
// The corporate channel is closed: access rides a code. Two kinds of code
// open the same gate:
//   1. A member code — the ?via=<code> the strategists' enrolled members
//      already hand out on their outreach links. The team member IS the
//      access code. Validated against the strategist registry (slug + code).
//   2. An exec-minted CorporateAccessCode row — the boss's own hand-outs,
//      with optional strategist/member attribution baked in and a use cap.
// Either way the claim attributes to real people from the registry, never to
// whatever a URL claims.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // unambiguous chars

export function normalizeCode(raw: unknown): string {
  return String(raw || '').trim().toUpperCase().slice(0, 40)
}

/** Human-readable code for exec minting: XXXX-XXXX-XXXX. */
export function generateAccessCode(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  return `${group()}-${group()}-${group()}`
}

export interface AccessResolution {
  ok: boolean
  /** 'member' = a strategist's enrolled member code; 'minted' = a CorporateAccessCode row. */
  kind?: 'member' | 'minted'
  slug?: string | null
  viaCode?: string | null
  label?: string | null
  codeId?: string
  maxUses?: number
}

/**
 * Resolve an access code WITHOUT consuming it. A member code needs its slug
 * context (they are per-strategist); a bare code that matches no member code
 * falls through to the minted rows, which stand alone.
 */
export async function resolveAccessCode(rawCode: unknown, slug?: string | null): Promise<AccessResolution> {
  const code = normalizeCode(rawCode)
  if (!code) return { ok: false }

  // 1. Member code on a known strategist door.
  if (slug) {
    const strategist = STRATEGISTS.find((s) => s.slug === slug)
    const member = strategist ? getStrategistMember(strategist.slug, code) : undefined
    if (member) return { ok: true, kind: 'member', slug, viaCode: member.code }
  }

  // 2. A minted code: active, not expired, uses remaining.
  const row = await db.corporateAccessCode.findUnique({ where: { code } })
  if (
    row &&
    row.active &&
    row.usedCount < row.maxUses &&
    (!row.expiresAt || row.expiresAt.getTime() > Date.now())
  ) {
    return { ok: true, kind: 'minted', slug: row.slug, viaCode: row.viaCode, label: row.label, codeId: row.id, maxUses: row.maxUses }
  }

  return { ok: false }
}

/** Consume one use of a minted code. Member codes are links, not tickets — no cap. */
export async function consumeAccessCode(res: AccessResolution): Promise<void> {
  if (res.ok && res.kind === 'minted' && res.codeId) {
    // Guarded increment: never exceeds the code's own cap even under a race.
    await db.corporateAccessCode.updateMany({
      where: { id: res.codeId, usedCount: { lt: res.maxUses ?? 1 } },
      data: { usedCount: { increment: 1 } },
    })
  }
}
