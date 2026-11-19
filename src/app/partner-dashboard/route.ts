import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { strategistDashboardForEmail } from '@/lib/corporate'

// ============ PARTNER DASHBOARD BRIDGE (boss, 2026-11-19) ============
// The "Analytics dashboard" row in the workspace menu points here. The
// session decides everything server-side: the partnership's registered
// email resolves to his key-gated dashboard and the member is redirected
// straight into it. The key never rides a client bundle or a menu link —
// it exists only inside this redirect. Anyone else (no session, or a
// client his funnel introduced) lands back on their own workspace.
export async function GET(req: NextRequest) {
  const back = new URL('/app', req.url)
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.redirect(back)
    const target = strategistDashboardForEmail(user.email)
    if (!target) return NextResponse.redirect(back)
    return NextResponse.redirect(new URL(target, req.url))
  } catch {
    return NextResponse.redirect(back)
  }
}
