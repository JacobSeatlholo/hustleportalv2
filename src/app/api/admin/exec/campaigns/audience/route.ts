import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { systemBlastAudience } from '@/lib/audience'

// GET /api/admin/exec/campaigns/audience — the honest roster readout for the
// "everyone on the system" blast audience. Exec seat only.
//
// Returns the segment breakdown (who is in, who is out and why) plus the
// eligible count and one sample account for the draft preview. No addresses
// are returned in bulk: staging recomputes the same law server side, so the
// number the boss reads here is the number that queues, nothing more.

export async function GET(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const skipPaying = new URL(req.url).searchParams.get('skipPaying') !== 'false'
  const { segments } = await systemBlastAudience({ skipPaying })
  return NextResponse.json({ ok: true, skipPaying, segments })
}
