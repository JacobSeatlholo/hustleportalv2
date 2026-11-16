import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import CorporateContent from '@/components/hp/corporate/CorporateContent'
import { STRATEGISTS, getStrategist } from '@/lib/corporate'

// Task 208: the strategist doors. /corporate/trinitydirect is Kelo Martin's
// branded version of the corporate offer: his company card, the partnership
// named the way the boss stated it, the referral economics spelled out, the
// earnings calculator, and the claim form that attributes the claim to his
// slug (plus ?via=<code> when one of his enrolled members did the outreach).
// The boss tracks every claim at /api/admin/exec/corporate (exec only).

export function generateStaticParams() {
  return STRATEGISTS.map((s) => ({ slug: s.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = getStrategist(slug)
  if (!s) return { title: 'HustlePortal Corporate' }
  return {
    title: `${s.company} × HustlePortal Corporate — verified leads, done for you`,
    description: `${s.company} presents HustlePortal Corporate in strategic partnership: R550 in starting credit, R108 per verified lead, done for you. Led by ${s.name}.`,
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
