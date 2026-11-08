import { db } from '@/lib/db'
import { parseAvail, computeSlots } from '@/lib/booking'
import BookingPicker, { type PickerProps } from './BookingPicker'

/**
 * /book/<slug> — the public booking page, the guest-facing face of the
 * calendar. Styled after the Gold Rush email look on purpose: warm paper,
 * ink banner, the BH mark, gold actions, and the SAME full-width mascot hero
 * the confirmation email arrives with — page and mail read as one voice.
 * The picture matches the kind: a phone-call page shows the badger on the
 * phone, an online-meeting page shows him on a video call, everything else
 * the calendar scene.
 *
 * The owner's availability turns into real free slots here (next 14 days,
 * their existing calendar respected, 2h lead time). The guest picks, signs
 * with a name and email, and the booking is CONFIRMED on the owner's
 * calendar before the page finishes saying so.
 */
export const dynamic = 'force-dynamic'

/** The mascot that matches the occasion (mirrors the mail's kind-aware pick). */
function heroForKind(kind: string): { src: string; alt: string } {
  if (kind === 'PHONE') return { src: '/email/mascot-phone.jpg', alt: 'The HustlePortal honey badger taking a phone call, BH on his vest' }
  if (kind === 'VIDEO') return { src: '/email/mascot-video.jpg', alt: 'The HustlePortal honey badger waving at a video call on his laptop, BH on his vest' }
  return { src: '/email/mascot-calendar.jpg', alt: 'The HustlePortal honey badger holding up a calendar page, BH on his vest' }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const link = await db.bookingLink.findUnique({
    where: { slug },
    include: { user: { select: { name: true, businessName: true } } },
  })
  if (!link || !link.active) return { title: 'Booking — HustlePortal' }
  const owner = link.user.businessName?.trim() || link.user.name
  return {
    title: `Book ${link.title} · ${owner}`,
    description: link.description || `Pick a time that suits you — ${link.title} with ${owner}.`,
  }
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const link = await db.bookingLink.findUnique({
    where: { slug },
    include: { user: { select: { name: true, businessName: true } } },
  })

  // Hero picked before any early return: the shell needs it even for the
  // not-available card, and an unknown kind simply reads as the calendar.
  const hero = heroForKind(link?.kind || '')

  const shell = (children: React.ReactNode) => (
    <main style={{ minHeight: '100vh', background: '#FBF3DC', padding: '26px 12px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ background: '#14161B', borderRadius: '14px 14px 0 0', padding: '15px 26px', display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 34, height: 34, background: '#f5c518', borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 15, color: '#14161B' }}>BH</span>
          <span style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 17, letterSpacing: 0.4 }}>HustlePortal</span>
        </div>
        <div style={{ height: 4, background: '#f5c518' }} />
        {/* The full theme print: the same mascot hero the emails carry. */}
        <div style={{ background: '#F8CD6E', fontSize: 0, lineHeight: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hero.src} alt={hero.alt} style={{ display: 'block', width: '100%', height: 'auto', border: 0 }} />
        </div>
        {children}
      </div>
    </main>
  )

  if (!link || !link.active) {
    return shell(
      <div style={{ background: '#FFFDF7', borderRadius: '0 0 14px 14px', padding: '40px 30px', textAlign: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#1F2937' }}>This booking page is not available</div>
        <p style={{ color: '#857B5E', fontSize: 14, lineHeight: 1.6, marginTop: 10 }}>
          The link may be wrong, or the owner has paused bookings for now.
          Check the link you were sent, or contact them another way.
        </p>
      </div>,
    )
  }

  const ownerName = link.user.businessName?.trim() || link.user.name
  const avail = parseAvail(link.avail)
  const busy = await db.appointment.findMany({
    where: {
      userId: link.userId,
      startsAt: { gte: new Date(Date.now() - 26 * 60 * 60 * 1000), lte: new Date(Date.now() + 16 * 86_400_000) },
    },
    select: { startsAt: true, endsAt: true },
  })
  const days = computeSlots({
    avail,
    durationMin: link.durationMin,
    bufferMin: link.bufferMin,
    busy: busy.map((b) => ({ start: b.startsAt, end: b.endsAt || new Date(b.startsAt.getTime() + 60 * 60_000) })),
    from: new Date(),
    days: 14,
  })

  const props: PickerProps = {
    slug: link.slug,
    ownerName,
    title: link.title,
    kind: link.kind,
    durationMin: link.durationMin,
    location: link.location,
    description: link.description,
    logoUrl: link.logoUrl,
    days,
  }
  return shell(<BookingPicker {...props} />)
}
