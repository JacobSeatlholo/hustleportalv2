import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import CorporateContent from '@/components/hp/corporate/CorporateContent'
import { STRATEGISTS, getStrategist, whitelabelMeta } from '@/lib/corporate'
import { whitelabelJsonLd } from '@/lib/jsonld'
import { db } from '@/lib/db'

// Task 208: the strategist doors. /corporate/trinitydirect is the branded
// version of the corporate offer for Trinity Direct Consortium (Pty) Ltd:
// their company card and partnership, presented as pure sales (Task 210 law —
// no commission economics client-facing). The claim form attributes the claim
// to the slug (plus ?via=<code> when an enrolled member did the outreach), and
// the boss tracks every claim at /api/admin/exec/corporate (exec only).
// Task 211: the internal deal room lives at /corporate/<slug>/documents —
// gated by key, never linked from this page.

export function generateStaticParams() {
  return STRATEGISTS.map((s) => ({ slug: s.slug }))
}

// Task 219: the story wall reads the live testimonial table, so the door
// renders per request — a story the desk approves appears on the next view,
// not on the next deploy. (Params alone would let Next prerender this page
// with the wall frozen at build time.)
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = getStrategist(slug)
  if (!s) return { title: 'HustlePortal Corporate' }
  // Task 214 whitelabel law: the strategist's door carries NO engine brand —
  // title, description, og/twitter, app name, keywords, everything. Prospects
  // must never be able to Google around the strategist back to HustlePortal.
  return whitelabelMeta(
    s,
    `${s.company} — verified leads for corporate sales floors, done for you`,
    `${s.company} presents the corporate edition of the lead engine: R550 in starting credit, exactly five managed leads, R110 per qualified lead reveal. Led by ${s.name}.`,
  )
}

export default async function StrategistDoor({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const partner = getStrategist(slug)
  if (!partner) notFound()
  // Task 219: the door's story wall — approved testimonials submitted through
  // THIS door only. The approved flag is the human yes; nothing pending ever
  // reaches the render.
  const testimonials = await db.testimonial.findMany({
    where: { approved: true, refSlug: slug },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { id: true, name: true, business: true, location: true, body: true, rating: true },
  })
  return (
    <CorporateShell footer={false}>
      {/* Whitelabel structured data: the strategist IS the organization here. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(whitelabelJsonLd(partner)) }}
      />
      <main className="min-h-screen bg-background">
        <CorporateContent partner={partner} testimonials={testimonials} />
      </main>
    </CorporateShell>
  )
}
