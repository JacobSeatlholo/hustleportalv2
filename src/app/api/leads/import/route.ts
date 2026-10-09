import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'

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

// POST /api/leads/import — CSV import
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { csv, teamId } = body
  if (!csv || typeof csv !== 'string' || csv.trim().length === 0) {
    return NextResponse.json({ error: 'Paste CSV content or upload a file.' }, { status: 400 })
  }
  if (teamId) {
    const member = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } })
    if (!member) return NextResponse.json({ error: 'Not a member of that team.' }, { status: 403 })
  }
  const rows = parseCsv(csv)
  if (!rows.length) return NextResponse.json({ error: 'No data rows found in CSV.' }, { status: 400 })

  let imported = 0
  const skipped: string[] = []
  for (const row of rows) {
    const company = pick(row, 'company')
    if (!company) {
      skipped.push(JSON.stringify(row).slice(0, 60))
      continue
    }
    const valueRaw = pick(row, 'value')
    const value = valueRaw ? parseFloat(valueRaw.replace(/[^0-9.]/g, '')) || 0 : 0
    await db.lead.create({
      data: {
        userId,
        teamId: teamId || null,
        company,
        contactName: pick(row, 'contactName') || null,
        email: pick(row, 'email') || null,
        phone: pick(row, 'phone') || null,
        website: pick(row, 'website') || null,
        industry: pick(row, 'industry') || null,
        city: pick(row, 'city') || null,
        country: pick(row, 'country') || 'South Africa',
        notes: pick(row, 'notes') || null,
        value,
        source: 'CSV',
        // CSV leads bring their own contact data → already unlocked
        unlocked: Boolean(pick(row, 'email') || pick(row, 'phone')),
      },
    })
    imported++
  }
  if (imported > 0) await bumpChallenge(userId, 'add_lead')
  return NextResponse.json({ imported, skipped: skipped.length, total: rows.length })
}
