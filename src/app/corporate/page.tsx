import type { Metadata } from 'next'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import CorporateContent from '@/components/hp/corporate/CorporateContent'
import { BH_JSON_LD } from '@/lib/jsonld'

// Task 207/208: the GENERIC corporate door. Served at /corporate on the main
// domain, and at the root of corporate.hustleportal.online via the host
// rewrite in next.config.ts (add the subdomain in Vercel Domains, one click).
// Each brand strategist gets their own branded door at /corporate/<slug>
// (first: /corporate/trinitydirect).
//
// Laws this surface obeys:
//  - Task 221 round 4 (owner, 2026-11-19, the A/B call): this door is STRAIGHT
//    BUSINESS. No strategist door mentions, no credit ladder, no coupons in
//    the copy: the rate, the maths and the trust only. The Task 216/217
//    asymmetry ladder is retired on this surface; welcome credits and
//    referral links are the strategist doors' game.
//  - The BH trust footer is ON here (owner, same call: trust converts) — it
//    stays OFF on partner doors, where the Task 214 whitelabel law holds.
//  - Truthful numbers only: R110 managed rate and R250+ agency anchor are the
//    established facts.
//  - The managed-rate law: R110 shows against the agency market, never
//    beside the self-serve reveal prices.
//  - Boss voice: no dashes in the copy.
//  - Light by default (trust read: white, warm black ink, gold accents),
//    dark available from the corner toggle.

export const metadata: Metadata = {
  title: 'HustlePortal Corporate — verified leads for corporate sales floors',
  description:
    'Done for you, verified before a cent moves. Verified business leads delivered into your sales pipeline at one flat R110 managed rate, against the R250+ agencies advertise.',
}

export default function CorporatePage() {
  return (
    // Task 221 round 4 (owner): the BH trust footer is ON. The old Task 215
    // circumvention rule (no entity block, a strategist door could walk here)
    // gave way to the trust argument: a CFO reading this page should see the
    // real company behind the offer. Partner doors keep footer={false}.
    <CorporateShell>
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
