import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { db } from '@/lib/db'
import { normKey, normalizeSaPhone } from '@/lib/leadpool'
import { suppressedNameKeys } from '@/lib/suppression'

// Exec pool import: the boss's own lists (broker sheets, curated city pulls)
// land in the verified pool under a project tag, without ever touching what
// sellers get auto served. Imported rows carry NO LeadPoolHit links, so the
// scan serve path (which reads through hits) can never hand them out; the
// only way one reaches a member is the exec pool assign flow, by tag, on
// purpose. First open of a campaign email to the address flips the row to
// the OPENED segment (see /api/mail/open), which is the hand earned signal.
//
// POST { poolTag: 'BH2024', rows: [...] }   upsert, max 500 per call
// POST { removeTag: 'BH2024-QA' }           delete every pool row under that tag
//
// Merge law on existing rows: fill gaps, never clobber good facts with
// blanks, never steal a row from another project tag, never lower a score.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_ROWS = 500

function slugTag(raw?: string): string {
  return (raw || '').trim().toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

interface ImportRow {
  company?: string
  contactName?: string
  role?: string
  email?: string
  phone?: string
  city?: string
  address?: string
  industry?: string
  sourceRef?: string
  verifyScore?: number
  verifyChecks?: Record<string, unknown>
}

export async function POST(req: Request) {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  let payload: { poolTag?: string; removeTag?: string; rows?: ImportRow[] }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.removeTag) {
    const tag = slugTag(payload.removeTag)
    if (!tag) return NextResponse.json({ error: 'removeTag is required.' }, { status: 400 })
    const gone = await db.leadPool.deleteMany({ where: { poolTag: tag } })
    return NextResponse.json({ ok: true, removed: gone.count, tag })
  }

  const poolTag = slugTag(payload.poolTag)
  if (!poolTag) {
    return NextResponse.json({ error: 'A poolTag is required, for example BH2024.' }, { status: 400 })
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No rows. Send at least one company.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `That is ${rows.length} rows. One call carries at most ${MAX_ROWS}. Send the rest in the next batch.` }, { status: 400 })
  }

  const suppressed = await suppressedNameKeys()
  let created = 0
  let merged = 0
  let skippedSuppressed = 0
  let skippedInvalid = 0

  // Dedupe inside the batch first: last good version of a fingerprint wins.
  const batch = new Map<string, ImportRow>()
  for (const raw of rows) {
    const company = String(raw.company || '').trim().slice(0, 160)
    if (!company) {
      skippedInvalid++
      continue
    }
    const city = String(raw.city || '').trim().slice(0, 120)
    const fp = `${normKey(company)}|${normKey(city)}`
    if (!fp.split('|')[0]) {
      skippedInvalid++
      continue
    }
    batch.set(fp, raw)
  }

  for (const [fp, raw] of batch) {
    const company = String(raw.company || '').trim()
    const city = String(raw.city || '').trim()
    if (suppressed.has(normKey(company))) {
      skippedSuppressed++
      continue
    }
    const email = String(raw.email || '').trim().toLowerCase() || null
    if (email && !EMAIL_RE.test(email)) {
      skippedInvalid++
      continue
    }
    const phoneRaw = String(raw.phone || '').trim() || null
    // The sheet stores dialcode and number apart, so accept the joined +27 form
    // and also the bare national shape. Junk shapes ride along as raw only.
    let phoneE164: string | null = null
    if (phoneRaw) {
      const p = normalizeSaPhone(phoneRaw)
      if (p.ok) phoneE164 = p.e164 || null
    }
    const contactName = String(raw.contactName || '').trim().slice(0, 120) || null
    const role = String(raw.role || '').trim().slice(0, 120) || null
    const address = String(raw.address || '').trim().slice(0, 240) || null
    const industry = String(raw.industry || '').trim().slice(0, 80) || null
    const sourceRef = String(raw.sourceRef || '').trim().slice(0, 160) || 'Imported list'
    const scoreIn = Math.max(0, Math.min(100, Math.round(Number(raw.verifyScore) || 0)))

    const existing = await db.leadPool.findUnique({ where: { fingerprint: fp } })
    if (existing) {
      // Gap filling only: an existing fact always beats a sheet fact.
      const checks: Record<string, unknown> = (() => {
        try {
          return existing.verifyChecks ? JSON.parse(existing.verifyChecks) : {}
        } catch {
          return {}
        }
      })()
      for (const [k, v] of Object.entries(raw.verifyChecks || {})) {
        if (checks[k] === undefined || checks[k] === null) checks[k] = v
      }
      await db.leadPool.update({
        where: { id: existing.id },
        data: {
          contactName: existing.contactName || contactName,
          role: existing.role || role,
          email: existing.email || email,
          phone: existing.phone || phoneE164 || (existing.phoneRaw ? null : phoneRaw),
          phoneRaw: existing.phoneRaw || (phoneE164 ? null : phoneRaw),
          address: existing.address || address,
          industry: existing.industry || industry,
          poolTag: existing.poolTag || poolTag,
          verifyScore: Math.max(existing.verifyScore || 0, scoreIn),
          verifyChecks: JSON.stringify(checks),
        },
      })
      merged++
      continue
    }

    await db.leadPool.create({
      data: {
        fingerprint: fp,
        company,
        industry,
        city: city || null,
        areaLabel: city || null,
        address,
        phone: phoneE164,
        phoneRaw: phoneE164 ? null : phoneRaw,
        email,
        contactName,
        role,
        source: 'CSV',
        poolTag,
        sourceRef,
        confirmCount: 1,
        verifyScore: scoreIn,
        verifyState: 'new',
        verifyChecks: JSON.stringify(raw.verifyChecks || {}),
      },
    })
    created++
  }

  return NextResponse.json({
    ok: true,
    poolTag,
    received: rows.length,
    unique: batch.size,
    created,
    merged,
    skippedSuppressed,
    skippedInvalid,
  })
}
