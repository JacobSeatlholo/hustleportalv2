import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ONE-SHOT OPS REPAIR DOOR (Task 146) — deliberately temporary.
//
// Context: the kloofstreet-2026-11 contact blast hard-failed on six addresses
// that live on domains which cannot receive mail at all (kloofstreet.online
// publishes no MX record, bodyvision.co.za publishes a Null MX). The boss
// ordered: diagnose, remove the dead addresses, and replace six of them with
// the real working addresses he supplied. The exec seat password was rotated
// in the same window, so this door exists exactly long enough to run that one
// repair, then the route is deleted in the very next commit and the token
// dies with it. No send capability lives here — it edits contact book rows
// and the suppression ledger only.

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// A conservative hard-failure detector: only provider errors that read as
// permanent become suppressions. Quota, timeout and rate words never do.
function isHardFailure(err: string | null | undefined): boolean {
  if (!err) return false
  const e = err.toLowerCase()
  const hard = ['not found', 'no mail', 'mailbox', 'no mx', 'mx record', 'dns', 'invalid', 'rejected', 'bounce', 'unrouteable', 'no such user', 'recipient', 'disabled', 'permanent']
  const soft = ['rate', 'quota', 'timeout', 'timed out', 'temporarily', 'try again', '429', 'limit']
  if (soft.some((s) => e.includes(s))) return false
  return hard.some((h) => e.includes(h))
}

function gate(req: NextRequest): NextResponse | null {
  const header = (req.headers.get('authorization') || '').trim()
  if (header !== `Bearer ${TOKEN}`) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })
  }
  return null
}

// GET — the full truth: every non-SENT row in the kloofstreet campaigns, the
// six affected lead rows wherever they sit, and the current state of the six
// replacement addresses (dupes, suppression).
export async function GET(req: NextRequest) {
  const deny = gate(req)
  if (deny) return deny

  const campaigns = await db.emailLog.groupBy({ by: ['campaign', 'status'], where: { campaign: { contains: 'kloofstreet' } }, _count: { _all: true } })

  const badRows = await db.emailLog.findMany({
    where: { campaign: { contains: 'kloofstreet' }, status: { in: ['FAILED', 'BOUNCED', 'SKIPPED'] } },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { toEmail: true, status: true, error: true, campaign: true, sentAt: true, createdAt: true },
  })

  // Also catch recent hard failures outside the kloofstreet tags, last 14 days.
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000)
  const otherBad = await db.emailLog.findMany({
    where: {
      status: { in: ['FAILED', 'BOUNCED'] },
      OR: [{ sentAt: { gte: since } }, { createdAt: { gte: since } }],
      NOT: { campaign: { contains: 'kloofstreet' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { toEmail: true, status: true, error: true, campaign: true, sentAt: true, createdAt: true },
  })

  const olds = Object.keys(REPLACEMENTS)
  const news = Object.values(REPLACEMENTS)

  const [oldLeads, newLeads, oldUsers, supOld, supNew] = await Promise.all([
    db.lead.findMany({ where: { email: { in: olds } }, select: { id: true, email: true, company: true, userId: true, projectId: true, stage: true } }),
    db.lead.findMany({ where: { email: { in: news } }, select: { id: true, email: true, company: true, userId: true } }),
    db.user.findMany({ where: { email: { in: olds } }, select: { id: true, email: true, name: true } }),
    db.suppression.findMany({ where: { email: { in: olds } }, select: { email: true, reason: true } }),
    db.suppression.findMany({ where: { email: { in: news } }, select: { email: true, reason: true } }),
  ])

  return NextResponse.json({
    campaigns,
    kloofBad: badRows,
    otherBadRecent: otherBad,
    oldLeads,
    newLeadsAlreadyExist: newLeads,
    oldEmailsAreUserLogins: oldUsers,
    suppressionOnOld: supOld,
    suppressionOnNew: supNew,
    plan: {
      replace: Object.entries(REPLACEMENTS).map(([o, n]) => ({ old: o, new: n })),
      suppress: olds,
    },
  })
}

// POST { confirm: true } — apply the repair exactly as planned:
//  1. lead.email = the new working address (all rows carrying the dead one),
//     with a provenance line appended to notes.
//  2. the six dead addresses land on Suppression (BOUNCE) so no future
//     campaign can ever touch them again.
//  3. any other blast address whose provider error reads as a permanent
//     failure is suppressed too; soft errors are left alone.
// Never: unsuppresses anything, sends anything, touches User logins.
export async function POST(req: NextRequest) {
  const deny = gate(req)
  if (deny) return deny
  const body = await req.json().catch(() => ({}))
  if (body?.confirm !== true) {
    return NextResponse.json({ error: 'confirm:true required' }, { status: 400 })
  }

  const audit = { replaced: [] as unknown[], conflicts: [] as unknown[], suppressed: [] as string[], alreadySuppressed: [] as string[], suppressedExtras: [] as string[], skippedSoft: [] as { email: string; error: string }[] }

  const olds = Object.keys(REPLACEMENTS)

  // ---- 1. replacements ----
  for (const [oldE, newE] of Object.entries(REPLACEMENTS)) {
    if (!EMAIL_RE.test(newE)) { audit.conflicts.push({ old: oldE, new: newE, reason: 'replacement address fails format check' }); continue }
    const holders = await db.lead.findMany({ where: { email: oldE }, select: { id: true, company: true, notes: true } })
    if (holders.length === 0) { audit.conflicts.push({ old: oldE, new: newE, reason: 'no lead row carries the old address (already gone?)' }); continue }
    const taken = await db.lead.findFirst({ where: { email: newE }, select: { id: true, company: true } })
    if (taken) { audit.conflicts.push({ old: oldE, new: newE, reason: `replacement address already sits on lead ${taken.id} (${taken.company}); no merge done` }); continue }
    for (const h of holders) {
      const stamp = new Date().toISOString().slice(0, 10)
      const line = `[${stamp}] email updated by ops: ${oldE} could not receive mail (domain has no mail service); replaced with ${newE}.`
      await db.lead.update({ where: { id: h.id }, data: { email: newE, notes: `${h.notes ? `${h.notes}\n` : ''}${line}`.slice(0, 2000) } })
      audit.replaced.push({ leadId: h.id, company: h.company, from: oldE, to: newE })
    }
  }

  // ---- 2. suppress the six dead addresses ----
  for (const oldE of olds) {
    const existing = await db.suppression.findUnique({ where: { email: oldE } })
    if (existing) { audit.alreadySuppressed.push(oldE); continue }
    await db.suppression.create({ data: { email: oldE, reason: 'BOUNCE', note: 'kloofstreet-2026-11 blast: domain cannot receive mail (no MX / Null MX), boss-ordered removal' } })
    audit.suppressed.push(oldE)
  }

  // ---- 3. other permanent failures from the blast ----
  const badRows = await db.emailLog.findMany({
    where: { campaign: { contains: 'kloofstreet' }, status: { in: ['FAILED', 'BOUNCED'] } },
    select: { toEmail: true, error: true },
  })
  const extra = new Map<string, string>()
  for (const r of badRows) {
    const e = (r.toEmail || '').toLowerCase().trim()
    if (!e || e in REPLACEMENTS) continue
    const err = r.error || ''
    if (!isHardFailure(err)) { if (err) audit.skippedSoft.push({ email: e, error: err.slice(0, 160) }); continue }
    if (!extra.has(e) || err.length > (extra.get(e) || '').length) extra.set(e, err)
  }
  for (const [email, err] of extra) {
    const existing = await db.suppression.findUnique({ where: { email } })
    if (existing) { audit.alreadySuppressed.push(email); continue }
    await db.suppression.create({ data: { email, reason: 'BOUNCE', note: `kloofstreet-2026-11 blast permanent failure: ${err.slice(0, 100)}` } })
    audit.suppressedExtras.push(email)
  }

  return NextResponse.json({ ok: true, audit })
}
