import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { campaignStateKey, readCampaignStates, writeCampaignState } from '@/lib/campaignqueue'

// ONE-SHOT OPS REPAIR DOOR (Task 146) — deliberately temporary.
//
// What the blast truth showed: the kloofstreet-2026-11 failures and the
// win-back failures were all RESEND 429 rate-limit errors (10 req/s burst
// law), not bad addresses; the six dead addresses the boss flagged are
// member LOGIN emails on domains that cannot receive mail at all
// (kloofstreet.online publishes no MX, bodyvision.co.za a Null MX).
//
// This door therefore does exactly four things, nothing else:
//   1. repoint the six member logins to the boss's working addresses,
//   2. land the six dead addresses on the Suppression ledger forever,
//   3. re-queue the one blast email a 429 dropped (studburger) and wake the
//      campaign so the engine itself redelivers it under its own laws,
//   4. report anything it could not do instead of forcing it.
// No send capability lives here. Deleted in the next commit; the token dies.

const TOKEN = '8735175f83e713c08b9dee92b7b45acdee445ad44bdad42f'

// Boss's exact replacement table, lowercased.
const REPLACEMENTS: Record<string, string> = {
  'trudy@kloofstreet.online': 'trudychristians495@gmail.com',
  'drthomas@kloofstreet.online': 'contact@drthomasjahn.co.za',
  'arnolds@kloofstreet.online': 'hjarvis@blueensign.co.za',
  'onsafari@kloofstreet.online': 'njw.cpt@gmail.com',
  'postnetgardens@kloofstreet.online': 'gardens.accounts@postnet.com',
  'admin@bodyvision.co.za': 'kim@tuckermail.co.za',
}

const STUCK_TAG = 'kloofstreet-2026-11'
const STUCK_EMAIL = 'info@studburger.com'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function gate(req: NextRequest): NextResponse | null {
  const header = (req.headers.get('authorization') || '').trim()
  if (header !== `Bearer ${TOKEN}`) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })
  }
  return null
}

// GET — the full truth before anything moves: blast failure rows, the six
// member rows, replacement-address collisions, suppression state.
export async function GET(req: NextRequest) {
  const deny = gate(req)
  if (deny) return deny

  const campaigns = await db.emailLog.groupBy({ by: ['campaign', 'status'], where: { campaign: { contains: 'kloofstreet' } }, _count: { _all: true } })

  const badRows = await db.emailLog.findMany({
    where: { campaign: { contains: 'kloofstreet' }, status: { in: ['FAILED', 'BOUNCED', 'SKIPPED'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { toEmail: true, status: true, error: true, campaign: true, createdAt: true },
  })

  const olds = Object.keys(REPLACEMENTS)
  const news = Object.values(REPLACEMENTS)

  const [oldUsers, newUsers, supOld, supNew, stuckRow] = await Promise.all([
    db.user.findMany({ where: { email: { in: olds } }, select: { id: true, email: true, name: true, businessName: true, accountStatus: true } }),
    db.user.findMany({ where: { email: { in: news } }, select: { id: true, email: true, name: true } }),
    db.suppression.findMany({ where: { email: { in: olds } }, select: { email: true, reason: true } }),
    db.suppression.findMany({ where: { email: { in: news } }, select: { email: true, reason: true } }),
    db.emailLog.findFirst({ where: { campaign: STUCK_TAG, toEmail: STUCK_EMAIL }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, error: true } }),
  ])

  return NextResponse.json({
    campaigns,
    kloofBad: badRows,
    oldUsers,
    newEmailsAlreadyUsers: newUsers,
    suppressionOnOld: supOld,
    suppressionOnNew: supNew,
    stuckRow,
  })
}

// POST { confirm: true } — apply the repair exactly as planned. Never
// unsuppresses anything, sends nothing (the engine sends the requeued row on
// its own tick under its own laws), touches no other account.
export async function POST(req: NextRequest) {
  const deny = gate(req)
  if (deny) return deny
  const body = await req.json().catch(() => ({}))
  if (body?.confirm !== true) {
    return NextResponse.json({ error: 'confirm:true required' }, { status: 400 })
  }

  const result: Record<string, unknown[]> = { repointed: [], conflicts: [], suppressed: [], alreadySuppressed: [], requeued: [], notes: [] }

  const olds = Object.keys(REPLACEMENTS)

  // ---- 1. repoint the six member logins ----
  for (const [oldE, newE] of Object.entries(REPLACEMENTS)) {
    if (!EMAIL_RE.test(newE)) { result.conflicts.push({ old: oldE, new: newE, reason: 'replacement address fails format check' }); continue }
    const holder = await db.user.findUnique({ where: { email: oldE }, select: { id: true, name: true } })
    if (!holder) { result.conflicts.push({ old: oldE, new: newE, reason: 'no member row carries the old address' }); continue }
    const taken = await db.user.findUnique({ where: { email: newE }, select: { id: true, name: true } })
    if (taken) { result.conflicts.push({ old: oldE, new: newE, reason: `replacement address already belongs to member ${taken.id} (${taken.name}); no merge done` }); continue }
    await db.user.update({ where: { id: holder.id }, data: { email: newE } })
    // A pending team invite carrying the dead address would never arrive;
    // move it along so the invite still works on the new address.
    const invites = await db.teamInvite.findMany({ where: { email: oldE, acceptedAt: null }, select: { id: true, teamId: true } })
    for (const inv of invites) {
      const clash = await db.teamInvite.findUnique({ where: { teamId_email: { teamId: inv.teamId, email: newE } } })
      if (!clash) await db.teamInvite.update({ where: { id: inv.id }, data: { email: newE } })
    }
    result.repointed.push({ userId: holder.id, name: holder.name, from: oldE, to: newE, invitesMoved: invites.length })
  }

  // ---- 2. suppress the six dead addresses forever ----
  for (const oldE of olds) {
    const existing = await db.suppression.findUnique({ where: { email: oldE } })
    if (existing) { result.alreadySuppressed.push(oldE); continue }
    await db.suppression.create({ data: { email: oldE, reason: 'BOUNCE', note: 'dead login address: domain cannot receive mail (no MX / Null MX), boss-ordered removal 2026-11-02' } })
    result.suppressed.push(oldE)
  }

  // ---- 3. wake the one blast email the 429 dropped ----
  const stuck = await db.emailLog.findFirst({ where: { campaign: STUCK_TAG, toEmail: STUCK_EMAIL }, orderBy: { createdAt: 'desc' } })
  if (!stuck) {
    result.notes.push(`no ${STUCK_EMAIL} row found in ${STUCK_TAG}; nothing to requeue`)
  } else if (stuck.status === 'SENT') {
    result.notes.push(`${STUCK_EMAIL} already SENT; nothing to do`)
  } else {
    const suppressed = await db.suppression.findUnique({ where: { email: STUCK_EMAIL }, select: { reason: true } })
    if (suppressed) {
      result.notes.push(`${STUCK_EMAIL} is suppressed (${suppressed.reason}); left untouched by law`)
    } else {
      await db.emailLog.update({ where: { id: stuck.id }, data: { status: 'QUEUED', error: null, sentAt: null } })
      result.requeued.push({ id: stuck.id, to: STUCK_EMAIL, campaign: STUCK_TAG })
      const states = await readCampaignStates()
      const state = states[STUCK_TAG]
      if (state && state.status !== 'ACTIVE') {
        await writeCampaignState(STUCK_TAG, { ...state, status: 'ACTIVE', completedAt: undefined })
        result.notes.push(`campaign ${STUCK_TAG} state ${state.status} -> ACTIVE so the engine tick delivers the requeued row`)
      } else if (!state) {
        result.notes.push(`no campaign state found for ${STUCK_TAG}; row stays QUEUED and needs the campaign woken by hand`)
      }
    }
  }

  return NextResponse.json({ ok: true, result })
}
