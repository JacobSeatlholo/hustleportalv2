import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Public campaign-logo serving: GET /api/campaign-logo/[u] returns the image
 * bytes for account `u`'s stored brand logo, with the right content type and
 * long cache headers. This is the URL that goes INTO campaign email html —
 * the recipient's mail client fetches it anonymously, so no auth here, and
 * the payload is only ever the sanitized PNG/JPEG the PUT route validated.
 *
 * No logo (or a stranger's id) → a 1x1 transparent GIF: email clients render
 * a broken-image icon otherwise, and a blank beats a broken badge.
 */

const KEY = 'CAMPAIGN_LOGO'

// The tiniest valid transparent GIF — the honest empty answer.
const BLANK_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ u: string }> },
) {
  const { u } = await params
  const headers = {
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    'Content-Type': 'image/gif',
  }
  if (!u || u.length < 10 || u.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(u)) {
    return new NextResponse(new Uint8Array(BLANK_GIF), { status: 200, headers })
  }
  try {
    const row = await db.userSetting.findUnique({
      where: { userId_key: { userId: u, key: KEY } },
      select: { value: true },
    })
    const m = row?.value?.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
    if (!m) {
      return new NextResponse(new Uint8Array(BLANK_GIF), { status: 200, headers })
    }
    const buf = Buffer.from(m[2], 'base64')
    if (buf.length === 0 || buf.length > 400_000) {
      return new NextResponse(new Uint8Array(BLANK_GIF), { status: 200, headers })
    }
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Content-Type': m[1] === 'png' ? 'image/png' : 'image/jpeg',
        'Content-Length': String(buf.length),
      },
    })
  } catch {
    // The logo can never break a send or a page — worst case, blank.
    return new NextResponse(new Uint8Array(BLANK_GIF), { status: 200, headers })
  }
}
