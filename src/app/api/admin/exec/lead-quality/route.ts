import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { qualitySummary } from '@/lib/leadfeedback'

// GET /api/admin/exec/lead-quality, the owner's lens on lead quality.
//
// "Are the leads actually any good?" stops being a feeling: every verdict a
// member files (Good fit / Not a fit + reason) lands here, broken down by
// source so the owner sees WHICH door ships quality, by reason so the fix
// knows where to aim, and as the freshest verdicts with the seller's own
// words attached. Exec only.
export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const summary = await qualitySummary()
  return NextResponse.json(summary)
}
