import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getConfig, setConfig } from '@/lib/config'
import { isProbeEmail, isInternalEmail } from '@/lib/probe'
import { isExecEmail } from '@/lib/admin'

// ONE-SHOT OPS DOOR (Task 146/181/184/185 pattern, fifth lawful run).
// Boss order: "remove blondies from the list and all future mailing campaigns".
//
// READ  (GET  with the read token): dry run only. Returns the Blondie facts,
//       every kloofstreet campaign tag with its queue state, the live openers
//       with their greeting ground truth, and the suppression table state.
//       Touches nothing.
// WRITE (POST with the write token): one request, two jobs, then a lock:
//       1. Suppression: every blondie address found in the mail log goes on
//          the Suppression list (reason MANUAL). That list is law for the
//          queue engine at staging AND at send time, for the winback audience
//          and for the system blast audience — all future campaigns, forever.
//       2. Stage the pre-written kloofstreet follow-up as campaign queue
//          `kloofstreet-followup`, born PAUSED: one QUEUED row per opener
//          inbox (suppressed and internal addresses never enter), greeting
//          baked per row from what the first campaign actually called them,
//          sender/lane/look carried over from the original campaign state.
//          Nothing sends until the operator presses Start in the app.
//       A platformConfig marker records the run and refuses a second one.
//       The door is deleted right after use; the marker is the audit record.

const READ_TOKEN = 'kls-369fbb7c8de51c1fd2b630dc'
const WRITE_TOKEN = 'kls-29369ca3522a552e4705fed8'
const MARKER_KEY = 'ops_kloof_blondie_followup_2026_11_lock'

const FOLLOWUP_TAG = 'kloofstreet-followup'
const SUBJ_A = 'Your Kloof Street neighbours are claiming their profiles'

function followupBody(greetLine: string, company: string | null): string {
  const find = company ? `will they find ${company}?` : 'will they find you?'
  return [
    greetLine,
    '',
    'I emailed you a couple of weeks ago about Kloof Street being named the 22nd coolest street in the world, and the coolest in Africa. People are using kloofstreet.online to decide where to eat, shop and unwind before they even arrive on the street. When they do, ' + find,
    '',
    'Here is the short version of what I suggested:',
    '',
    'Already listed? Claim your profile. It takes about two minutes, it is free, and it puts you in control of how your business appears on the guide.',
    '',
    'Not listed yet? Click Get Listed on the same page and I will personally help you get started.',
    '',
    'And once you are on the guide, there is a full backoffice behind it, built for local businesses: customer management, newsletters, invoices, appointments and local business leads, all in one place. Your storefront on Kloof Street, your operations behind it.',
    '',
    "If you would rather chat for five minutes, reply with a good number and I will call you. The season is starting, and I want our street's businesses to be the ones people find.",
    '',
    'Claim your profile or get listed: https://www.kloofstreet.online/get-listed',
    '',
    'Either way, thank you for reading.',
    '',
    'Warm regards,',
    'Kloofstreet.online Team',
    '',
    'Not keen on emails from us? Reply "no thanks" and we won\u2019t mail you again.',
  ].join('\n')
}

function greetLineOf(body: string | null): string {
  const first = (body || '').split('\n')[0].trim()
  // The first campaign greeted each inbox either by name ("Hi Ameer,") or
  // with "Hi there,". Keep exactly that voice, comma included.
  return /^hi .+,?$/i.test(first) ? (first.endsWith(',') ? first : first + ',') : 'Hi there,'
}

async function collectFacts() {
  // Every kloofstreet campaign row, the Blondie hunt, the suppression state.
  const [logs, blondieLogs, blondieLead, blondieUser, blondieClient, suppression, states, marker] = await Promise.all([
    db.emailLog.findMany({
      where: { campaign: { contains: 'kloofstreet' } },
      select: { toEmail: true, campaign: true, status: true, openCount: true, openedAt: true, subject: true, body: true, createdAt: true, leadId: true },
      orderBy: { createdAt: 'desc' },
      take: 400,
    }),
    db.emailLog.findMany({
      where: { toEmail: { contains: 'blondie' } },
      select: { toEmail: true, campaign: true, status: true, openCount: true, openedAt: true },
    }),
    db.lead.findFirst({ where: { OR: [{ company: { contains: 'blondie' } }, { email: { contains: 'blondie' } }] }, select: { id: true, company: true, email: true, stage: true, notes: true, phone: true } }),
    db.user.findFirst({ where: { OR: [{ businessName: { contains: 'blondie' } }, { name: { contains: 'blondie' } }, { email: { contains: 'blondie' } }] }, select: { id: true, email: true, name: true, businessName: true, accountStatus: true } }),
    db.client.findFirst({ where: { OR: [{ company: { contains: 'blondie' } }, { name: { contains: 'blondie' } }, { email: { contains: 'blondie' } }] }, select: { id: true, name: true, email: true } }),
    db.suppression.findMany({ select: { email: true, reason: true, note: true } }),
    db.platformConfig.findMany({ where: { key: { startsWith: 'campaign_state:kloofstreet' } }, select: { key: true, value: true } }),
    getConfig(MARKER_KEY),
  ])

  // Openers: dedupe by inbox, keep the max openCount and the newest body
  // (the body first line is the greeting ground truth).
  const inboxes = new Map<string, { opens: number; rows: number; greeting: string; lastAt: string; campaign: string | null; leadId: string | null }>()
  const tagCounts = new Map<string, number>()
  for (const l of logs) {
    tagCounts.set(l.campaign || '?', (tagCounts.get(l.campaign || '?') || 0) + 1)
    const k = l.toEmail.toLowerCase().trim()
    const cur = inboxes.get(k) || { opens: 0, rows: 0, greeting: 'Hi there,', lastAt: '', campaign: null, leadId: null }
    cur.rows += 1
    cur.opens += l.openCount || 0
    if (l.body) cur.greeting = greetLineOf(l.body)
    if (String(l.createdAt) > cur.lastAt) { cur.lastAt = String(l.createdAt); cur.campaign = l.campaign; cur.leadId = l.leadId }
    inboxes.set(k, cur)
  }
  const openers = [...inboxes.entries()].filter(([, v]) => v.opens > 0)

  // Company ground truth by EMAIL (the blast rows mostly carry no leadId, so
  // the lead join goes through the address, same law as the Task 185 pack).
  const openerEmails = openers.map(([email]) => email)
  const leadRowsByEmail = openerEmails.length > 0
    ? await db.lead.findMany({ where: { email: { in: openerEmails } }, select: { id: true, company: true, email: true } })
    : []
  const leadByEmail = new Map(leadRowsByEmail.map((l) => [(l.email || '').toLowerCase().trim(), l]))

  return {
    blondie: {
      mailRows: blondieLogs,
      lead: blondieLead,
      user: blondieUser,
      client: blondieClient,
      alreadySuppressed: suppression.filter((s) => s.email.includes('blondie')),
    },
    campaigns: [...tagCounts.entries()].map(([tag, rows]) => ({ tag, rows })),
    queueStates: states.map((s) => ({ key: s.key, value: s.value })),
    suppression: { total: suppression.length, rows: suppression },
    openers: {
      uniqueInboxes: inboxes.size,
      openerInboxes: openers.length,
      totalOpens: openers.reduce((a, [, v]) => a + v.opens, 0),
      list: openers.map(([email, v]) => ({
        email,
        opens: v.opens,
        greeting: v.greeting,
        company: leadByEmail.get(email)?.company ?? null,
      })).sort((a, b) => b.opens - a.opens),
    },
    marker: marker ? 'RUN ALREADY' : null,
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (token !== READ_TOKEN) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json({ ok: true, facts: await collectFacts() })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'read failed' }, { status: 500 })
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (token !== WRITE_TOKEN) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Single-run lock: a second hit reports and changes nothing.
  const existing = await getConfig(MARKER_KEY)
  if (existing) {
    return NextResponse.json({ ok: true, alreadyRun: true, marker: existing })
  }

  const summary: Record<string, unknown> = { ranAt: new Date().toISOString() }

  // ---- 1. Suppression: every blondie address the mail log has ever seen ----
  const blondieEmails = [...new Set(
    (await db.emailLog.findMany({
      where: { toEmail: { contains: 'blondie' } },
      select: { toEmail: true },
    })).map((r) => r.toEmail.toLowerCase().trim()).filter((e) => e.includes('@')),
  )]
  const suppressedNow: string[] = []
  for (const email of blondieEmails) {
    const was = await db.suppression.findUnique({ where: { email } })
    if (was) { suppressedNow.push(`${email} (already, ${was.reason})`); continue }
    await db.suppression.create({
      data: {
        email,
        reason: 'MANUAL',
        note: 'Blondie Bar: boss removed from the list and all future mailing campaigns (10 Nov 2026). Prior decline on record.',
      },
    })
    suppressedNow.push(`${email} (created)`)
  }
  summary.suppressed = suppressedNow

  // ---- 2. Stage the born-paused follow-up queue ----
  const exec = await db.user.findFirst({
    where: { OR: [{ role: 'ADMIN' }, { platformAdmin: true }] },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!exec) return NextResponse.json({ ok: false, error: 'no exec seat found' }, { status: 500 })

  const logs = await db.emailLog.findMany({
    where: { campaign: { contains: 'kloofstreet' }, openCount: { gt: 0 } },
    select: { toEmail: true, openCount: true, body: true, createdAt: true, leadId: true },
    orderBy: { createdAt: 'desc' },
    take: 400,
  })

  // Sender/lane/look carried from the original campaign's queue state.
  const origStateRow = await db.platformConfig.findFirst({
    where: { key: { startsWith: 'campaign_state:kloofstreet' } },
    select: { key: true, value: true },
  })
  let orig: { from?: string; provider?: string; theme?: string } = {}
  try { orig = origStateRow ? JSON.parse(origStateRow.value) : {} } catch { orig = {} }

  const suppressedRows = await db.suppression.findMany({ select: { email: true } })
  const dead = new Set(suppressedRows.map((s) => s.email.toLowerCase().trim()))

  const byInbox = new Map<string, { opens: number; body: string | null; leadId: string | null; lastAt: string }>()
  for (const l of logs) {
    const k = l.toEmail.toLowerCase().trim()
    const cur = byInbox.get(k) || { opens: 0, body: null as string | null, leadId: null as string | null, lastAt: '' }
    cur.opens += l.openCount || 0
    if (l.body) cur.body = l.body
    if (String(l.createdAt) > cur.lastAt) { cur.lastAt = String(l.createdAt); cur.leadId = l.leadId }
    byInbox.set(k, cur)
  }

  const leadRowsByEmail = [...byInbox.keys()].length > 0
    ? await db.lead.findMany({ where: { email: { in: [...byInbox.keys()] } }, select: { id: true, company: true, email: true } })
    : []
  const leadByEmail = new Map(leadRowsByEmail.map((l) => [(l.email || '').toLowerCase().trim(), l]))

  const alreadyRows = await db.emailLog.findMany({
    where: { campaign: FOLLOWUP_TAG, status: { in: ['QUEUED', 'SENT'] } },
    select: { toEmail: true },
  })
  const already = new Set(alreadyRows.map((r) => r.toEmail.toLowerCase().trim()))

  const toStage: { email: string; greet: string; company: string | null; opens: number; leadId: string | null }[] = []
  for (const [email, v] of byInbox) {
    if (dead.has(email)) continue // suppression is law, this includes Blondie
    if (isProbeEmail(email) || isInternalEmail(email) || isExecEmail(email)) continue
    if (already.has(email)) continue
    const lead = leadByEmail.get(email)
    toStage.push({ email, greet: greetLineOf(v.body), company: lead?.company ?? null, opens: v.opens, leadId: lead?.id ?? v.leadId })
  }
  toStage.sort((a, b) => b.opens - a.opens)

  if (toStage.length > 0) {
    await db.emailLog.createMany({
      data: toStage.map((r) => ({
        userId: exec.id,
        toEmail: r.email,
        subject: SUBJ_A,
        body: followupBody(r.greet, r.company),
        status: 'QUEUED',
        provider: 'PLATFORM',
        campaign: FOLLOWUP_TAG,
        leadId: r.leadId,
      })),
    })
  }

  // Born PAUSED. The draft gate is structural: nothing moves until Start.
  const state = {
    status: 'PAUSED',
    perHour: 45,
    from: orig.from || 'hello@hustleportal.online',
    provider: orig.provider === 'SES' ? 'SES' : 'RESEND',
    theme: orig.theme,
    createdAt: new Date().toISOString(),
  }
  await setConfig(`campaign_state:${FOLLOWUP_TAG}`, JSON.stringify(state))

  summary.queue = {
    tag: FOLLOWUP_TAG,
    staged: toStage.length,
    skippedSuppressed: [...byInbox.keys()].filter((e) => dead.has(e)).length,
    state,
    rows: toStage.map((r) => ({ email: r.email, greet: r.greet, company: r.company, opens: r.opens })),
  }

  await setConfig(MARKER_KEY, JSON.stringify({
    ranAt: summary.ranAt,
    suppressed: suppressedNow,
    staged: toStage.length,
    tag: FOLLOWUP_TAG,
    note: 'Blondie Bar suppressed from all future campaigns; kloofstreet-followup queue staged PAUSED with the pre-written follow up email.',
  }))

  return NextResponse.json({ ok: true, summary })
}
