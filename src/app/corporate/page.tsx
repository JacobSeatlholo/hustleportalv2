import type { Metadata } from 'next'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import CorporateContent from '@/components/hp/corporate/CorporateContent'
import { BH_JSON_LD } from '@/lib/jsonld'

// Task 207/208: the GENERIC corporate door. Served at /corporate on the main
// domain, and at the root of corporate.hustleportal.online via the host
// rewrite in next.config.ts (add the subdomain in Vercel Domains, one click).
// Each brand strategist gets their own branded door at /corporate/<slug>
// (first: /corporate/trinitydirect); this page stays the neutral version of
// the same offer and points at the strategist doors.
//
// Laws this surface obeys:
//  - Truthful numbers only: R550 credit is the owner-set onboarding promise,
//    R108 managed rate and R250+ agency anchor are the established facts,
//    R0 is simply true.
//  - The managed-rate law: R108 shows against the agency market, never
//    beside the self-serve reveal prices.
//  - Boss voice: no dashes in the copy.
//  - Light by default (trust read: white, warm black ink, gold accents),
//    dark available from the corner toggle.

export const metadata: Metadata = {
  title: 'HustlePortal Corporate — verified leads for corporate sales floors',
  description:
    'Done for you, verified before a cent moves. R550 in starting credit for corporate accounts, delivered through brand strategists in strategic partnership with HustlePortal.',
}

export default function CorporatePage() {
  return (
    // Task 215 (owner): NO footer here either — the entity block, the Cape
    // Town address and the social handles are a circumvention trail. A
    // prospect who lands on a strategist's door can walk to /corporate, and
    // the footer used to hand them the operator straight away. The legal
    // pages stay reachable at /legal/terms, /legal/privacy and /remove-listing.
    <CorporateShell footer={false}>
      {/* Structured data lives HERE, not in the root layout, so partner doors
          never inherit HustlePortal schema (Task 214). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BH_JSON_LD) }}
      />
      <main className="min-h-screen bg-background">
        <CorporateContent />
      </main>
    </CorporateShell>
  )
}
