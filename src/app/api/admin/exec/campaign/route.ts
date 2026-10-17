import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { sendCampaignMail, normalizeCampaignFrom } from '@/lib/mailer'

// POST /api/admin/exec/campaign — send ONE campaign email through the platform
// engine to a recipient on the owner's own lists (ecosystem announcements to
// BlackBiz members etc.). Exec seat only. One recipient per call keeps every
// send individually logged in EmailLog, resumable from the caller, and safely
// inside request limits.
//
// body: { to, subject, body, from?, dryRun? }
//   to      recipient address (one per call)
//   subject email subject
//   body    plain text body (legal footer is attached by the engine)
//   from    optional identity on hustleportal.online; default BlackBiz <blackbiz@hustleportal.online>
//   dryRun  true -> validate + echo the resolved From without sending

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

export async function POST(req: Request) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let payload: { to?: string; subject?: string; body?: string; from?: string; dryRun?: boolean }
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

  if (payload.dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, to, from })
  }

  const r = await sendCampaignMail({ to, subject, body: text, from })
  await db.emailLog.create({
    data: {
      userId: gate.me.id,
      toEmail: to,
      subject: subject.slice(0, 180),
      body: text.slice(0, 4000),
      status: r.ok ? 'SENT' : 'FAILED',
      provider: 'PLATFORM',
      error: r.ok ? null : (r.error || 'send failed').slice(0, 500),
    },
  })

  if (!r.ok) {
    return NextResponse.json({ ok: false, to, error: r.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, to, from: r.via })
}
