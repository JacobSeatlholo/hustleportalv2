import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { sendCampaignMail, normalizeCampaignFrom } from '@/lib/mailer'

// Campaign mail for the owner's own lists (ecosystem announcements).
// POST /api/admin/exec/campaign — send ONE email, exec seat only.
// GET  /api/admin/exec/campaign — the read-out: every campaign send with its
//       open time and the lead's pipeline stage, so the team can see who read
//       what and when and move contacts from NEW to CONTACTED.
//
// POST body: { to, subject, body, from?, campaign?, leadId?, dryRun? }
// Each live send writes an EmailLog row first (DRAFT), sends with an open
// tracking pixel bound to that row, then stamps SENT / FAILED on it.

const WINDOW_MS = 60 * 60_000
const MAX_PER_WINDOW = 120
const bucket = new Map<string, number[]>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const hits = (bucket.get(key) || []).filter((t) => now - t < WINDOW_MS)
  bucket.set(key, hits.concat([now]))
  return hits.length >= MAX_PER_WINDOW
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const APP_BASE = 'https://www.hustleportal.online'

export async function POST(req: Request) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let payload: { to?: string; subject?: string; body?: string; from?: string; campaign?: string; leadId?: string; dryRun?: boolean }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const to = payload.to?.trim().toLowerCase() || ''
  const subject = payload.subject?.trim() || ''
  const text = payload.body || ''
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: 'A valid recipient email is required.' }, { status: 400 })
  }
  if (!subject) {
    return NextResponse.json({ error: 'Subject is required.' }, { status: 400 })
  }
  if (text.trim().length < 20) {
    return NextResponse.json({ error: 'Body is required.' }, { status: 400 })
  }
  if (rateLimited(gate.me.id)) {
    return NextResponse.json({ error: 'Campaign rate limit reached (120 sends per hour).' }, { status: 429 })
  }

  const from = normalizeCampaignFrom(payload.from)
  const campaign = payload.campaign?.trim().slice(0, 60) || 'generic'

  // The lead this contact lives on (pipeline move NEW -> CONTACTED on open).
  let leadId: string | null = null
  if (payload.leadId) {
    const lead = await db.lead.findUnique({ where: { id: payload.leadId }, select: { id: true } })
    if (!lead) return NextResponse.json({ error: 'leadId does not match any lead.' }, { status: 400 })
    leadId = lead.id
  }

  if (payload.dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, to, from, campaign, leadId })
  }

  // Log first so the tracking pixel can carry the log id.
  const log = await db.emailLog.create({
    data: {
      userId: gate.me.id,
      toEmail: to,
      subject: subject.slice(0, 180),
      body: text.slice(0, 4000),
      status: 'DRAFT',
      provider: 'PLATFORM',
      campaign,
      leadId,
    },
    select: { id: true },
  })

  const r = await sendCampaignMail({ to, subject, body: text, from, pixelUrl: `${APP_BASE}/api/mail/open/${log.id}` })
  await db.emailLog.update({
    where: { id: log.id },
    data: {
      status: r.ok ? 'SENT' : 'FAILED',
      error: r.ok ? null : (r.error || 'send failed').slice(0, 500),
    },
  })

  if (!r.ok) {
    return NextResponse.json({ ok: false, to, error: r.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, to, from: r.via, campaign, leadId, logId: log.id })
}

// GET — the visible read function. Per campaign: totals + every send with its
// open time and the linked lead's pipeline stage (NEW / CONTACTED / ...).
export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const rows = await db.emailLog.findMany({
    where: { campaign: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: {
      id: true,
      campaign: true,
      toEmail: true,
      subject: true,
      status: true,
      error: true,
      openedAt: true,
      openCount: true,
      createdAt: true,
      lead: { select: { id: true, company: true, stage: true } },
    },
  })

  const byCampaign: Record<string, { sent: number; failed: number; opened: number; total: number }> = {}
  for (const row of rows) {
    const c = (byCampaign[row.campaign as string] ||= { sent: 0, failed: 0, opened: 0, total: 0 })
    c.total++
    if (row.status === 'SENT') c.sent++
    if (row.status === 'FAILED') c.failed++
    if (row.openedAt) c.opened++
  }

  return NextResponse.json({ ok: true, summary: byCampaign, rows })
}
