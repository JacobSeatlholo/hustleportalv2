/**
 * Facilitated meetings, the owner's first business case engine.
 *
 * The boss sets a meeting between a member (Zola) and an outside guest (Ian).
 * The member confirms with one tap from the invite email; on confirmation both
 * parties get the final details and the Executive Dashboard counts it under
 * "Meetings set".
 *
 * All dates are shown in South African time (the platform's home ground).
 * Email copy rules: plain english, no emoji, honest claims only.
 */
import { gcalTemplateLink } from '@/lib/ics'
import type { IcsEvent } from '@/lib/ics'

export const APP_BASE =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://hustleportal.online'

export type MeetingLike = {
  id: string
  title: string
  memberName: string
  memberEmail: string
  memberBusiness?: string | null
  guestName?: string | null
  guestEmail: string
  startsAt: Date
  endsAt?: Date | null
  meetLink?: string | null
  location?: string | null
  notes?: string | null
}

const SAST = 'Africa/Johannesburg'

/** "Monday 19 October 2026" in South African time. */
export function meetingDay(d: Date): string {
  const s = new Intl.DateTimeFormat('en-ZA', {
    timeZone: SAST,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
  return s.replace(/^(\w+),\s*/, '$1 ')
}

/** "11:30" in South African time. */
export function meetingTime(d: Date): string {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: SAST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

/** "Monday 19 October 2026 at 11:30 (South African time)" */
export function meetingWhen(d: Date): string {
  return `${meetingDay(d)} at ${meetingTime(d)} (South African time)`
}

/** Meeting length in plain words, e.g. "about 60 minutes". */
export function meetingLength(startsAt: Date, endsAt?: Date | null): string {
  const mins = endsAt ? Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000) : 60
  return `about ${mins} minutes`
}

export function memberLabel(m: MeetingLike): string {
  return m.memberBusiness ? `${m.memberName} of ${m.memberBusiness}` : m.memberName
}

export function guestLabel(m: MeetingLike): string {
  return m.guestName ? `${m.guestName} (${m.guestEmail})` : m.guestEmail
}

export function confirmUrl(m: { confirmToken: string }): string {
  return `${APP_BASE}/api/meetings/confirm?token=${m.confirmToken}`
}

export function declineUrl(m: { confirmToken: string }): string {
  return `${APP_BASE}/api/meetings/decline?token=${m.confirmToken}`
}

export function addToCalendarLink(m: MeetingLike): string {
  const ev: IcsEvent = {
    uid: m.id,
    title: m.title,
    description: m.notes || undefined,
    location: m.location || undefined,
    startsAt: m.startsAt,
    endsAt: m.endsAt || undefined,
  }
  return gcalTemplateLink(ev)
}

/** The WHERE cell on every HTML page. A physical venue always wins; an
 *  online meeting shows the join link (or a promise of one). */
function whereCell(m: MeetingLike): string {
  if (m.location) {
    const backup = m.meetLink
      ? `<br/><span style="color:#a1a1aa;font-size:13px;">Online backup: <a href="${m.meetLink}" style="color:#f5c518;word-break:break-all;">join link</a></span>`
      : ''
    return `${escapeHtml(m.location)}${backup}`
  }
  return m.meetLink
    ? `Online. <a href="${m.meetLink}" style="color:#f5c518;word-break:break-all;">Join link</a>`
    : 'Online (link to follow)'
}

/** The WHERE line inside emails. */
function whereLine(m: MeetingLike): string {
  if (m.location) {
    return `WHERE: ${m.location}${m.meetLink ? ` (online backup: ${m.meetLink})` : ''}`
  }
  return `WHERE: Online. Join link: ${m.meetLink || 'to be confirmed'}`
}

function first(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there'
}

// ---------------------------------------------------------------- emails

/** Welcome email for an account the team just set up. Explains the password link, the R99 credit, and Google Calendar. */
export function welcomeEmail(info: {
  memberName: string
  memberBusiness?: string | null
  passwordUrl: string
  proposedWhen?: string | null
}): { subject: string; body: string } {
  const f = first(info.memberName)
  const subject = `Welcome to HustlePortal, ${f}, choose your password`
  const body = [
    `Hi ${f},`,
    '',
    'Good news. The Business Hustle team set up your HustlePortal account for you, so your business profile, wallet and calendar are ready to go.',
    ...(info.memberBusiness ? ['', `Your account is linked to ${info.memberBusiness}.`] : []),
    '',
    'CHOOSE YOUR PASSWORD (one tap, works for 48 hours):',
    info.passwordUrl,
    'Open the link, pick a password, and you are in. If the link expires, the "Forgot password" button on the sign in page gives you a fresh one.',
    '',
    'WHAT IS ALREADY WAITING FOR YOU',
    'Your wallet is loaded with R99 in lead credits. That is real finding power: the AI Lead Finder pulls verified businesses around you, ready to call. If a lead cannot be verified, you are not charged for it.',
    '',
    'CONNECT YOUR GOOGLE CALENDAR (two minutes)',
    '1. Sign in at ' + APP_BASE,
    '2. Open Integrations from the menu',
    '3. Scroll to Google Calendar and connect it',
    'Every meeting you save also carries a one tap "Add to Google Calendar" button, so nothing gets lost even before you connect.',
    ...(info.proposedWhen
      ? [
          '',
          'ONE MORE THING',
          `The team proposed a meeting for you: ${info.proposedWhen}.`,
          'A second email with the details and a one tap confirm button is on its way right now.',
        ]
      : []),
    '',
    'Stuck on anything? Just reply to this email. A human reads every reply.',
    '',
    'Go get paid,',
    'The HustlePortal team',
    'Business Hustle · businesshustle.co.za',
  ].join('\n')
  return { subject, body }
}

/** The proposal email: the details plus a one tap confirm. */
export function inviteEmail(m: MeetingLike & { confirmToken: string }): { subject: string; body: string } {
  const f = first(m.memberName)
  const subject = `Meeting proposed: ${meetingDay(m.startsAt)} at ${meetingTime(m.startsAt)}`
  const body = [
    `Hi ${f},`,
    '',
    'The Business Hustle team set up an introduction for you. Here are the details:',
    '',
    `WHAT: ${m.title}`,
    `WHEN: ${meetingWhen(m.startsAt)}, ${meetingLength(m.startsAt, m.endsAt)}`,
    `WITH: ${guestLabel(m)}`,
    whereLine(m),
    ...(m.notes ? ['', m.notes] : []),
    '',
    'IS THIS TIME GOOD FOR YOU?',
    `Confirm with one tap: ${confirmUrl(m)}`,
    '',
    'The moment you confirm, everyone gets the final details and the meeting is set.',
    `The time does not work? Tap here and we will find another: ${declineUrl(m)}`,
    '',
    'ADD TO YOUR CALENDAR NOW',
    `Google Calendar (one tap): ${addToCalendarLink(m)}`,
    '',
    'See you there,',
    'The HustlePortal team',
    'Business Hustle · businesshustle.co.za',
  ].join('\n')
  return { subject, body }
}

/** The "meeting is set" email both parties receive after confirmation. */
export function confirmedEmail(m: MeetingLike, recipientName: string): { subject: string; body: string } {
  const f = first(recipientName)
  const subject = `Your meeting is set: ${meetingDay(m.startsAt)} at ${meetingTime(m.startsAt)}`
  const body = [
    `Hi ${f},`,
    '',
    'Good news: the time works for everyone, so the meeting is set.',
    '',
    `WHAT: ${m.title}`,
    `WHEN: ${meetingWhen(m.startsAt)}, ${meetingLength(m.startsAt, m.endsAt)}`,
    `WHO: ${memberLabel(m)} (${m.memberEmail}) and ${guestLabel(m)}`,
    whereLine(m),
    ...(m.notes ? ['', m.notes] : []),
    '',
    'ADD TO YOUR CALENDAR',
    `Google Calendar (one tap): ${addToCalendarLink(m)}`,
    '',
    'Run late or need to move it? Reply to this email and the Business Hustle team will sort it out.',
    '',
    'Talk soon,',
    'The HustlePortal team',
    'Business Hustle · businesshustle.co.za',
  ].join('\n')
  return { subject, body }
}

/** Quiet note to the team inbox when the member declines. */
export function declinedEmail(m: MeetingLike): { subject: string; body: string } {
  const subject = `Meeting declined: ${memberLabel(m)} and ${guestLabel(m)}`
  const body = [
    `${memberLabel(m)} (${m.memberEmail}) declined the proposed time:`,
    '',
    `${m.title}`,
    meetingWhen(m.startsAt),
    `Guest: ${guestLabel(m)}`,
    '',
    'Find a new time on the Executive Dashboard under Meetings, then set a fresh meeting.',
  ].join('\n')
  return { subject, body }
}

/** Quiet note to the team inbox when the member confirms. */
export function confirmedExecEmail(m: MeetingLike): { subject: string; body: string } {
  const subject = `Meeting confirmed: ${memberLabel(m)} and ${guestLabel(m)}`
  const body = [
    'The member confirmed the time, so the meeting is set. Both parties have the details.',
    '',
    `${m.title}`,
    meetingWhen(m.startsAt),
    `${memberLabel(m)} (${m.memberEmail})`,
    `${guestLabel(m)}`,
    m.location ? `Venue: ${m.location}` : `Join link: ${m.meetLink || 'to be confirmed'}`,
    '',
    'It is live on your Executive Dashboard under Meetings.',
  ].join('\n')
  return { subject, body }
}

// ---------------------------------------------------------------- html pages

const PAGE_HEAD = (title: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${title}</title></head>
<body style="margin:0;background:#09090b;font-family:Arial,Helvetica,sans-serif;color:#fafafa;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
<div style="width:100%;max-width:520px;">`

const PAGE_FOOT = `
<p style="text-align:center;color:#71717a;font-size:12px;margin-top:24px;">HustlePortal · the Business OS for South African businesses · businesshustle.co.za</p>
</div></body></html>`

function detailRows(m: MeetingLike): string {
  const row = (label: string, value: string) =>
    `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #27272a;"><span style="width:64px;flex-shrink:0;color:#f5c518;font-weight:bold;font-size:12px;letter-spacing:1px;padding-top:2px;">${label}</span><span style="font-size:15px;line-height:1.5;">${value}</span></div>`
  return [
    row('WHAT', escapeHtml(m.title)),
    row('WHEN', `${escapeHtml(meetingWhen(m.startsAt))}<br/><span style="color:#a1a1aa;font-size:13px;">${escapeHtml(meetingLength(m.startsAt, m.endsAt))}</span>`),
    row('WITH', escapeHtml(guestLabel(m))),
    row('WHERE', whereCell(m)),
  ].join('')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The one tap page the invite email opens: confirm or step aside. */
export function confirmPage(m: MeetingLike & { confirmToken: string }): string {
  return `${PAGE_HEAD('Confirm your meeting')}
<div style="background:#111113;border:1px solid #27272a;border-radius:16px;padding:28px;">
  <p style="margin:0 0 4px;color:#f5c518;font-size:13px;font-weight:bold;letter-spacing:1px;">MEETING PROPOSED</p>
  <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;">${escapeHtml(memberLabel(m))}, is this time good for you?</h1>
  ${detailRows(m)}
  <form method="post" action="/api/meetings/confirm" style="margin:24px 0 12px;">
    <input type="hidden" name="token" value="${m.confirmToken}" />
    <button type="submit" style="width:100%;background:#f5c518;color:#09090b;border:0;border-radius:12px;padding:16px;font-size:16px;font-weight:bold;cursor:pointer;">Confirm, the time works</button>
  </form>
  <p style="text-align:center;color:#a1a1aa;font-size:13px;margin:0 0 20px;">One tap. ${escapeHtml(first(m.guestName || 'Ian'))} gets the details the moment you confirm.</p>
  <form method="post" action="/api/meetings/decline">
    <input type="hidden" name="token" value="${m.confirmToken}" />
    <button type="submit" style="width:100%;background:transparent;color:#a1a1aa;border:1px solid #3f3f46;border-radius:12px;padding:12px;font-size:14px;cursor:pointer;">The time does not work for me</button>
  </form>
  <p style="text-align:center;margin:20px 0 0;"><a href="${addToCalendarLink(m)}" style="color:#f5c518;font-size:13px;">Add to Google Calendar</a></p>
</div>${PAGE_FOOT}`
}

/** Shown after the confirm tap lands. */
export function confirmedPage(m: MeetingLike): string {
  return `${PAGE_HEAD('Meeting is set')}
<div style="background:#111113;border:1px solid #27272a;border-radius:16px;padding:28px;text-align:center;">
  <div style="width:56px;height:56px;border-radius:50%;background:#f5c518;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:28px;color:#09090b;font-weight:bold;">✓</div>
  <h1 style="margin:0 0 8px;font-size:24px;">Done. The meeting is set.</h1>
  <p style="margin:0 0 20px;color:#a1a1aa;font-size:14px;">${escapeHtml(meetingWhen(m.startsAt))} · ${escapeHtml(meetingLength(m.startsAt, m.endsAt))}</p>
  ${detailRows(m)}
  <p style="margin:20px 0 16px;color:#a1a1aa;font-size:14px;">Everyone has the details by email. Run late or need to move it? Reply to that email and the team will sort it out.</p>
  <a href="${addToCalendarLink(m)}" style="display:block;background:#f5c518;color:#09090b;border-radius:12px;padding:16px;font-size:16px;font-weight:bold;text-decoration:none;">Add to Google Calendar</a>
</div>${PAGE_FOOT}`
}

/** Shown when the link is opened after the meeting was already confirmed. */
export function alreadyConfirmedPage(m: MeetingLike): string {
  return `${PAGE_HEAD('Already confirmed')}
<div style="background:#111113;border:1px solid #27272a;border-radius:16px;padding:28px;text-align:center;">
  <h1 style="margin:0 0 8px;font-size:22px;">You already confirmed this one.</h1>
  <p style="margin:0 0 20px;color:#a1a1aa;font-size:14px;">No need to do it twice. The details are in your email.</p>
  ${detailRows(m)}
  <a href="${addToCalendarLink(m)}" style="display:block;background:#f5c518;color:#09090b;border-radius:12px;padding:16px;font-size:16px;font-weight:bold;text-decoration:none;margin-top:20px;">Add to Google Calendar</a>
</div>${PAGE_FOOT}`
}

/** Shown after the decline tap lands. */
export function declinedPage(m: MeetingLike): string {
  return `${PAGE_HEAD('No problem')}
<div style="background:#111113;border:1px solid #27272a;border-radius:16px;padding:28px;text-align:center;">
  <h1 style="margin:0 0 8px;font-size:22px;">No problem at all.</h1>
  <p style="margin:0 0 20px;color:#a1a1aa;font-size:14px;">The team knows the time did not work. Reply to the invite email with two or three times that suit you and they will set a fresh one.</p>
  ${detailRows(m)}
</div>${PAGE_FOOT}`
}

/** Shown when the token is unknown or the meeting was withdrawn. */
export function invalidTokenPage(): string {
  return `${PAGE_HEAD('Link not valid')}
<div style="background:#111113;border:1px solid #27272a;border-radius:16px;padding:28px;text-align:center;">
  <h1 style="margin:0 0 8px;font-size:22px;">This link is not valid anymore.</h1>
  <p style="margin:0;color:#a1a1aa;font-size:14px;">Open the latest meeting email for a fresh link, or just reply to it and the Business Hustle team will set the time with you directly.</p>
</div>${PAGE_FOOT}`
}

export const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' }

// ------------------------------------------------------- shared meeting page
//
// The owner hands one unguessable link (/m/<shareToken>) to BOTH parties,
// on WhatsApp, over email, however they talk. The page shows the appointment
// details and lets either side leave a note or propose a new time; the owner
// sees every update on the Executive Dashboard. Same visual language as the
// confirm pages, zero client JavaScript, thumb friendly.

export type SharedComment = {
  id: string
  side: string // MEMBER | GUEST
  authorName: string
  body: string
  createdAt: Date
}

/** The share link the owner copies out of the Meetings card. */
export function sharedUrl(shareToken: string): string {
  return `${APP_BASE}/m/${shareToken}`
}

function statusBanner(status: string): string {
  if (status === 'CONFIRMED')
    return `<div style="background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.4);color:#6ee7b7;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:bold;text-align:center;">MEETING IS SET</div>`
  if (status === 'DECLINED')
    return `<div style="background:rgba(113,113,122,.12);border:1px solid rgba(113,113,122,.4);color:#a1a1aa;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:bold;text-align:center;">THE PROPOSED TIME WAS DECLINED, PROPOSE A NEW ONE BELOW</div>`
  return `<div style="background:rgba(245,197,24,.1);border:1px solid rgba(245,197,24,.4);color:#f5c518;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:bold;text-align:center;">AWAITING CONFIRMATION</div>`
}

function msgBanner(msg: string): string {
  const map: Record<string, string> = {
    posted: 'Note posted. The other side has been emailed.',
    moved: 'New time proposed. Both parties have been emailed.',
    confirmed: 'Confirmed. The meeting is set and everyone has the details.',
    already: 'This meeting was already confirmed.',
    slow: 'Too many updates in a short while. Give it a few minutes and try again.',
    past: 'That time is in the past. Pick a time ahead of now.',
    declined: 'This meeting was declined. Propose a new time instead.',
    error: 'Something was missing in that form. Fill it in and try again.',
  }
  const text = map[msg]
  if (!text) return ''
  return `<div style="background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.35);color:#6ee7b7;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:16px;">${escapeHtml(text)}</div>`
}

function whoRows(m: MeetingLike): string {
  const row = (label: string, value: string) =>
    `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #27272a;"><span style="width:64px;flex-shrink:0;color:#f5c518;font-weight:bold;font-size:12px;letter-spacing:1px;padding-top:2px;">${label}</span><span style="font-size:15px;line-height:1.5;">${value}</span></div>`
  return [
    row('WHAT', escapeHtml(m.title)),
    row('WHEN', `${escapeHtml(meetingWhen(m.startsAt))}<br/><span style="color:#a1a1aa;font-size:13px;">${escapeHtml(meetingLength(m.startsAt, m.endsAt))}</span>`),
    row('MEMBER', `${escapeHtml(memberLabel(m))}<br/><span style="color:#a1a1aa;font-size:13px;">${escapeHtml(m.memberEmail)}</span>`),
    row('GUEST', `${escapeHtml(guestLabel(m))}`),
    row('WHERE', whereCell(m)),
    ...(m.notes ? [row('NOTES', escapeHtml(m.notes))] : []),
  ].join('')
}

function commentThread(comments: SharedComment[]): string {
  if (!comments.length) {
    return `<p style="color:#a1a1aa;font-size:13px;margin:8px 0 0;">No notes yet. Anything either of you wants to change or add, post it here.</p>`
  }
  const rows = comments.map((c) => {
    const when = new Intl.DateTimeFormat('en-ZA', {
      timeZone: SAST, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(c.createdAt)
    return `<div style="border:1px solid #27272a;border-radius:12px;padding:12px 14px;margin-top:10px;background:#0d0d0f;">
  <div style="font-size:12px;color:#f5c518;font-weight:bold;">${escapeHtml(c.authorName)} <span style="color:#71717a;font-weight:normal;">· ${escapeHtml(when)} SAST</span></div>
  <div style="font-size:14px;line-height:1.5;margin-top:4px;white-space:pre-wrap;">${escapeHtml(c.body)}</div>
</div>`
  })
  return rows.join('')
}

/** The full shared page: details, updates, and the actions either side may take. */
export function sharedPageHtml(
  m: MeetingLike & { shareToken: string; status: string },
  comments: SharedComment[],
  msg = '',
): string {
  const token = m.shareToken
  const canConfirm = m.status === 'PROPOSED'
  return `${PAGE_HEAD('Meeting: ' + m.title)}
<div style="background:#111113;border:1px solid #27272a;border-radius:16px;padding:24px;">
  ${statusBanner(m.status)}
  <div style="margin-top:18px;">${whoRows(m)}</div>
  ${msgBanner(msg)}
  <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
    <a href="${addToCalendarLink(m)}" style="flex:1;min-width:200px;text-align:center;background:#f5c518;color:#09090b;border-radius:12px;padding:14px;font-size:15px;font-weight:bold;text-decoration:none;">Add to Google Calendar</a>
  </div>
  ${canConfirm
    ? `<form method="post" action="/api/meetings/shared" style="margin-top:14px;">
    <input type="hidden" name="token" value="${token}" />
    <input type="hidden" name="action" value="confirm" />
    <button type="submit" style="width:100%;background:rgba(16,185,129,.15);color:#6ee7b7;border:1px solid rgba(16,185,129,.45);border-radius:12px;padding:14px;font-size:15px;font-weight:bold;cursor:pointer;">This time works, confirm it</button>
  </form>`
    : ''}
</div>

<div style="background:#111113;border:1px solid #27272a;border-radius:16px;padding:24px;margin-top:16px;">
  <h2 style="margin:0;font-size:16px;">Updates</h2>
  ${commentThread(comments)}
  <form method="post" action="/api/meetings/shared" style="margin-top:16px;">
    <input type="hidden" name="token" value="${token}" />
    <input type="hidden" name="action" value="comment" />
    <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px;color:#d4d4d8;">
      <label style="display:flex;align-items:center;gap:6px;border:1px solid #3f3f46;border-radius:10px;padding:8px 12px;cursor:pointer;">
        <input type="radio" name="side" value="MEMBER" required style="accent-color:#f5c518;" /> ${escapeHtml(m.memberName)}
      </label>
      <label style="display:flex;align-items:center;gap:6px;border:1px solid #3f3f46;border-radius:10px;padding:8px 12px;cursor:pointer;">
        <input type="radio" name="side" value="GUEST" style="accent-color:#f5c518;" /> ${escapeHtml(m.guestName || 'Guest')}
      </label>
    </div>
    <textarea name="body" rows="3" maxlength="2000" required placeholder="Add a note both sides and the team will see. Ask a question, add context, or say what should change." style="width:100%;margin-top:10px;background:#0d0d0f;color:#fafafa;border:1px solid #3f3f46;border-radius:12px;padding:12px;font-size:14px;font-family:inherit;box-sizing:border-box;"></textarea>
    <button type="submit" style="width:100%;margin-top:10px;background:#f5c518;color:#09090b;border:0;border-radius:12px;padding:14px;font-size:15px;font-weight:bold;cursor:pointer;">Post note</button>
  </form>
</div>

<div style="background:#111113;border:1px solid #27272a;border-radius:16px;padding:24px;margin-top:16px;">
  <h2 style="margin:0 0 4px;font-size:16px;">Need a different time?</h2>
  <p style="margin:0 0 12px;color:#a1a1aa;font-size:13px;">Propose one. Both parties get an email, and the meeting waits for a fresh confirm. South African time.</p>
  <form method="post" action="/api/meetings/shared">
    <input type="hidden" name="token" value="${token}" />
    <input type="hidden" name="action" value="propose" />
    <div style="display:flex;gap:10px;">
      <input type="date" name="date" required style="flex:1;background:#0d0d0f;color:#fafafa;border:1px solid #3f3f46;border-radius:12px;padding:12px;font-size:14px;" />
      <input type="time" name="time" required style="width:120px;background:#0d0d0f;color:#fafafa;border:1px solid #3f3f46;border-radius:12px;padding:12px;font-size:14px;" />
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px;color:#d4d4d8;margin-top:10px;">
      <label style="display:flex;align-items:center;gap:6px;border:1px solid #3f3f46;border-radius:10px;padding:8px 12px;cursor:pointer;">
        <input type="radio" name="side" value="MEMBER" required style="accent-color:#f5c518;" /> I am ${escapeHtml(m.memberName)}
      </label>
      <label style="display:flex;align-items:center;gap:6px;border:1px solid #3f3f46;border-radius:10px;padding:8px 12px;cursor:pointer;">
        <input type="radio" name="side" value="GUEST" style="accent-color:#f5c518;" /> I am ${escapeHtml(m.guestName || 'the guest')}
      </label>
    </div>
    <button type="submit" style="width:100%;margin-top:10px;background:transparent;color:#a1a1aa;border:1px solid #3f3f46;border-radius:12px;padding:12px;font-size:14px;cursor:pointer;">Propose this new time</button>
  </form>
</div>${PAGE_FOOT}`
}

// ------------------------------------------------------- shared page emails

/** Note posted on the shared page, goes to the OTHER side, plus the link. */
export function meetingNoteEmail(
  m: MeetingLike,
  recipientName: string,
  authorName: string,
  note: string,
  shareUrl: string,
): { subject: string; body: string } {
  const f = first(recipientName)
  const subject = `New note on your meeting: ${m.title}`
  const body = [
    `Hi ${f},`,
    '',
    `${authorName} added a note to your meeting:`,
    '',
    `"${note}"`,
    '',
    `WHEN: ${meetingWhen(m.startsAt)}`,
    '',
    'Read the whole thread and post your own note on your meeting page:',
    shareUrl,
    '',
    'Keep this link handy. It is your meeting page: the details stay current and anything either side posts shows up there.',
    '',
    'Talk soon,',
    'The HustlePortal team',
    'Business Hustle · businesshustle.co.za',
  ].join('\n')
  return { subject, body }
}

/** New time proposed on the shared page, goes to BOTH sides. */
export function meetingMovedEmail(
  m: MeetingLike,
  recipientName: string,
  authorName: string,
  shareUrl: string,
): { subject: string; body: string } {
  const f = first(recipientName)
  const subject = `Time change proposed: ${meetingDay(m.startsAt)} at ${meetingTime(m.startsAt)}`
  const body = [
    `Hi ${f},`,
    '',
    `${authorName} proposed moving your meeting to:`,
    '',
    meetingWhen(m.startsAt),
    '',
    `WHAT: ${m.title}`,
    whereLine(m),
    '',
    'Open your meeting page to confirm the new time or suggest another:',
    shareUrl,
    '',
    'The meeting is only set once one of you confirms the new time.',
    '',
    'Talk soon,',
    'The HustlePortal team',
    'Business Hustle · businesshustle.co.za',
  ].join('\n')
  return { subject, body }
}

/** Quiet note to the team inbox when something happens on the shared page. */
export function meetingSharedExecEmail(
  m: MeetingLike,
  what: string,
  authorName: string,
  detail: string,
): { subject: string; body: string } {
  return {
    subject: `Meeting update: ${m.title}`,
    body: [
      `${what} on the shared meeting page by ${authorName}.`,
      '',
      `${m.title}`,
      meetingWhen(m.startsAt),
      `${memberLabel(m)} (${m.memberEmail}) × ${guestLabel(m)}`,
      '',
      detail,
      '',
      'The full thread is on the Executive Dashboard under Meetings.',
    ].join('\n'),
  }
}
