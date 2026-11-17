import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, tooMany } from '@/lib/ratelimit'
import { resolveAccessCode } from '@/lib/corporateAccess'

// ============ CORPORATE ACCESS CHECK (Task 215) ============
// POST { code, slug? } → tells the locked door whether the code opens it.
// No details beyond the attribution the UI needs; the claim API re-resolves
// and re-consumes server-side, so passing this check alone proves nothing.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  // Brute-force gate: 10 tries per hour per IP.
  const gate = rateLimit(`corporate-access:ip:${ip}`, 10, 60 * 60 * 1000)
  if (!gate.ok) return NextResponse.json(tooMany(gate.retryAfterSec), { status: 429 })

  const body = (await req.json().catch(() => null)) as { code?: string; slug?: string } | null
  const res = await resolveAccessCode(body?.code, body?.slug ?? null)
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: 'That code does not open this door.' }, { status: 403 })
  }
  return NextResponse.json({ ok: true, kind: res.kind, slug: res.slug ?? null, viaCode: res.viaCode ?? null, label: res.label ?? null })
}
