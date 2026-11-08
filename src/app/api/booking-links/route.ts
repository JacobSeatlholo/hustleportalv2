import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { parseAvail } from '@/lib/booking'

/**
 * Booking links — the owner's side of the shareable booking page.
 *
 * GET    every link with its live counters + the most recent bookings
 * POST   create a link (title, kind, duration, buffer, venue, description,
 *        weekly availability, optional logo) — born active, the slug is the
 *        unguessable half of the public URL /book/<slug>
 * PATCH  edit any of it, flip active, set or clear the logo (sanitised SVG,
 *        the invoice-logo pattern: an SVG can carry script if you let it)
 * DELETE remove the link; bookings already on the calendar stay (SetNull)
 *
 * No plan gate on purpose: this ships boss-first and he decides when it
 * becomes a paid feature (the standing feature law).
 */

const MAX_LINKS = 12

const KINDS = ['MEETING', 'BOOKING', 'DEMO']

/** Same law as invoice-logo: strip everything an SVG could smuggle onto a page. */
function sanitizeSvg(raw: string): string | null {
  const s = raw.slice(0, 150_000)
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

function cleanAvailJson(raw: unknown): string {
  return JSON.stringify(parseAvail(raw))
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const links = await db.bookingLink.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, slug: true, title: true, kind: true, durationMin: true, bufferMin: true,
      location: true, description: true, avail: true, logoUrl: true, bookings: true,
      active: true, createdAt: true,
    },
  })
  const recent = links.length
    ? await db.appointment.findMany({
        where: { userId, bookingLinkId: { in: links.map((l) => l.id) }, startsAt: { gte: new Date() } },
        orderBy: { startsAt: 'asc' },
        take: 20,
        select: { id: true, bookingLinkId: true, title: true, clientName: true, startsAt: true, notes: true },
      })
    : []
  return NextResponse.json({ links, recent })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const title = String(body.title || '').trim().slice(0, 80)
  if (title.length < 2) return NextResponse.json({ error: 'Give the booking a name, e.g. "Consultation".' }, { status: 400 })
  const kind = KINDS.includes(String(body.kind)) ? String(body.kind) : 'MEETING'
  const durationMin = Math.max(10, Math.min(480, Math.round(Number(body.durationMin) || 30)))
  const bufferMin = Math.max(0, Math.min(120, Math.round(Number(body.bufferMin) || 0)))
  const location = String(body.location || '').trim().slice(0, 160) || null
  const description = String(body.description || '').trim().slice(0, 800) || null
  const avail = cleanAvailJson(body.avail)

  const count = await db.bookingLink.count({ where: { userId } })
  if (count >= MAX_LINKS) {
    return NextResponse.json({ error: `You already have ${MAX_LINKS} booking links. Remove one to make space.` }, { status: 400 })
  }

  // Slug: unguessable, lowercase, retry on the astronomically rare collision.
  let slug = ''
  for (let i = 0; i < 5; i++) {
    const candidate = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 8)
    const clash = await db.bookingLink.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!clash) {
      slug = candidate
      break
    }
  }
  if (!slug) return NextResponse.json({ error: 'Could not allocate a link id, try again.' }, { status: 500 })

  const link = await db.bookingLink.create({
    data: { userId, slug, title, kind, durationMin, bufferMin, location, description, avail },
  })
  return NextResponse.json({ link }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'Missing link id.' }, { status: 400 })

  const link = await db.bookingLink.findFirst({ where: { id, userId }, select: { id: true } })
  if (!link) return NextResponse.json({ error: 'That booking link is not yours.' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (body.title !== undefined) {
    const title = String(body.title).trim().slice(0, 80)
    if (title.length < 2) return NextResponse.json({ error: 'A booking needs a name.' }, { status: 400 })
    data.title = title
  }
  if (body.kind !== undefined && KINDS.includes(String(body.kind))) data.kind = String(body.kind)
  if (body.durationMin !== undefined) data.durationMin = Math.max(10, Math.min(480, Math.round(Number(body.durationMin) || 30)))
  if (body.bufferMin !== undefined) data.bufferMin = Math.max(0, Math.min(120, Math.round(Number(body.bufferMin) || 0)))
  if (body.location !== undefined) data.location = String(body.location).trim().slice(0, 160) || null
  if (body.description !== undefined) data.description = String(body.description).trim().slice(0, 800) || null
  if (body.avail !== undefined) data.avail = cleanAvailJson(body.avail)
  if (body.active !== undefined) data.active = body.active === true

  if (body.logoSvg !== undefined) {
    if (body.logoSvg === null || body.logoSvg === '') {
      data.logoUrl = null
    } else {
      const svg = sanitizeSvg(String(body.logoSvg))
      if (!svg) return NextResponse.json({ error: 'That file does not read as an SVG image. Export your logo as SVG and try again.' }, { status: 400 })
      data.logoUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
    }
  }

  const updated = await db.bookingLink.update({ where: { id }, data })
  return NextResponse.json({ link: updated })
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Missing link id.' }, { status: 400 })
  const link = await db.bookingLink.findFirst({ where: { id, userId }, select: { id: true } })
  if (!link) return NextResponse.json({ error: 'That booking link is not yours.' }, { status: 404 })
  await db.bookingLink.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
