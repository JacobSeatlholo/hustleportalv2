import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { planState, upgradeJson } from '@/lib/limits'
import { stripLogoBackground } from '@/lib/logostrip'

export const dynamic = 'force-dynamic'

/**
 * Campaign brand logo — the picture that replaces the BH mark on a sender's
 * campaign emails. One logo per account, uploaded once, every branded
 * campaign wears it.
 *
 * RASTER ONLY (PNG/JPEG, <= 300 KB). The invoice logo is SVG because invoices
 * render in a browser; email is a different animal — Gmail and Outlook refuse
 * SVG and data: URIs outright, so the logo is stored as a data URL but always
 * SERVED through the public /api/campaign-logo/[u] route as a real image
 * response the mail clients will actually fetch.
 *
 * THE WHITE-BOX LAW: most logos arrive as a fine mark on a flat white
 * rectangle, and on the ink banner that rectangle reads as a cheap white box.
 * Every upload therefore goes through stripLogoBackground — a flat near-white
 * background becomes transparent (flood-fill from the border, so white inside
 * the mark survives), the mark is trimmed to its edges and re-encoded as a
 * compact PNG. A logo designed on colour passes through untouched: the
 * stripper only acts when the border is actually near-white.
 */

const KEY = 'CAMPAIGN_LOGO'
const MAX_BYTES = 300_000
const SITE_BASE = 'https://www.hustleportal.online'

// GET /api/campaign-logo → { logoUrl } (the caller's own logo, null when none)
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await db.userSetting.findUnique({ where: { userId_key: { userId, key: KEY } } })
  return NextResponse.json({ logoUrl: row?.value ? logoPublicUrl(userId, row.value) : null })
}

// PUT /api/campaign-logo { dataUrl } → { logoUrl }. Paid feature — it dresses
// campaign mail, and campaigns are a paid surface.
export async function PUT(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { paid } = await planState(userId)
  if (!paid) return upgradeJson('campaigns', 1)
  const body = await req.json().catch(() => ({}))
  const parsed = parseLogoDataUrl(String(body.dataUrl || ''))
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: 400 },
    )
  }
  // The white-box law, applied at the door: strip a flat near-white background
  // before anything is stored. A failed strip (odd image, size cap) is never an
  // error — the logo stores exactly as uploaded instead.
  let dataUrl = parsed.dataUrl
  let stripped = false
  try {
    const m = dataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
    if (m) {
      const result = await stripLogoBackground(Buffer.from(m[2], 'base64'))
      if (result.stripped && result.png && result.png.length > 0) {
        dataUrl = `data:image/png;base64,${result.png.toString('base64')}`
        stripped = true
      }
    }
  } catch {
    // strip is a favour, never a gate
  }
  await db.userSetting.upsert({
    where: { userId_key: { userId, key: KEY } },
    create: { userId, key: KEY, value: dataUrl },
    update: { value: dataUrl },
  })
  // The version query busts email-client caches when the logo changes.
  return NextResponse.json({ logoUrl: logoPublicUrl(userId, dataUrl), stripped })
}

// DELETE /api/campaign-logo → campaigns fall back to the initials chip.
export async function DELETE() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await db.userSetting.deleteMany({ where: { userId, key: KEY } })
  return NextResponse.json({ ok: true })
}

/** The hosted, email-safe URL for the stored logo. Versioned so a re-upload
 *  replaces what inboxes already cached. */
export function logoPublicUrl(userId: string, dataUrl: string): string {
  const v = dataUrl.length.toString(36) // stable per stored content length
  return `${SITE_BASE}/api/campaign-logo/${userId}?v=${v}`
}

/** Accept only a data:image/png|jpeg base64 URL under the size ceiling. */
export function parseLogoDataUrl(raw: string): { ok: true; dataUrl: string } | { ok: false; error: string } {
  const m = raw.match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) {
    return { ok: false, error: 'The logo must be a PNG or JPG image. Export it from your design tool and try again.' }
  }
  const bytes = Math.floor((m[2].length * 3) / 4)
  if (bytes > MAX_BYTES) {
    return { ok: false, error: `That logo is ${(bytes / 1024).toFixed(0)} KB. Keep it under ${Math.round(MAX_BYTES / 1024)} KB — a wide, flat banner compresses fine.` }
  }
  const type = m[1] === 'jpg' ? 'jpeg' : m[1]
  return { ok: true, dataUrl: `data:image/${type};base64,${m[2]}` }
}
