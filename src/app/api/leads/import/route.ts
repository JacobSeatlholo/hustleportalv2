import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'
import { resolveProject } from '@/lib/workspace'
import { isEmail, normEmail, normCompanyKey, cleanNumber } from '@/lib/quality'
import { normalizePhone } from '@/lib/whatsapp'
import { deadEmailMap } from '@/lib/reach'

interface CsvRow {
  [key: string]: string
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      cur.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      cur.push(field)
      field = ''
      if (cur.some((c) => c.trim() !== '')) rows.push(cur)
      cur = []
    } else field += ch
  }
  cur.push(field)
  if (cur.some((c) => c.trim() !== '')) rows.push(cur)
  if (!rows.length) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => {
    const obj: CsvRow = {}
    headers.forEach((h, i) => (obj[h] = (r[i] || '').trim()))
    return obj
  })
}

const FIELD_ALIASES: Record<string, string[]> = {
  company: ['company', 'company name', 'business', 'business name', 'name', 'organisation', 'organization', 'trading name'],
  contactName: ['contact', 'contact name', 'person', 'owner', 'full name', 'contact person'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  phone: ['phone', 'cell', 'mobile', 'telephone', 'tel', 'contact number', 'phone number'],
  website: ['website', 'url', 'web', 'site'],
  industry: ['industry', 'sector', 'category', 'type'],
  city: ['city', 'town', 'suburb', 'area', 'location'],
  country: ['country'],
  notes: ['notes', 'note', 'comments'],
  value: ['value', 'deal value', 'potential value', 'amount'],
}

function pick(row: CsvRow, field: string): string | undefined {
  const aliases = FIELD_ALIASES[field] || [field]
  for (const a of aliases) {
    const v = row[a]
    if (v && v.trim() !== '') return v.trim()
  }
  return undefined
}

const MAX_IMPORT_ROWS = 500
const digitsOf = (s: string | null | undefined) => (s || '').replace(/\D/g, '')

// POST /api/leads/import, CSV import under the lead-quality law:
// invalid emails are refused, phones are normalized to E.164, and duplicates
// (inside the file or against the existing pipeline) never become rows.
// A duplicate reported is a retyped lead saved, and a reputation protected.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { csv, teamId, projectId } = body
  if (!csv || typeof csv !== 'string' || csv.trim().length === 0) {
    return NextResponse.json({ error: 'Paste CSV content or upload a file.' }, { status: 400 })
  }
  if (teamId) {
    const member = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } })
    if (!member) return NextResponse.json({ error: 'Not a member of that team.' }, { status: 403 })
  }
  // All imported rows land in one workspace: the chosen project, else the default.
  const project = await resolveProject(userId, projectId ?? null)
  const rows = parseCsv(csv)
  if (!rows.length) return NextResponse.json({ error: 'No data rows found in CSV.' }, { status: 400 })
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `That file carries ${rows.length} rows. The import takes up to ${MAX_IMPORT_ROWS} at a time, split it and go again.` }, { status: 400 })
  }

  // The existing pipeline, fingerprinted once for the whole file.
  const existing = await db.lead.findMany({
    where: { userId },
    select: { email: true, phone: true, company: true, city: true },
  })
  const seenEmails = new Set<string>()
  const seenPhones = new Set<string>()
  const seenCompanies = new Set<string>()
  for (const l of existing) {
    if (l.email) seenEmails.add(normEmail(l.email))
    const ph = digitsOf(l.phone)
    if (ph.length >= 9) seenPhones.add(ph)
    seenCompanies.add(`${normCompanyKey(l.company)}|${(l.city || '').trim().toLowerCase()}`)
  }

  let imported = 0
  let duplicates = 0
  let invalid = 0
  const skipped: string[] = []
  const duplicateSamples: string[] = []
  const invalidSamples: string[] = []
  const deadSamples: string[] = []
  type PendingLead = {
    userId: string
    projectId: string
    teamId: string | null
    company: string
    contactName: string | null
    email: string | null
    phone: string | null
    website: string | null
    industry: string | null
    city: string | null
    country: string
    notes: string | null
    value: number
  }
  const pending: PendingLead[] = []

  for (const row of rows) {
    const company = pick(row, 'company')
    if (!company) {
      skipped.push(JSON.stringify(row).slice(0, 60))
      continue
    }
    const rawEmail = pick(row, 'email')
    let email: string | null = null
    if (rawEmail) {
      if (isEmail(rawEmail)) {
        email = normEmail(rawEmail)
      } else {
        // A broken address would burn a future campaign send and the domain's
        // reputation. The row stays out; the report says why.
        invalid++
        if (invalidSamples.length < 5) invalidSamples.push(`${company}: ${rawEmail.slice(0, 40)}`)
        continue
      }
    }
    const rawPhone = pick(row, 'phone')
    let phone: string | null = null
    if (rawPhone) {
      const norm = normalizePhone(rawPhone)
      phone = norm.valid ? `+${norm.e164}` : rawPhone
    }

    // Duplicate law: same email, same phone digits, or same company in the
    // same city, the lead already exists, so this row is a retyped copy.
    const phoneKey = digitsOf(phone)
    const companyKey = `${normCompanyKey(company)}|${(pick(row, 'city') || '').trim().toLowerCase()}`
    const isDup =
      (email && seenEmails.has(email)) ||
      (phoneKey.length >= 9 && seenPhones.has(phoneKey)) ||
      seenCompanies.has(companyKey)
    if (isDup) {
      duplicates++
      if (duplicateSamples.length < 5) duplicateSamples.push(company.slice(0, 40))
      continue
    }
    if (email) seenEmails.add(email)
    if (phoneKey.length >= 9) seenPhones.add(phoneKey)
    seenCompanies.add(companyKey)

    const value = cleanNumber(pick(row, 'value'))
    pending.push({
      userId,
      projectId: project.id,
      teamId: teamId || null,
      company,
      contactName: pick(row, 'contactName') || null,
      email,
      phone,
      website: pick(row, 'website') || null,
      industry: pick(row, 'industry') || null,
      city: pick(row, 'city') || null,
      country: pick(row, 'country') || 'South Africa',
      notes: pick(row, 'notes') || null,
      value,
    })
  }

  // THE REACHABLE PROMISE ON IMPORTED DATA: the same law the pool, the deck
  // and the single save obey. Shape-valid addresses that the mail system can
  // provably never deliver to are stripped before a row is written, so an
  // import can never bake in guaranteed bounces and auto-unlock them. One
  // bounded DNS batch for the whole file — no AI quota, no per-row cost.
  const dead = await deadEmailMap(pending.map((r) => r.email), 16)
  let deadStripped = 0
  for (const r of pending) {
    const e = (r.email || '').trim().toLowerCase()
    if (e && dead.has(e)) {
      r.email = null
      deadStripped++
      if (deadSamples.length < 5) deadSamples.push(`${r.company}: ${e.slice(0, 40)}`)
    }
    await db.lead.create({
      data: {
        ...r,
        source: 'CSV',
        // CSV leads bring their own contact data → already unlocked, but a
        // row whose only door was a dead address lands locked and honest.
        unlocked: Boolean(r.email || r.phone),
      },
    })
    imported++
  }
  if (imported > 0) await bumpChallenge(userId, 'add_lead')
  return NextResponse.json({
    imported,
    duplicates,
    invalid,
    deadStripped,
    skipped: skipped.length,
    total: rows.length,
    duplicateSamples,
    invalidSamples,
    ...(deadSamples.length ? { deadSamples } : {}),
  })
}
