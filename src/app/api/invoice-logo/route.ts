import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { planState, upgradeJson } from '@/lib/limits'

export const dynamic = 'force-dynamic'

/**
 * Business invoice logo, set it once, every invoice carries it.
 * The feature lives on Operator: free accounts get the honest 402 upgrade moment.
 * SVG only (crisp at any print size, tiny payload). Sanitised server side before
 * it is ever stored, because an SVG can carry script if you let it.
 */

const KEY = 'INVOICE_LOGO'
const MAX_SVG_CHARS = 150_000

/** Strip everything an SVG could smuggle onto an invoice: scripts, handlers, external loads. */
function sanitizeSvg(raw: string): string | null {
  const s = raw.slice(0, MAX_SVG_CHARS)
  if (!/<svg[\s>]/i.test(s)) return null
  const cleaned = s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, ' ')
    .replace(/<(animate|set|use)[^>]*>/gi, (m) => (/href/i.test(m) ? ' ' : m))
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '')
    .replace(/javascript:/gi, '')
  return /<svg[\s>]/i.test(cleaned) ? cleaned : null
}

// GET /api/invoice-logo → { logoUrl }
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await db.userSetting.findUnique({ where: { userId_key: { userId, key: KEY } } })
  return NextResponse.json({ logoUrl: row?.value || null })
}

// PUT /api/invoice-logo { svg } → { logoUrl }, Operator feature.
export async function PUT(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { paid } = await planState(userId)
  if (!paid) return upgradeJson('logo', 1)
  const body = await req.json().catch(() => ({}))
  const svg = sanitizeSvg(String(body.svg || ''))
  if (!svg) {
    return NextResponse.json(
      { error: 'That file does not read as an SVG image. Export your logo as SVG and try again.' },
      { status: 400 },
    )
  }
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  await db.userSetting.upsert({
    where: { userId_key: { userId, key: KEY } },
    create: { userId, key: KEY, value: dataUrl },
    update: { value: dataUrl },
  })
  return NextResponse.json({ logoUrl: dataUrl })
}

// DELETE /api/invoice-logo → back to the clean, logo-free template
export async function DELETE() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await db.userSetting.deleteMany({ where: { userId, key: KEY } })
  return NextResponse.json({ ok: true })
}
