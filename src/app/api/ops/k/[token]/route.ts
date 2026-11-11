import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getConfig, setConfig } from '@/lib/config'
import { writeCampaignState, readCampaignStates, type CampaignState } from '@/lib/campaignqueue'
import { recipientFirstName, fillForRecipient, tokenizeDraft } from '@/lib/campaignpersonal'

// ONE-SHOT OPS DOOR (Task 146/181/184/186/189/192 pattern, eighth lawful run).
// Boss order: "lets do a draft email" to Yindee's owner — the follow-up to the
// quote already shared, carrying the demonstration page
// https://www.kloofstreet.online/yindees, thanking him for his time and for
// meeting with Mr. Jacob yesterday. Through the main account.
//
// READ  (GET, read token): dry run only. The lead, its current greeting name,
//       suppression + duplicate checks, the original kloofstreet-2026-11
//       sender identity (the follow-up rides the exact same From), and the
//       letter preview filled as the owner will receive it. Touches nothing.
// WRITE (POST, write token): one request, then a lock:
//       1. The lead's contactName becomes "Nirun" ONLY while it is empty
//          (owner of Yindee's, web-sourced: TimesLive 2020 + Royal Orchid
//          2025 both name him Nirun; never overwrites a name the boss set).
//       2. Queue kloofstreet-yindees-followup staged BORN PAUSED on the exec
//          lane: one recipient (the lead attached), master draft on the state
//          carrying {first_name} — the Task 194 law — From copied from the
//          original kloofstreet-2026-11 queue, RESEND lane, 45/hour.
//       Nothing sends until Start is pressed by a human who saw the draft.
//       A platformConfig marker records the run and refuses a second one.

const READ_TOKEN = '9d07a183f1eda186358df9292b4631d363e191d7c7d62274'
const WRITE_TOKEN = '3d53689646cd2457f40fbbe98cdb12c1f1d66fe04af84a37'
const MARKER_KEY = 'ops_yindees_followup_2026_11_lock'

const SOURCE_CAMPAIGN = 'kloofstreet-2026-11'
const TAG = 'kloofstreet-yindees-followup'
const LEAD_ID = 'cmvp9njat001zjv08cwy01msg'
const OWNER_EMAIL = 'yindees.capetown@gmail.com'
const OWNER_FIRST_NAME = 'Nirun'
const PER_HOUR = 45
const FALLBACK_FROM = 'Kloofstreet.online <hello@hustleportal.online>'

const SUBJECT = 'A first look at Yindee\'s on Kloof Street'

const BODY = [
  'Hi {first_name},',
  '',
  'Thank you for the time yesterday, and for meeting with Mr. Jacob. It was a pleasure.',
  '',
  'As promised, here is the first look: https://www.kloofstreet.online/yindees',
  '',
  'What you will see is a demonstration page, an example of how Yindee\'s will appear on KloofStreet.online. Treat it as a foundation to build on, not the finished thing. It already carries your story, your menu with prices, your cocktails and wines, your hours and your contact details, all in one place for the people deciding where to eat on the street before they arrive.',
  '',
  'Now we make it yours. Tell us what to keep, what to change and what to add. Send your own photos, your full menu, the dishes you are proud of, and we shape the page around them.',
  '',
  'The quote we shared is unchanged. This page simply shows you where it starts. Kloof Street gets discovered online every day, and when someone looks for the best Thai food on the street, this page makes sure they find you first.',
  '',
  'Have a look, and simply reply to this email with your thoughts. You reach us directly.',
  '',
  'Warm regards,',
  'Kloofstreet.online Team',
  '',
  'Not keen on emails from us? Reply "no thanks" and we won\'t mail you again.',
].join('\n')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function deny() {
  return NextResponse.json({ error: 'Not found.' }, { status: 404 })
}

/** The exec account that owns the original kloofstreet blast: the main lane. */
async function execUser() {
  const sample = await db.emailLog.findFirst({
    where: { campaign: SOURCE_CAMPAIGN },
    select: { userId: true },
    orderBy: { createdAt: 'desc' },
  })
  if (sample?.userId) {
    const u = await db.user.findUnique({
      where: { id: sample.userId },
      select: { id: true, email: true, name: true, businessName: true, role: true, platformAdmin: true },
    })
    if (u) return u
  }
  return db.user.findUnique({
    where: { email: 'ceo@businesshustle.co.za' },
    select: { id: true, email: true, name: true, businessName: true, role: true, platformAdmin: true },
  })
}

async function facts() {
  const lead = await db.lead.findUnique({
    where: { id: LEAD_ID },
    select: { id: true, email: true, contactName: true, company: true, stage: true, notes: true, userId: true, unlocked: true },
  })
  if (!lead || lead.email?.toLowerCase() !== OWNER_EMAIL) {
    return { error: `Lead ${LEAD_ID} not found or no longer ${OWNER_EMAIL} — aborting.`, lead }
  }
  const [suppressed, existingRows, exec, states] = await Promise.all([
    db.suppression.findMany({ where: { email: OWNER_EMAIL }, select: { email: true } }),
    db.emailLog.findMany({ where: { campaign: TAG, status: { in: ['QUEUED', 'SENT'] } }, select: { id: true, toEmail: true, status: true } }),
    execUser(),
    readCampaignStates(),
  ])
  const source = states[SOURCE_CAMPAIGN]
  const from = source?.from || FALLBACK_FROM
  // The preview fills the name the OWNER WILL HAVE after the write: the stamp
  // lands first, so the row greets Nirun, never the company or "there".
  const greetingName = recipientFirstName(lead.contactName) || OWNER_FIRST_NAME
  const filledName = greetingName || 'there'
  return {
    mode: 'DRY RUN — nothing touched',
    lead: { id: lead.id, email: lead.email, company: lead.company, contactName: lead.contactName, stage: lead.stage, notes: lead.notes, unlocked: lead.unlocked },
    namePlan: lead.contactName?.trim() ? { action: 'keep existing name', greeting: greetingName || 'there' } : { action: `stamp contactName "${OWNER_FIRST_NAME}"`, greeting: OWNER_FIRST_NAME },
    checks: {
      suppressed: suppressed.length > 0,
      alreadyQueuedOrSentUnderTag: existingRows.length,
      emailFormatOk: EMAIL_RE.test(OWNER_EMAIL),
    },
    exec: exec ? { id: exec.id, email: exec.email, name: exec.name, role: exec.role, platformAdmin: exec.platformAdmin } : null,
    sourceCampaign: { tag: SOURCE_CAMPAIGN, from, status: source?.status || null, personalize: source?.personalize ?? null },
    queuePlan: {
      tag: TAG,
      status: 'PAUSED (born paused — Start is the boss press)',
      perHour: PER_HOUR,
      provider: 'RESEND',
      from,
      personalize: true,
      masterDraftCarries: '{first_name} (Task 194 law, tokens intact for Edit-draft)',
    },
    preview: {
      subject: fillForRecipient(SUBJECT, filledName, OWNER_EMAIL),
      bodyHead: fillForRecipient(BODY, filledName, OWNER_EMAIL).split('\n').slice(0, 8).join('\n'),
    },
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (token !== READ_TOKEN) return deny()
  try {
    return NextResponse.json(await facts())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'read failed' }, { status: 500 })
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (token !== WRITE_TOKEN) return deny()
  const marker = await getConfig(MARKER_KEY)
  if (marker) {
    return NextResponse.json({ error: 'One-shot law: this door already ran.', run: marker }, { status: 409 })
  }

  const lead = await db.lead.findUnique({ where: { id: LEAD_ID }, select: { id: true, email: true, contactName: true, company: true, notes: true } })
  if (!lead || lead.email?.toLowerCase() !== OWNER_EMAIL) {
    return NextResponse.json({ error: `Lead ${LEAD_ID} not found or no longer ${OWNER_EMAIL} — nothing was done.` }, { status: 404 })
  }
  const exec = await execUser()
  if (!exec) {
    return NextResponse.json({ error: 'No exec account resolved from the original kloofstreet queue — nothing was done.' }, { status: 404 })
  }
  const [suppressedRows, existingRows, states] = await Promise.all([
    db.suppression.findMany({ where: { email: OWNER_EMAIL }, select: { email: true } }),
    db.emailLog.findMany({ where: { campaign: TAG, toEmail: OWNER_EMAIL, status: { in: ['QUEUED', 'SENT'] } }, select: { id: true } }),
    readCampaignStates(),
  ])
  if (suppressedRows.length > 0) {
    return NextResponse.json({ error: `${OWNER_EMAIL} sits on the suppression register — the queue engine would refuse the send. Nothing was done.` }, { status: 409 })
  }
  if (existingRows.length > 0) {
    return NextResponse.json({ error: `${OWNER_EMAIL} already has a QUEUED or SENT row under ${TAG}. Nothing was done.` }, { status: 409 })
  }
  const from = states[SOURCE_CAMPAIGN]?.from || FALLBACK_FROM

  const report: Record<string, unknown> = { campaign: TAG, lead: lead.id, exec: exec.email }

  // 1. The greeting name, only while the lead carries none.
  if (!(lead.contactName || '').trim()) {
    await db.lead.update({
      where: { id: lead.id },
      data: {
        contactName: OWNER_FIRST_NAME,
        notes: [lead.notes, `Owner first name ${OWNER_FIRST_NAME} (web sourced: TimesLive 2020, Royal Orchid 2025)`].filter(Boolean).join(' | '),
      },
    })
    report.nameStamp = `contactName set to "${OWNER_FIRST_NAME}" (was empty)`
  } else {
    report.nameStamp = `kept existing contactName "${lead.contactName}"`
  }

  // 2. The row, born QUEUED under a PAUSED queue. The greeting fills from the
  //    lead's own name — the Task 194 law, per row, never the sender's name.
  const greetingName = recipientFirstName(OWNER_FIRST_NAME)
  const master = tokenizeDraft(SUBJECT, BODY)
  await db.emailLog.createMany({
    data: [{
      userId: exec.id,
      toEmail: OWNER_EMAIL,
      subject: fillForRecipient(master.subject, greetingName, OWNER_EMAIL).slice(0, 180),
      body: fillForRecipient(master.body, greetingName, OWNER_EMAIL).slice(0, 4000),
      status: 'QUEUED',
      provider: 'PLATFORM',
      campaign: TAG,
      leadId: lead.id,
    }],
  })
  report.row = {
    to: OWNER_EMAIL,
    greetsAs: greetingName,
    subject: fillForRecipient(master.subject, greetingName, OWNER_EMAIL),
    leadAttached: true,
  }

  // 3. The queue state: master draft with the token, born PAUSED, exec lane.
  const state: CampaignState = {
    status: 'PAUSED',
    perHour: PER_HOUR,
    from,
    provider: 'RESEND',
    draft: { subject: master.subject, body: master.body },
    personalize: true,
    createdAt: new Date().toISOString(),
  }
  await writeCampaignState(TAG, state)
  report.state = {
    status: state.status,
    perHour: state.perHour,
    from: state.from,
    provider: state.provider,
    personalize: state.personalize,
    draftHasToken: state.draft?.body.includes('{first_name}') || false,
    ownerUserId: 'none (exec lane, the main account)',
  }

  await setConfig(MARKER_KEY, JSON.stringify({ ranAt: new Date().toISOString(), campaign: TAG, queued: 1 }))
  report.locked = MARKER_KEY
  return NextResponse.json({ ok: true, ...report })
}
