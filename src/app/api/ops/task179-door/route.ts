import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'

/**
 * TASK 179 ONE-TIME DOOR (deleted after use). Two actions, on record:
 *  mkDemoLink — create ONE demo booking link on the master seat (boss-first
 *               law: the boss tests the feature first), idempotent by title.
 *  status     — read back the link + the bookings it produced.
 * NO send paths, NO delete, NO edits beyond the one create.
 */

const DOOR_TOKEN = 'f340c9e0e32c37e94b1a762e3817896a3d5f11d6db531263'

function tokenOk(req: NextRequest): boolean {
  const got = req.headers.get('x-door-token') || ''
  if (!got || got.length !== DOOR_TOKEN.length) return false
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(DOOR_TOKEN))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  if (!tokenOk(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({} as { action?: string }))
  const action = String(body.action || '')

  if (action === 'mkDemoLink') {
    const master = await db.user.findUnique({
      where: { email: 'ceo@businesshustle.co.za' },
      select: { id: true, name: true, businessName: true },
    })
    if (!master) return NextResponse.json({ error: 'master seat not found' }, { status: 404 })
    const existing = await db.bookingLink.findFirst({ where: { userId: master.id, title: 'Consultation (demo)' } })
    if (existing) return NextResponse.json({ ok: true, existing: true, slug: existing.slug })
    let slug = ''
    for (let i = 0; i < 5; i++) {
      const c = require('crypto').randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 8)
      if (!(await db.bookingLink.findUnique({ where: { slug: c } }))) { slug = c; break }
    }
    const link = await db.bookingLink.create({
      data: {
        userId: master.id,
        slug,
        title: 'Consultation (demo)',
        kind: 'BOOKING',
        durationMin: 30,
        bufferMin: 10,
        location: 'Rooms 4, Gardens, Cape Town',
        description: 'QA demo link for Task 179 — the boss tests the booking page here.',
        avail: JSON.stringify({ '1': [{ s: '08:00', e: '18:00' }], '2': [{ s: '08:00', e: '18:00' }], '3': [{ s: '08:00', e: '18:00' }], '4': [{ s: '08:00', e: '18:00' }], '5': [{ s: '08:00', e: '18:00' }], '6': [{ s: '08:00', e: '13:00' }] }),
      },
    })
    return NextResponse.json({ ok: true, slug: link.slug, owner: master.businessName || master.name })
  }

  if (action === 'status') {
    const link = await db.bookingLink.findFirst({
      where: { title: 'Consultation (demo)' },
      include: { appointments: { orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, title: true, clientName: true, startsAt: true, gcalEventId: true } } },
    })
    if (!link) return NextResponse.json({ error: 'no demo link' }, { status: 404 })
    return NextResponse.json({ ok: true, slug: link.slug, bookings: link.bookings, active: link.active, appointments: link.appointments })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
