/**
 * Hustle Bot — the shared WhatsApp bot on the platform number.
 *
 * One number for the whole platform. A member saves it as "Hustle Bot", sends
 * one message, links by replying with their account email once, and from then
 * on this file IS their HustlePortal:
 *
 *   "meeting with Thabo next week"  -> task saved, linked to that contact
 *   "add client Thabo in Khayelitsha" -> client row created
 *   "today"                        -> the week's due tasks
 *   "search coffee"                -> their own pipeline rows
 *
 * Zero cost by design: Meta charges nothing for service messages (the user
 * messaged first, so the 24 hour window is open and every bot reply is free).
 * The brain is deterministic (no AI calls, no per-message bills) and every
 * credential rides in PlatformConfig like the VAPID keys — zero env setup.
 *
 * Security model:
 *  - a phone number alone proves nothing: PENDING phones can only link, and
 *    linking demands the exact email of an ACTIVE account;
 *  - every action re-derives the user from the link row, so nobody can act on
 *    someone else's profile;
 *  - Meta message ids dedupe retries (a retried webhook can never create two
 *    tasks);
 *  - the webhook checks Meta's X-Hub-Signature-256 whenever an app secret is
 *    on file, and per-phone rate limits cap forged message storms.
 */
import crypto from 'crypto'
import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/whatsapp'
import { recordTaskEvent } from '@/lib/taskrecord'
import { bumpChallenge } from '@/lib/gamification'
import { rateLimit } from '@/lib/ratelimit'

const GRAPH = 'https://graph.facebook.com/v21.0'

export interface BotConfig {
  token: string | null
  phoneId: string | null
  appSecret: string | null
  enabled: boolean
  verifyToken: string
}

export interface BotIncoming {
  from: string
  msgId?: string
  text: string
  profileName?: string
}

// ---------- config (PlatformConfig, like the VAPID keys) ----------

async function cfgValue(key: string): Promise<string | null> {
  const row = await db.platformConfig.findUnique({ where: { key } })
  return row?.value || null
}

/** The verify token self-generates on first use, so the boss never edits env files. */
export async function ensureVerifyToken(): Promise<string> {
  const existing = await cfgValue('WA_BOT_VERIFY_TOKEN')
  if (existing) return existing
  const value = crypto.randomUUID().replace(/-/g, '') + crypto.randomBytes(8).toString('hex')
  await db.platformConfig.upsert({
    where: { key: 'WA_BOT_VERIFY_TOKEN' },
    update: {},
    create: { key: 'WA_BOT_VERIFY_TOKEN', value },
  })
  return value
}

export async function getBotConfig(): Promise<BotConfig> {
  const [token, phoneId, appSecret, enabled, verifyToken] = await Promise.all([
    cfgValue('WA_BOT_TOKEN'),
    cfgValue('WA_BOT_PHONE_ID'),
    cfgValue('WA_BOT_APP_SECRET'),
    cfgValue('WA_BOT_ENABLED'),
    ensureVerifyToken(),
  ])
  return {
    token: token || process.env.WHATSAPP_BOT_TOKEN || null,
    phoneId: phoneId || process.env.WHATSAPP_BOT_PHONE_ID || null,
    appSecret: appSecret || process.env.WHATSAPP_APP_SECRET || null,
    enabled: enabled !== '0',
    verifyToken,
  }
}

/** Meta signs the raw body with the app secret. Enforced whenever a secret is on file. */
export function verifySignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false
  const expected = crypto.createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex')
  const got = header.slice(7).toLowerCase()
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(got, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ---------- Graph send ----------

async function sendBotText(
  phoneId: string,
  token: string,
  to: string,
  text: string
): Promise<{ ok: boolean; wamid?: string; error?: string }> {
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
      signal: AbortSignal.timeout(15000),
    })
    const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } }
    if (!res.ok || data?.error) {
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` }
    }
    return { ok: true, wamid: data?.messages?.[0]?.id }
  } catch {
    return { ok: false, error: 'network' }
  }
}

// ---------- time: everything SAST (UTC+2) ----------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NUM: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const WEEKDAY_NUM: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function sastMidnight(addDays = 0): Date {
  const s = new Date(Date.now() + 120 * 60_000) // now in SAST, read via UTC getters
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + addDays, -2, 0, 0))
}

function labelFor(d: Date): string {
  const s = new Date(d.getTime() + 120 * 60_000)
  return `${DAYS[s.getUTCDay()]} ${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`
}

/**
 * Reads a due date out of plain South African English. Returns the parsed
 * instant (09:00 SAST on the day), a human label, and the exact words it
 * consumed so the caller can strip them from the task title.
 */
export function parseWhen(text: string): { date: Date | null; label: string | null; matched: string | null } {
  const say = (date: Date, label: string, matched: string) => ({ date, label, matched })

  let m = text.match(/\btoday\b/i)
  if (m) return say(sastMidnight(0), 'today', m[0])
  m = text.match(/\btomorrow\b/i)
  if (m) return say(sastMidnight(1), 'tomorrow', m[0])
  m = text.match(/\bnext week\b/i)
  if (m) return say(sastMidnight(7), 'next week', m[0])
  m = text.match(/\bnext month\b/i)
  if (m) return say(sastMidnight(30), 'in about a month', m[0])

  m = text.match(/\bin (\d{1,3}) days?\b/i)
  if (m) {
    const n = Math.min(365, parseInt(m[1], 10))
    return say(sastMidnight(n), n === 1 ? 'tomorrow' : `in ${n} days`, m[0])
  }

  m = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat)\b/i)
  if (m) {
    const num = WEEKDAY_NUM[m[1].slice(0, 3).toLowerCase()]
    if (num !== undefined) {
      const now = new Date(Date.now() + 120 * 60_000)
      let diff = (num - now.getUTCDay() + 7) % 7
      if (diff === 0) diff = 7
      const isNext = /\bnext\b/i.test(text)
      const d = sastMidnight(diff)
      return say(d, isNext && diff === 7 ? 'next week' : labelFor(d), m[0])
    }
  }

  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\b/) || text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
  if (m) {
    const dayFirst = /^\d/.test(m[1])
    const day = parseInt(dayFirst ? m[1] : m[2], 10)
    const mon = MONTH_NUM[(dayFirst ? m[2] : m[1]).slice(0, 3).toLowerCase()]
    if (mon !== undefined && day >= 1 && day <= 31) {
      const now = new Date(Date.now() + 120 * 60_000)
      let y = now.getUTCFullYear()
      let cand = new Date(Date.UTC(y, mon, day, -2, 0, 0))
      if (cand.getTime() < sastMidnight(0).getTime()) {
        y += 1
        cand = new Date(Date.UTC(y, mon, day, -2, 0, 0))
      }
      return say(cand, labelFor(cand), m[0])
    }
  }

  m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (m) {
    const day = parseInt(m[1], 10)
    const mon = parseInt(m[2], 10) - 1
    const now = new Date(Date.now() + 120 * 60_000)
    let y = m[3] ? parseInt(m[3], 10) : now.getUTCFullYear()
    if (y < 100) y += 2000
    if (mon >= 0 && mon <= 11 && day >= 1 && day <= 31) {
      let cand = new Date(Date.UTC(y, mon, day, -2, 0, 0))
      if (!m[3] && cand.getTime() < sastMidnight(0).getTime()) {
        cand = new Date(Date.UTC(y + 1, mon, day, -2, 0, 0))
      }
      return say(cand, labelFor(cand), m[0])
    }
  }

  return { date: null, label: null, matched: null }
}

// ---------- copy (no hyphens, no emoji, simple English) ----------

const MENU = `Try one of these any time:
*today* — what is due this week
*meeting with <name>* — saves the task and links the contact
*add client <name> in <area>* — new client, add a number if you have it
*search <word>* — your pipeline
*leads* — your pipeline numbers
*stop* — unlink this phone`

const LINK_PROMPT =
  'Hi, Hustle Bot here. The WhatsApp side of HustlePortal. Reply with the email on your Hustle Portal account and I will link this phone. Say *stop* any time and I go quiet.'

// ---------- small helpers ----------

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const PHONE_SPAN_RE = /(\+?\d[\d\s()./-]{6,}\d)/g
const STOP_WORDS = new Set([
  'with', 'the', 'and', 'for', 'about', 'meeting', 'call', 'visit', 'quote', 'appointment',
  'follow', 'up', 'next', 'week', 'today', 'tomorrow', 'month', 'client', 'have', 'has',
  'booked', 'schedule', 'set', 'urgent', 'asap', 'important',
])

function safeParse<T>(s: string | null | undefined): T | null {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function tokens(name: string): string[] {
  return (name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

async function reply(
  conf: BotConfig,
  to: string,
  userId: string | null,
  text: string
): Promise<void> {
  const r = conf.token && conf.phoneId ? await sendBotText(conf.phoneId, conf.token, to, text) : { ok: false, error: 'not configured' }
  if (userId) {
    await db.waMessage
      .create({
        data: {
          userId,
          phone: to,
          direction: 'OUT',
          body: text.slice(0, 3800),
          status: r.ok ? 'SENT' : 'FAILED',
          waMessageId: r.wamid || null,
          error: r.error || null,
        },
      })
      .catch(() => {})
  }
}

// ---------- link flow ----------

/** If a member declared this exact number on their profile, the phone is theirs already. */
async function autoLinkUser(e164: string): Promise<string | null> {
  const users = await db.user.findMany({
    where: { accountStatus: 'ACTIVE', phone: { not: null } },
    select: { id: true, phone: true },
  })
  const hits = users.filter((u) => normalizePhone(u.phone || '').e164 === e164)
  return hits.length === 1 ? hits[0].id : null
}

async function handleLinking(
  conf: BotConfig,
  link: { id: string; attempts: number },
  e164: string,
  text: string
): Promise<void> {
  const email = text.match(EMAIL_RE)?.[0]
  if (!email) {
    const attempts = link.attempts + 1
    await db.waBotLink.update({ where: { id: link.id }, data: { attempts } })
    await reply(
      conf,
      e164,
      null,
      attempts >= 3
        ? 'Still no Hustle Portal account on that address. Open the email you signed up with and copy it exactly. Say *stop* to stop trying.'
        : LINK_PROMPT
    )
    return
  }
  const user = await db.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true, businessName: true, accountStatus: true },
  })
  if (!user || user.accountStatus !== 'ACTIVE') {
    const attempts = link.attempts + 1
    await db.waBotLink.update({ where: { id: link.id }, data: { attempts } })
    await reply(conf, e164, null, 'No active Hustle Portal account uses that email. Check the spelling and reply again, or say *stop*.')
    return
  }
  await db.waBotLink.update({
    where: { id: link.id },
    data: { status: 'ACTIVE', userId: user.id, attempts: 0, pending: null },
  })
  await reply(conf, e164, user.id, `Linked. This phone now speaks for *${user.businessName || user.name}* on HustlePortal.\n\n${MENU}`)
}

// ---------- actions ----------

interface PendingPick {
  kind: 'pick'
  title: string
  notes?: string
  dueIso?: string
  priority?: string
  candidates: { kind: 'lead' | 'client'; id: string; label: string }[]
}

async function createTask(
  userId: string,
  title: string,
  notes: string | null,
  due: Date | null,
  leadId: string | null,
  clientId: string | null,
  priority: string
): Promise<{ id: string }> {
  const task = await db.task.create({
    data: {
      title: title.slice(0, 180),
      notes,
      status: 'TODO',
      priority,
      dueDate: due,
      teamId: null,
      leadId,
      clientId,
      creatorId: userId,
      assigneeId: userId,
    },
    select: { id: true },
  })
  await recordTaskEvent(task.id, 'CREATED', userId, 'created it from WhatsApp')
  await bumpChallenge(userId, 'add_task').catch(() => {})
  return task
}

function confirmText(title: string, label: string | null, kind: 'lead' | 'client' | null, due: Date | null): string {
  const lines = [`Done. *${title}* is saved on HustlePortal.`]
  if (label) lines.push(kind === 'client' ? `Client: ${label}` : `Pipeline: ${label}`)
  lines.push(due ? `Due ${labelFor(due)}.` : 'No date on it yet.')
  lines.push('Say *today* any morning to see what is due.')
  return lines.join('\n')
}

async function matchContacts(
  userId: string,
  target: string
): Promise<{ kind: 'lead' | 'client'; id: string; label: string; s: number }[]> {
  const words = tokens(target)
  if (words.length === 0) return []
  const [leads, clients] = await Promise.all([
    db.lead.findMany({
      where: { userId },
      select: { id: true, company: true, contactName: true },
      take: 500,
    }),
    db.client.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, name: true, company: true },
      take: 500,
    }),
  ])
  const score = (label: string) => {
    const l = label.toLowerCase()
    return words.filter((w) => l.includes(w)).length
  }
  const out: { kind: 'lead' | 'client'; id: string; label: string; s: number }[] = []
  for (const l of leads) {
    const label = l.company || l.contactName || ''
    if (!label) continue
    let s = score(label)
    if (l.contactName && s === 0) s = score(l.contactName)
    if (s > 0) out.push({ kind: 'lead', id: l.id, label, s })
  }
  for (const c of clients) {
    const label = c.name || c.company || ''
    if (!label) continue
    let s = score(label)
    if (c.company && s === 0) s = score(c.company)
    if (s > 0) out.push({ kind: 'client', id: c.id, label, s })
  }
  return out.sort((a, b) => b.s - a.s).slice(0, 3)
}

async function todayList(userId: string): Promise<string> {
  const include = { lead: { select: { company: true, contactName: true } }, client: { select: { name: true } } }
  const common = {
    status: { not: 'DONE' },
    OR: [{ assigneeId: userId }, { creatorId: userId, assigneeId: null }],
  }
  const [overdue, today, tomorrow, week] = await Promise.all([
    db.task.findMany({ where: { ...common, dueDate: { lt: sastMidnight(0) } }, orderBy: { dueDate: 'asc' }, take: 5, include }),
    db.task.findMany({ where: { ...common, dueDate: { gte: sastMidnight(0), lt: sastMidnight(1) } }, orderBy: { dueDate: 'asc' }, take: 6, include }),
    db.task.findMany({ where: { ...common, dueDate: { gte: sastMidnight(1), lt: sastMidnight(2) } }, orderBy: { dueDate: 'asc' }, take: 6, include }),
    db.task.findMany({ where: { ...common, dueDate: { gte: sastMidnight(2), lt: sastMidnight(8) } }, orderBy: { dueDate: 'asc' }, take: 8, include }),
  ])
  const line = (t: (typeof today)[number], withDate = false) => {
    const who = t.lead ? t.lead.company || t.lead.contactName : t.client ? t.client.name : null
    return `• ${t.title}${who ? ` · ${who}` : ''}${withDate && t.dueDate ? ` (${labelFor(t.dueDate)})` : ''}`
  }
  const sections: string[] = []
  if (overdue.length) sections.push(`*Overdue*\n${overdue.map((t) => line(t, true)).join('\n')}`)
  if (today.length) sections.push(`*Today*\n${today.map((t) => line(t)).join('\n')}`)
  if (tomorrow.length) sections.push(`*Tomorrow*\n${tomorrow.map((t) => line(t)).join('\n')}`)
  if (week.length) sections.push(`*Later this week*\n${week.map((t) => line(t, true)).join('\n')}`)
  if (!sections.length) {
    return 'Nothing due in the next 7 days. A clean slate. Booked something? Send *meeting with <name>*.'
  }
  return `*Your tasks*\n\n${sections.join('\n\n')}`
}

async function leadSearch(userId: string, query: string): Promise<string> {
  const words = tokens(query)
  if (!words.length) return 'Search what? Send *search <word>*, like *search coffee*.'
  const rows = await db.lead.findMany({
    where: {
      userId,
      OR: words.flatMap((w) => [
        { company: { contains: w, mode: 'insensitive' as const } },
        { contactName: { contains: w, mode: 'insensitive' as const } },
        { city: { contains: w, mode: 'insensitive' as const } },
        { industry: { contains: w, mode: 'insensitive' as const } },
      ]),
    },
    orderBy: { updatedAt: 'desc' },
    take: 6,
    select: { company: true, contactName: true, stage: true, phone: true, email: true },
  })
  if (!rows.length) return `Nothing on your pipeline matches *${query}*. The team can hand pick contacts for you. Say the word on the platform.`
  const lines = rows.map((r) => {
    const who = r.company || r.contactName || 'Unnamed'
    const touch = r.phone || r.email || ''
    return `• ${who}${touch ? ` · ${touch}` : ''} · ${r.stage}`
  })
  return `*Pipeline: ${query}*\n${lines.join('\n')}\n\nFull rows live in your HustlePortal pipeline.`
}

async function leadCounts(userId: string): Promise<string> {
  const g = await db.lead.groupBy({ by: ['stage'], where: { userId }, _count: { _all: true } })
  const by: Record<string, number> = {}
  let total = 0
  for (const r of g) {
    by[r.stage] = r._count._all
    total += r._count._all
  }
  if (!total) return 'Your pipeline is empty. The team can hand pick verified contacts for your business. Say the word on the platform.'
  const parts = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTE_SENT', 'WON', 'LOST'].filter((s) => by[s]).map((s) => `${s} ${by[s]}`)
  return `Your pipeline holds *${total}* contacts. ${parts.join(' · ')}. Say *search <word>* to pull details.`
}

function parseAddClient(raw: string): { name?: string; city?: string; phone?: string; email?: string } {
  let s = raw.replace(/^new client[:\s]*/i, '').replace(/^add client[:\s]*/i, '').trim()
  const email = s.match(EMAIL_RE)?.[0]
  if (email) s = s.replace(email, ' ')
  let phone: string | undefined
  const spans = [...s.matchAll(PHONE_SPAN_RE)]
    .map((m) => m[1].trim())
    .filter((sp) => {
      const d = sp.replace(/\D/g, '')
      return d.length >= 9 && d.length <= 13
    })
    .sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length)
  if (spans.length) {
    phone = spans[0]
    s = s.replace(phone, ' ')
  }
  let city: string | undefined
  const cityM = s.match(/\bin\s+([A-Za-z0-9' ]+?)\s*$/)
  if (cityM && cityM.index !== undefined) {
    city = cityM[1].trim()
    s = s.slice(0, cityM.index).trim()
  }
  const name = s.replace(/\s+/g, ' ').trim() || undefined
  return { name, city, phone, email }
}

async function addClient(userId: string, raw: string): Promise<string> {
  const p = parseAddClient(raw)
  if (!p.name) return 'Almost. Give me the name too, like *add client Thabo Coffee in Khayelitsha 072 123 4567*.'
  const norm = p.phone ? normalizePhone(p.phone) : null
  const existing = await db.client.findMany({
    where: { userId, status: 'ACTIVE' },
    select: { id: true, name: true, phone: true },
    take: 500,
  })
  const dupe = existing.find((c) => {
    if (norm?.e164 && c.phone && normalizePhone(c.phone).e164 === norm.e164) return true
    return c.name.trim().toLowerCase() === p.name!.trim().toLowerCase()
  })
  if (dupe) return `*${dupe.name}* is already on your client list. Say *meeting with ${dupe.name.split(' ')[0]}* to book the next one.`
  const created = await db.client.create({
    data: {
      userId,
      name: p.name.slice(0, 120),
      phone: norm?.valid ? norm.display : p.phone || null,
      email: p.email || null,
      source: 'WHATSAPP',
      notes: `Added from WhatsApp by Hustle Bot.${p.city ? ` Area: ${p.city}.` : ''}`,
    },
    select: { id: true, name: true },
  })
  await bumpChallenge(userId, 'add_client').catch(() => {})
  return `Done. *${created.name}* is on your client list${p.city ? ` in ${p.city}` : ''}.\nSay *meeting with ${created.name.split(' ')[0]}* when the next one is booked.`
}

// ---------- pending pick resolution ----------

async function resolvePick(
  conf: BotConfig,
  linkId: string,
  userId: string,
  e164: string,
  pending: PendingPick,
  n: number
): Promise<void> {
  const cand = pending.candidates?.[n - 1]
  if (!cand) {
    await db.waBotLink.update({ where: { id: linkId }, data: { pending: null } })
    await reply(conf, e164, userId, 'That number is not on the list. Send the task again with a fuller name and I will match it.')
    return
  }
  const due = pending.dueIso ? new Date(pending.dueIso) : null
  await createTask(
    userId,
    pending.title,
    pending.notes || null,
    due,
    cand.kind === 'lead' ? cand.id : null,
    cand.kind === 'client' ? cand.id : null,
    pending.priority || 'MEDIUM'
  )
  await db.waBotLink.update({ where: { id: linkId }, data: { pending: null } })
  await reply(conf, e164, userId, confirmText(pending.title, cand.label, cand.kind, due))
}

// ---------- the brain ----------

export async function handleBotMessage(msg: BotIncoming): Promise<void> {
  const conf = await getBotConfig()
  if (!conf.enabled || !conf.token || !conf.phoneId) return // not wired yet: stay silent, log nothing

  const norm = normalizePhone(msg.from || '')
  const e164 = norm.e164 || (msg.from || '').replace(/\D/g, '')
  if (!e164) return
  const text = (msg.text || '').trim().slice(0, 2000)
  if (!text) return

  const gate = rateLimit(`wa:bot:${e164}`, 20, 60_000)
  if (!gate.ok) return

  let link = await db.waBotLink.findUnique({ where: { phone: e164 } })
  if (!link) {
    const autoId = await autoLinkUser(e164)
    link = await db.waBotLink.create({
      data: { phone: e164, userId: autoId, status: autoId ? 'ACTIVE' : 'PENDING' },
    })
  }
  await db.waBotLink.update({ where: { id: link.id }, data: { lastMsgAt: new Date() } }).catch(() => {})

  // Meta retries webhooks. The inbound log row is the dedupe gate for every
  // state where an action can happen, so a retry can never create two tasks.
  if (msg.msgId && link.userId) {
    const dupe = await db.waMessage.findFirst({
      where: { userId: link.userId, waMessageId: msg.msgId, direction: 'IN' },
      select: { id: true },
    })
    if (dupe) return
  }

  if (link.status === 'OPTED_OUT') {
    if (/^(start|link|hi|hello)\b/i.test(text)) {
      await db.waBotLink.update({
        where: { id: link.id },
        data: { status: 'PENDING', attempts: 0, userId: null, pending: null },
      })
      await reply(conf, e164, null, LINK_PROMPT)
    }
    return
  }

  if (link.status !== 'ACTIVE' || !link.userId) {
    await handleLinking(conf, link, e164, text)
    return
  }

  const userId = link.userId

  await db.waMessage
    .create({
      data: { userId, phone: e164, direction: 'IN', body: text.slice(0, 3800), status: 'RECEIVED', waMessageId: msg.msgId || null },
    })
    .catch(() => {})

  // stop
  if (/^(stop|unsubscribe|opt out|remove me)\b/i.test(text)) {
    await db.waBotLink.update({ where: { id: link.id }, data: { status: 'OPTED_OUT', pending: null } })
    await reply(conf, e164, userId, 'Done. This phone is unlinked. Nothing more from me until you say *start*. Everything you saved stays on your profile.')
    return
  }

  // pending disambiguation
  const pending = safeParse<PendingPick>(link.pending)
  if (pending?.kind === 'pick' && /^\s*[1-9]\s*$/.test(text)) {
    await resolvePick(conf, link.id, userId, e164, pending, parseInt(text, 10))
    return
  }
  if (pending && !/^(help|menu|hi|hello)\b/i.test(text)) {
    await db.waBotLink.update({ where: { id: link.id }, data: { pending: null } })
  }

  // help
  if (/^(help|menu|hi|hello|hey|start)\b/i.test(text)) {
    await reply(conf, e164, userId, `Ready when you are.\n\n${MENU}`)
    return
  }

  // thanks
  if (/^(thanks|thank you|cool|great|nice|sharp|lekker|shot)\b/i.test(text)) {
    await reply(conf, e164, userId, 'Any time. Say *today* whenever you want the week.')
    return
  }

  // today
  if (/^(today|agenda|schedule|my tasks|tasks|todo)\b/i.test(text)) {
    await reply(conf, e164, userId, await todayList(userId))
    return
  }

  // pipeline numbers
  if (/^leads?\b/i.test(text)) {
    await reply(conf, e164, userId, await leadCounts(userId))
    return
  }

  // search
  const searchM = text.match(/^(?:search|find)\s+(.{1,80})$/i)
  if (searchM) {
    await reply(conf, e164, userId, await leadSearch(userId, searchM[1].trim()))
    return
  }

  // add client
  if (/^(add client|new client)\b/i.test(text)) {
    await reply(conf, e164, userId, await addClient(userId, text))
    return
  }

  // task intent: "meeting with Thabo next week" / "task: call Sipho friday"
  const taskColon = text.match(/^(?:task|todo|reminder)\s*[:,]\s*(.+)/i)
  const meetM = text.match(/\b(meeting|call|visit|quote|appointment|presentation|viewing|follow up|followup)\b/i)
  if (taskColon || meetM) {
    let target: string
    let title: string
    if (taskColon) {
      target = taskColon[1].trim()
      title = target
    } else {
      const keyword = cap(meetM![1].toLowerCase())
      const after = text.slice((meetM!.index ?? 0) + meetM![1].length)
      const withM = after.match(/\bwith\s+(.+)/i)
      target = (withM ? withM[1] : after.replace(/^[\s:,.]+/, '')).trim()
      title = withM ? `${keyword} with ${target}` : `${keyword}: ${target}`
    }
    if (!target) {
      await reply(conf, e164, userId, `Who is it with? Send it like *meeting with Thabo next week*.\n\n${MENU}`)
      return
    }
    const when = parseWhen(text)
    if (when.matched) {
      target = target
        .replace(new RegExp(when.matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
        .replace(/\s+(?:on|at|this|in|for)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
      title = title
        .replace(new RegExp(when.matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
        .replace(/\s+(?:on|at|this|in|for)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
    }
    const priority = /\b(urgent|asap|important)\b/i.test(text) ? 'HIGH' : 'MEDIUM'
    const notes = 'From WhatsApp by Hustle Bot.'
    const candidates = await matchContacts(userId, target)
    if (candidates.length === 1) {
      const c = candidates[0]
      const due = when.date
      await createTask(userId, title || target, notes, due, c.kind === 'lead' ? c.id : null, c.kind === 'client' ? c.id : null, priority)
      await reply(conf, e164, userId, confirmText(title || target, c.label, c.kind, due))
      return
    }
    if (candidates.length > 1) {
      const pendingPick: PendingPick = {
        kind: 'pick',
        title: title || target,
        notes,
        dueIso: when.date ? when.date.toISOString() : undefined,
        priority,
        candidates: candidates.map((c) => ({ kind: c.kind, id: c.id, label: c.label })),
      }
      await db.waBotLink.update({ where: { id: link.id }, data: { pending: JSON.stringify(pendingPick) } })
      const list = candidates.map((c, i) => `${i + 1}. ${c.label}${c.kind === 'client' ? ' (client)' : ' (pipeline)'}`).join('\n')
      await reply(conf, e164, userId, `Which one is *${target}*?\n${list}\nReply with the number.`)
      return
    }
    const due = when.date
    await createTask(userId, title || target, `${notes} No matching contact on the profile for: ${target}.`, due, null, null, priority)
    await reply(
      conf,
      e164,
      userId,
      `Saved *${title || target}*${due ? ` for ${labelFor(due)}` : ''}. I could not find *${target}* on your profile, so the task is not linked yet.\nSay *add client ${target}* and I will link the next one.`
    )
    return
  }

  // fallback
  await reply(conf, e164, userId, `I did not catch that.\n\n${MENU}`)
}
