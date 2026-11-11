import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { normalizeCampaignFrom, isSesConfigured } from '@/lib/mailer'
import { sanitizeBrand } from '@/lib/mailthemes'
import {
  readCampaignStates, writeCampaignState, unsubscribeUrl, type CampaignState,
} from '@/lib/campaignqueue'
import { systemBlastAudience } from '@/lib/audience'
import {
  recipientFirstName, tokenizeDraft, groupRefillWrites,
} from '@/lib/campaignpersonal'

/**
 * Campaign queues, the bulk path for outreach at real volume.
 *
 * POST   create a queue (recipients are staged as QUEUED rows; NOTHING sends
 *        until the operator presses Start, the draft gate is structural).
 *        followUp: true pulls the audience from a campaign that already ran
 *        (sourceCampaign + sourceFilter: opened | unopened | all) — the boss's
 *        own "add an email" on any queue. A new letter always re-arms the
 *        draft gate: an existing queue flips back to PAUSED until Start is
 *        pressed by a human who saw THIS draft.
 * GET    every campaign with its queue state and honest counters
 * PATCH  start / pause / resume / cancel a queue, removeRow to pull ONE
 *        queued email out of the list with a click, or editDraft to rewrite
 *        the letter (subject, body, sender, pace, look) on every still-QUEUED
 *        row — the boss's edit handle on a queue that already exists.
 *
 * Rows reuse EmailLog (status QUEUED | SENT | FAILED | BOUNCED | SKIPPED) so
 * the read receipts, open tracking and pipeline moves all keep working.
 *
 * Audience: `leads` (pipeline ids, same access wall as every lead action),
 * `emails` (raw pasted addresses) and `audience: 'system'` (every real
 * account on the platform under the audience law in src/lib/audience.ts:
 * the kloofstreet.online crew, internal seats, suspended and suppressed
 * addresses never enter; paying subscribers stay out unless skipPaying is
 * false). `personalize: true` fills {name} and {email} per recipient from
 * their account, so one draft greets every person by their own name.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_QUEUE = 5000
const MAX_HOURLY = 600
const DEFAULT_HOURLY = 45
// The looks a campaign letter can ride. One catalogue, validated wherever a
// draft is accepted (POST) or rewritten (PATCH editDraft).
const THEMES = ['boardroom', 'goldrush', 'nightshift', 'plain']

function slugTag(raw?: string): string {
  const s = (raw || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return s || 'campaign'
}

/** Re-personalize every QUEUED row from the master draft: the greeting name
 *  resolves from the account behind each address (first name, then business
 *  name; an unknown address rides "there"). Grouped writes — one updateMany
 *  per distinct filled copy. Same law as the member queues. */
async function refillQueuedRows(tag: string, master: { subject: string; body: string }): Promise<number> {
  const rows = await db.emailLog.findMany({
    where: { campaign: tag, status: 'QUEUED' },
    select: { id: true, toEmail: true },
  })
  if (rows.length === 0) return 0
  const accounts = await db.user.findMany({
    where: { email: { in: rows.map((r) => r.toEmail) } },
    select: { email: true, name: true, businessName: true },
  })
  const nameByEmail = new Map(accounts.map((u) => [u.email.toLowerCase(), recipientFirstName(u.name) || (u.businessName || '').trim()]))
  const groups = groupRefillWrites(rows, master, (r) => nameByEmail.get(r.toEmail.toLowerCase()) || '')
  let written = 0
  for (const g of groups) {
    const res = await db.emailLog.updateMany({
      where: { id: { in: g.ids }, status: 'QUEUED' },
      data: { subject: g.subject, body: g.body },
    })
    written += res.count
  }
  return written
}

export async function POST(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let payload: {
    campaign?: string; subject?: string; body?: string; from?: string; perHour?: number; provider?: string; theme?: string
    brand?: { name?: string; initials?: string; logoUrl?: string } | null
    leads?: string[]; emails?: string[]; audience?: string; skipPaying?: boolean; personalize?: boolean
    followUp?: boolean; sourceCampaign?: string; sourceFilter?: string
  }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tag = slugTag(payload.campaign)
  const subject = payload.subject?.trim() || ''
  const body = payload.body || ''
  if (!subject) return NextResponse.json({ error: 'Subject is required.' }, { status: 400 })
  if (body.trim().length < 20) return NextResponse.json({ error: 'Body is required.' }, { status: 400 })

  // A second batch joining a running campaign keeps the pace the operator
  // already chose, omitting perHour in the payload must never reset it.
  const states0 = await readCampaignStates()
  const existingState = states0[tag]
  const perHour = payload.perHour == null
    ? Math.max(1, Math.min(MAX_HOURLY, existingState?.perHour || DEFAULT_HOURLY))
    : Math.max(1, Math.min(MAX_HOURLY, Math.round(Number(payload.perHour) || DEFAULT_HOURLY)))
  const from = normalizeCampaignFrom(payload.from)

  // The transport lane. Omitted provider keeps the pace-preservation promise:
  // a second batch joining a live campaign never switches its pipe silently.
  const provider: 'RESEND' | 'SES' =
    payload.provider === 'SES' ? 'SES'
    : payload.provider === 'RESEND' ? 'RESEND'
    : existingState?.provider || 'RESEND'
  if (provider === 'SES' && !isSesConfigured()) {
    return NextResponse.json({ error: 'SES lane is not configured yet. Add the SES API keys to the environment first, or use the free lane.' }, { status: 400 })
  }

  // The look this batch rides (engine default when omitted) — the same
  // catalogue Edit draft offers, so a queue is born wearing what was picked.
  const theme = payload.theme == null || payload.theme === ''
    ? undefined
    : (THEMES.includes(String(payload.theme)) ? String(payload.theme) : undefined)
  if (payload.theme != null && payload.theme !== '' && !theme) {
    return NextResponse.json({ error: 'Unknown look. Use boardroom, goldrush, nightshift or plain.' }, { status: 400 })
  }

  // The sender's own brand (logo/initials/name) — undefined leaves whatever
  // the queue already wears alone, null strips it back to the BH chrome.
  const brand = payload.brand === undefined
    ? undefined
    : (payload.brand === null ? null : sanitizeBrand(payload.brand))
  if (payload.brand != null && !brand) {
    return NextResponse.json({ error: 'Brand needs a business name (max 48 characters).' }, { status: 400 })
  }

  // Recipients from pipeline leads, same access wall as every lead action.
  const leadIds = Array.isArray(payload.leads) ? payload.leads.filter((x) => typeof x === 'string' && x.length > 5) : []
  const memberships = await db.teamMember.findMany({ where: { userId: gate.me.id }, select: { teamId: true } })
  const teamIds = memberships.map((m) => m.teamId)
  const wanted = new Map<string, { email: string; leadId: string | null }>()
  if (leadIds.length > 0) {
    const leads = await db.lead.findMany({
      where: { id: { in: leadIds }, OR: [{ userId: gate.me.id }, { teamId: { in: teamIds } }] },
      select: { id: true, email: true },
    })
    for (const l of leads) {
      const email = l.email?.trim().toLowerCase()
      if (email && EMAIL_RE.test(email)) wanted.set(email, { email, leadId: l.id })
    }
  }
  // Raw pasted addresses, honest about the ones that never stood a chance.
  const invalid: string[] = []
  for (const raw of Array.isArray(payload.emails) ? payload.emails : []) {
    const email = String(raw || '').trim().toLowerCase()
    if (!email) continue
    if (!EMAIL_RE.test(email)) {
      invalid.push(email.slice(0, 120))
      continue
    }
    if (!wanted.has(email)) wanted.set(email, { email, leadId: null })
  }
  // The whole platform, one tap: the audience law lives in one lib, the same
  // law the preview readout shows, so the counted number is the queued number.
  if (payload.audience === 'system') {
    const { rows } = await systemBlastAudience({ skipPaying: payload.skipPaying !== false })
    for (const r of rows) {
      if (!wanted.has(r.email)) wanted.set(r.email, { email: r.email, leadId: null })
    }
  }
  // Follow-up mode: the audience is pulled from a campaign that already ran —
  // the people it actually reached (its SENT rows), sliced by whether they
  // opened. This is the boss's own handle on "add an email to the kloofstreet
  // campaign": the list comes from the campaign's own history, so nobody gets
  // pasted by hand and no blast-exclusion law blocks the crew that already
  // knows the sender. Suppression is still checked here AND again at send time.
  const followUp = payload.followUp === true
  if (followUp && !payload.sourceCampaign?.trim()) {
    return NextResponse.json({ error: 'sourceCampaign is required when followUp is true.' }, { status: 400 })
  }
  const sourceTag = followUp ? slugTag(payload.sourceCampaign) : ''
  const sourceFilter: 'opened' | 'unopened' | 'all' =
    payload.sourceFilter === 'opened' || payload.sourceFilter === 'unopened' ? payload.sourceFilter : 'all'
  if (followUp) {
    const sentRows = await db.emailLog.findMany({
      where: { campaign: sourceTag, status: 'SENT' },
      select: { toEmail: true, openedAt: true },
    })
    if (sentRows.length === 0 && wanted.size === 0) {
      return NextResponse.json({ error: `Nothing was ever sent under ${sourceTag} — there is no audience to pull from. Paste addresses instead.` }, { status: 400 })
    }
    // One row per address; when an address appears twice, opened wins.
    // An empty history is not fatal on its own: pasted or lead addresses
    // already staged still carry the queue.
    if (sentRows.length > 0) {
      const reached = new Map<string, boolean>()
      for (const r of sentRows) reached.set(r.toEmail, reached.get(r.toEmail) || Boolean(r.openedAt))
      for (const [email, opened] of reached) {
        if (sourceFilter === 'opened' && !opened) continue
        if (sourceFilter === 'unopened' && opened) continue
        if (!wanted.has(email)) wanted.set(email, { email, leadId: null })
      }
    }
  }

  if (wanted.size === 0) {
    return NextResponse.json({ error: 'No valid recipients. Unlock contacts in Leads first, or paste addresses.' }, { status: 400 })
  }
  if (wanted.size > MAX_QUEUE) {
    return NextResponse.json({ error: `That is ${wanted.size} recipients. One queue carries at most ${MAX_QUEUE}.` }, { status: 400 })
  }

  const emails = [...wanted.keys()]
  const [suppressedRows, existingRows] = await Promise.all([
    db.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    // A follow-up under the SAME tag is a deliberate second touch: the SENT
    // rows it dedups against are email one, and email two is the point. Only
    // still-QUEUED rows are refused, so nobody holds two copies of the new
    // letter while the first is still pending. Any other queue keeps the
    // full law — QUEUED or SENT under the target tag means already covered.
    db.emailLog.findMany({
      where: { campaign: tag, toEmail: { in: emails }, status: followUp && tag === sourceTag ? 'QUEUED' : { in: ['QUEUED', 'SENT'] } },
      select: { toEmail: true },
    }),
  ])
  const suppressed = new Set(suppressedRows.map((r) => r.email))
  const already = new Set(existingRows.map((r) => r.toEmail))

  const toQueue = emails
    .filter((e) => !suppressed.has(e) && !already.has(e))
    .map((e) => ({ email: e, leadId: wanted.get(e)!.leadId }))

  if (toQueue.length === 0) {
    return NextResponse.json({
      ok: true,
      campaign: tag,
      queued: 0,
      skippedSuppressed: suppressedRows.filter((r) => !already.has(r.email)).length,
      skippedDuplicate: existingRows.length,
      invalid,
      note: 'Nothing new to queue, everyone on this list already has a send or a strike against them.',
    })
  }

  // One draft, greeted per person. The MASTER draft (tokens intact) rides on
  // the queue state, and every queued row gets its own filled copy: {name}
  // resolves from the account itself (first name, then business name),
  // unknown addresses fall back to a plain honest "there" so nothing reads
  // like a broken template. A flattened greeting in the operator's draft is
  // healed to {name} here, before it can ever flatten a queue.
  const personal = payload.personalize !== false
  const master = personal
    ? tokenizeDraft(subject, body)
    : { subject, body, healed: false }
  const namesByEmail = new Map<string, string>()
  if (personal && toQueue.length > 0) {
    const accounts = await db.user.findMany({
      where: { email: { in: toQueue.map((r) => r.email) } },
      select: { email: true, name: true, businessName: true },
    })
    for (const u of accounts) {
      namesByEmail.set(u.email.toLowerCase(), recipientFirstName(u.name) || (u.businessName || '').trim() || 'there')
    }
  }

  await db.emailLog.createMany({
    data: toQueue.map((r) => {
      const nm = namesByEmail.get(r.email) || 'there'
      return {
        userId: gate.me.id,
        toEmail: r.email,
        subject: (personal ? master.subject.replace(/\{name\}/g, nm).replace(/\{email\}/g, r.email) : subject).slice(0, 180),
        body: (personal ? master.body.replace(/\{name\}/g, nm).replace(/\{email\}/g, r.email) : body).slice(0, 4000),
        status: 'QUEUED',
        provider: 'PLATFORM',
        campaign: tag,
        leadId: r.leadId,
      }
    }),
  })

  // Queues are born PAUSED. The draft gate lives in the structure of the thing:
  // nothing can move until Start is pressed by a human who saw the draft.
  const existing: CampaignState = existingState || {
    status: 'PAUSED',
    perHour,
    from,
    createdAt: new Date().toISOString(),
  }
  // The follow-up gate: a new letter joining a queue that already ran (or is
  // still running) re-arms the draft gate — the queue goes back to PAUSED and
  // nothing sends until Start is pressed by a human who saw THIS draft.
  const reopened = followUp && existing.status !== 'PAUSED'
  const nextState: CampaignState = {
    ...existing,
    perHour,
    from,
    provider,
    ...(theme ? { theme } : {}),
    ...(brand !== undefined ? { brand: brand ?? undefined } : {}),
    ...(reopened ? { status: 'PAUSED' as const } : {}),
    // The master draft rides the state, so Edit-draft and Start always work
    // from the letter as written — never from a row's filled copy.
    ...(personal ? { draft: { subject: master.subject, body: master.body } } : {}),
    personalize: personal,
  }
  await writeCampaignState(tag, nextState)

  return NextResponse.json({
    ok: true,
    campaign: tag,
    queued: toQueue.length,
    personalized: personal && toQueue.length > 0,
    followUp,
    sourceTag: followUp ? sourceTag : undefined,
    reopened,
    skippedSuppressed: suppressedRows.filter((r) => !already.has(r.email)).length,
    skippedDuplicate: existingRows.length,
    invalid,
    state: nextState,
  })
}

export async function GET() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const [rows, states] = await Promise.all([
    db.emailLog.findMany({
      where: { campaign: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true, campaign: true, toEmail: true, subject: true, body: true, status: true, error: true,
        openedAt: true, openCount: true, sentAt: true, createdAt: true,
        // The look on record — the preview replays the exact send from it
        // (null rows rode the engine default, the client falls back).
        theme: true,
        lead: { select: { id: true, company: true, stage: true } },
      },
    }),
    readCampaignStates(),
  ])

  // Signed unsubscribe link per row, exec eyes only. The link every
  // recipient actually gets is baked into their email at send time.
  const rowsOut = rows.map((r) => ({ ...r, unsubUrl: unsubscribeUrl(r.id) }))

  const campaigns: Record<string, { queued: number; sent: number; failed: number; bounced: number; skipped: number; opened: number; total: number }> = {}
  for (const row of rows) {
    const tag = row.campaign as string
    const c = (campaigns[tag] ||= { queued: 0, sent: 0, failed: 0, bounced: 0, skipped: 0, opened: 0, total: 0 })
    c.total++
    if (row.status === 'QUEUED') c.queued++
    if (row.status === 'SENT') c.sent++
    if (row.status === 'FAILED') c.failed++
    if (row.status === 'BOUNCED') c.bounced++
    if (row.status === 'SKIPPED') c.skipped++
    if (row.openedAt) c.opened++
  }

  return NextResponse.json({
    ok: true,
    sesConfigured: isSesConfigured(),
    campaigns: Object.keys(campaigns).map((tag) => ({ tag, state: states[tag] || null, summary: campaigns[tag] })),
    rows: rowsOut,
  })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let payload: {
    campaign?: string; action?: string; rowId?: string
    // editDraft fields: rewrite the letter on every still-QUEUED row.
    subject?: string; body?: string; from?: string; perHour?: number; theme?: string
    brand?: { name?: string; initials?: string; logoUrl?: string } | null
  }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const tag = slugTag(payload.campaign)
  const action = payload.action || ''

  // One click, one email out of the queue. The row is never deleted: it flips
  // to SKIPPED with an honest note, so the archive still shows it existed and
  // the engine simply never sends it. Sent mail stays untouchable — history
  // does not get rewritten after the fact.
  if (action === 'removeRow') {
    const rowId = String(payload.rowId || '')
    if (!rowId) return NextResponse.json({ error: 'rowId is required.' }, { status: 400 })
    const row = await db.emailLog.findUnique({ where: { id: rowId }, select: { id: true, campaign: true, status: true, toEmail: true } })
    if (!row || row.campaign !== tag) {
      return NextResponse.json({ error: 'That email is not part of this campaign.' }, { status: 404 })
    }
    if (row.status !== 'QUEUED') {
      return NextResponse.json({ error: 'Only queued emails can be removed — this one has already left the queue.' }, { status: 400 })
    }
    await db.emailLog.update({
      where: { id: row.id },
      data: { status: 'SKIPPED', error: `Removed by operator · ${new Date().toISOString().slice(0, 10)}` },
    })
    const [queued, sent, failed, bounced, skipped] = await Promise.all([
      db.emailLog.count({ where: { campaign: tag, status: 'QUEUED' } }),
      db.emailLog.count({ where: { campaign: tag, status: 'SENT' } }),
      db.emailLog.count({ where: { campaign: tag, status: 'FAILED' } }),
      db.emailLog.count({ where: { campaign: tag, status: 'BOUNCED' } }),
      db.emailLog.count({ where: { campaign: tag, status: 'SKIPPED' } }),
    ])
    return NextResponse.json({
      ok: true,
      removed: row.toEmail,
      summary: { queued, sent, failed, bounced, skipped, opened: 0, total: queued + sent + failed + bounced + skipped },
    })
  }

  // Edit the draft of a queue that already exists: subject, body, sender,
  // pace, look. Every still-QUEUED row gets the new letter; rows that already
  // left (SENT / FAILED / BOUNCED / SKIPPED) are history and stay untouched —
  // the log never gets rewritten after the fact. Works paused or active: on
  // an active queue the engine simply picks the new draft up from the next
  // send on.
  if (action === 'editDraft') {
    const subject = typeof payload.subject === 'string' ? payload.subject.trim() : undefined
    const body = typeof payload.body === 'string' ? payload.body : undefined
    if (subject !== undefined && !subject) {
      return NextResponse.json({ error: 'Subject cannot be empty.' }, { status: 400 })
    }
    if (body !== undefined && body.trim().length < 20) {
      return NextResponse.json({ error: 'Body is too short — a real letter is at least 20 characters.' }, { status: 400 })
    }
    const nextPerHour = payload.perHour == null
      ? undefined
      : Math.max(1, Math.min(MAX_HOURLY, Math.round(Number(payload.perHour) || DEFAULT_HOURLY)))
    const nextFrom = payload.from === undefined ? undefined : normalizeCampaignFrom(payload.from)
    const nextTheme = payload.theme === undefined || payload.theme === null || payload.theme === ''
      ? undefined
      : (THEMES.includes(String(payload.theme)) ? String(payload.theme) : undefined)
    if (payload.theme != null && payload.theme !== '' && !nextTheme) {
      return NextResponse.json({ error: 'Unknown look. Use boardroom, goldrush, nightshift or plain.' }, { status: 400 })
    }
    // Brand: undefined = leave alone, null = strip back to the BH chrome,
    // object = set (sanitized; a brand without a name is refused).
    const nextBrand = payload.brand === undefined
      ? undefined
      : (payload.brand === null ? null : sanitizeBrand(payload.brand))
    if (payload.brand != null && !nextBrand) {
      return NextResponse.json({ error: 'Brand needs a business name (max 48 characters).' }, { status: 400 })
    }

    const statesNow = await readCampaignStates()
    const current = statesNow[tag]
    if (!current) {
      return NextResponse.json({ error: 'No queue exists under this campaign tag.' }, { status: 404 })
    }

    // THE SAVE LAW (same as the member queues): the saved letter becomes the
    // queue's master draft — tokens intact, a flattened greeting re-tokenized
    // to {name} — and every QUEUED row is re-greeted from it per account.
    // Saving is the repair door for a queue whose rows already carry one
    // flattened name; no rebuild needed.
    let updatedRows = 0
    let greetingHealed = false
    const next: CampaignState = { ...current }
    const masterSrcSubject = subject !== undefined ? subject : current.draft?.subject
    const masterSrcBody = body !== undefined ? body : current.draft?.body
    if (masterSrcSubject !== undefined && masterSrcBody !== undefined && masterSrcBody.trim().length >= 20) {
      const master = tokenizeDraft(masterSrcSubject, masterSrcBody)
      greetingHealed = master.healed
      updatedRows = await refillQueuedRows(tag, master)
      next.draft = { subject: master.subject, body: master.body }
      next.personalize = true
    } else {
      // Partial patch (or no letter to speak of): the legacy verbatim write.
      const data: { subject?: string; body?: string } = {}
      if (subject !== undefined) data.subject = subject.slice(0, 180)
      if (body !== undefined) data.body = body.slice(0, 4000)
      if (Object.keys(data).length > 0) {
        const res = await db.emailLog.updateMany({
          where: { campaign: tag, status: 'QUEUED' },
          data,
        })
        updatedRows = res.count
      }
    }

    if (nextFrom !== undefined) next.from = nextFrom
    if (nextPerHour !== undefined) next.perHour = nextPerHour
    if (payload.theme !== undefined) next.theme = nextTheme
    if (payload.brand !== undefined) next.brand = nextBrand ?? undefined
    await writeCampaignState(tag, next)

    return NextResponse.json({
      ok: true,
      campaign: tag,
      updatedRows,
      greetingHealed,
      queuedLeft: await db.emailLog.count({ where: { campaign: tag, status: 'QUEUED' } }),
      state: next,
      note: greetingHealed
        ? 'Greeting re-personalized: the salutation name was flattened onto every row — it now fills {name} per contact.'
        : (nextFrom !== undefined && nextFrom !== (payload.from || '').trim()
          ? 'Sender was normalized: the campaign domain carries the address (anything @hustleportal.online).'
          : undefined),
    })
  }

  // Openers -> leads: the read-receipt gold. Everyone who OPENED at least one
  // email under this campaign becomes a lead on the operator's own pipeline,
  // so the next wave (the introduction, the call list, the quote) can ride
  // the lead tools — stages, notes, tasks — instead of a raw email dump.
  // Idempotent by email: an address already on the pipeline is counted, not
  // duplicated, so the button can be pressed after every send.
  if (action === 'openersToLeads') {
    const rows = await db.emailLog.findMany({
      where: { campaign: tag, openedAt: { not: null } },
      select: { toEmail: true, lead: { select: { contactName: true, company: true } } },
    })
    const openers = new Map<string, { name: string | null; company: string | null }>()
    for (const r of rows) {
      openers.set(r.toEmail.toLowerCase(), {
        name: r.lead?.contactName?.trim() || null,
        company: r.lead?.company?.trim() || null,
      })
    }
    const emails = [...openers.keys()]
    if (emails.length === 0) {
      return NextResponse.json({ ok: true, found: 0, added: 0, existing: 0 })
    }
    const known = await db.lead.findMany({
      where: { userId: gate.me.id, email: { in: emails } },
      select: { email: true },
    })
    const knownSet = new Set(known.map((k) => (k.email || '').toLowerCase()))
    const fresh = emails.filter((e) => !knownSet.has(e))
    if (fresh.length > 0) {
      await db.lead.createMany({
        data: fresh.map((email) => {
          const o = openers.get(email)
          return {
            userId: gate.me.id,
            company: o?.company || 'Unknown',
            ...(o?.name ? { contactName: o.name } : {}),
            email,
            source: 'CAMPAIGN',
            stage: 'NEW',
            notes: `Opened a ${tag} email · pushed from campaign read receipts ${new Date().toISOString().slice(0, 10)}`,
          }
        }),
      })
    }
    return NextResponse.json({ ok: true, found: emails.length, added: fresh.length, existing: emails.length - fresh.length })
  }

  const states = await readCampaignStates()
  const current: CampaignState = states[tag] || {
    status: 'PAUSED',
    perHour: DEFAULT_HOURLY,
    createdAt: new Date().toISOString(),
  }

  if (action === 'start' || action === 'resume') {
    const queued = await db.emailLog.count({ where: { campaign: tag, status: 'QUEUED' } })
    if (queued === 0) {
      return NextResponse.json({ error: 'Nothing queued under this campaign. Create a queue first.' }, { status: 400 })
    }
    // THE FLATTENED-GREETING GATE (same as the member queues): no queue goes
    // live with one name on every row. Personalized queues refill from their
    // stored master draft; legacy queues get the greeting re-tokenized from
    // the first queued row. An explicit opt-out rides byte-identical.
    let greetingHealed = false
    if (current.personalize !== false) {
      let master = current.draft
      if (!master) {
        const first = await db.emailLog.findFirst({
          where: { campaign: tag, status: 'QUEUED' },
          orderBy: { createdAt: 'asc' },
          select: { subject: true, body: true },
        })
        if (first) {
          const t = tokenizeDraft(first.subject, first.body)
          master = { subject: t.subject, body: t.body }
          greetingHealed = t.healed
        }
      }
      if (master) {
        await refillQueuedRows(tag, master)
        current.draft = master
      }
    }
    const next: CampaignState = { ...current, status: 'ACTIVE', startedAt: current.startedAt || new Date().toISOString() }
    await writeCampaignState(tag, next)
    return NextResponse.json({ ok: true, campaign: tag, state: next, ...(greetingHealed ? { greetingHealed: true } : {}) })
  }

  if (action === 'pause') {
    const next: CampaignState = { ...current, status: 'PAUSED' }
    await writeCampaignState(tag, next)
    return NextResponse.json({ ok: true, campaign: tag, state: next })
  }

  if (action === 'cancel') {
    const stopped = await db.emailLog.updateMany({
      where: { campaign: tag, status: 'QUEUED' },
      data: { status: 'SKIPPED', error: 'Cancelled by operator' },
    })
    const next: CampaignState = { ...current, status: 'CANCELLED', completedAt: new Date().toISOString() }
    await writeCampaignState(tag, next)
    return NextResponse.json({ ok: true, campaign: tag, state: next, stopped: stopped.count })
  }

  return NextResponse.json({ error: 'Unknown action. Use start, pause, cancel, removeRow, editDraft or openersToLeads.' }, { status: 400 })
}
