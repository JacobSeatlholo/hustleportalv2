import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import CorporateContent from '@/components/hp/corporate/CorporateContent'
import { STRATEGISTS, getStrategist } from '@/lib/corporate'

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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = getStrategist(slug)
  if (!s) return { title: 'HustlePortal Corporate' }
  return {
    title: `${s.company} × HustlePortal Corporate — verified leads, done for you`,
    description: `${s.company} presents HustlePortal Corporate in strategic partnership: R550 in starting credit, exactly five managed leads, R110 per qualified lead reveal. Led by ${s.name}.`,
  }
}

export default async function StrategistDoor({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const partner = getStrategist(slug)
  if (!partner) notFound()
  return (
    <CorporateShell>
      <main className="min-h-screen bg-background">
        <CorporateContent partner={partner} />
      </main>
    </CorporateShell>
  )
}
