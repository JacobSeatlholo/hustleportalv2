import type { Metadata } from 'next'
import Link from 'next/link'
import CorporateShell from '@/components/hp/corporate/CorporateShell'

// Task 213: the POPIA privacy notice, linked from the corporate trust footer.
// Every statement matches real product behaviour: the /remove-listing opt-out,
// the first-party e-sign audit trail, the sealed task records.

export const metadata: Metadata = {
  title: 'Privacy & POPIA — HustlePortal',
  robots: { index: true, follow: true },
}

const H2 = 'font-display text-xl pt-2'
const P = 'text-sm text-muted-foreground leading-relaxed'

export default function PrivacyPage() {
  return (
    <CorporateShell>
      <main className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-14 space-y-6">
          <header className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Legal</p>
            <h1 className="font-display text-3xl">Privacy &amp; POPIA</h1>
            <p className={P}>
              This notice explains what personal information HustlePortal processes, why, and how
              to exercise your rights under the Protection of Personal Information Act 4 of 2013
              (POPIA). Plain language, no hiding.
            </p>
          </header>

          <section className="space-y-2">
            <h2 className={H2}>1. Who is responsible</h2>
            <p className={P}>
              The responsible party is Business Hustle, a trading name of Simple Eternity Holdings
              (Pty) Ltd, 99 Kloof St, Gardens, Cape Town, 8001, South Africa. Privacy questions,
              access requests and objections go to{' '}
              <span className="text-foreground">team@businesshustle.co.za</span> or{' '}
              <span className="text-foreground">support@hustleportal.online</span>.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>2. What we process</h2>
            <p className={P}>
              <span className="text-foreground font-medium">Your account data:</span> your name,
              email, business name, team details, wallet and billing records, and the content you
              create in the product such as clients, notes, tasks, deals and documents.
            </p>
            <p className={P}>
              <span className="text-foreground font-medium">Business contact data:</span> business
              names, public business phone numbers and email addresses, trade and city, which we
              source from public business channels and verify before delivery as leads.
            </p>
            <p className={P}>
              <span className="text-foreground font-medium">Technical records:</span> IP address
              and device information for security and abuse prevention, and the full audit trail of
              every electronic signature (who signed, when, from where, and the SHA-256 hashes of
              the document before and after signing).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>3. Why we process it</h2>
            <p className={P}>
              To provide the service you signed up for (sourcing, verifying and delivering leads;
              running your pipeline), to bill correctly, to keep the platform and your account
              secure, to produce signing audit records, and to honour opt-outs. We do not sell
              personal information to anyone.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>4. The lawful basis</h2>
            <p className={P}>
              Business contact details are processed in our and our clients&apos; legitimate
              interest where the details are publicly listed for business purposes. Direct
              marketing to a listed business is done in line with POPIA&apos;s section 69
              protections, and any business can stop it in one click. Account, billing and signing
              records are processed to perform our contract with you and to keep the records the
              law expects.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>5. Remove my business, in one click</h2>
            <p className={P}>
              A listed business never needs an account to opt out. The public{' '}
              <Link href="/remove-listing" className="text-brand underline underline-offset-2">Remove my business</Link>{' '}
              page takes the business name and a contact, the suppression goes live within a
              minute, and our team confirms at the contact given. Once suppressed, the business is
              excluded from sourcing and delivery pipelines, and the suppression record itself is
              kept so it stays removed.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>6. Who we share with</h2>
            <p className={P}>
              Your data stays on our own infrastructure. We use service providers to host the
              platform, run the database and deliver email, bound to process only for us. Leads
              you receive are delivered to you as the account holder; from that point you are the
              responsible party for how you use them. Electronic signatures are executed entirely
              on our own first-party system, with no third-party signing service involved.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>7. Security</h2>
            <p className={P}>
              Traffic is encrypted in transit, access to records is authenticated and scoped to the
              account, signing sessions are gated by unguessable tokens, and accountability
              records are hash-sealed in order so tampering shows. Sensitive documents are stored
              out of the public web root and streamed only through gated routes.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>8. How long we keep things</h2>
            <p className={P}>
              Account and content data is kept while your account is active and for a reasonable
              period after, at your request we export and then delete it. Signed documents and
              their audit certificates are retained in the document owner&apos;s records as the
              proof of the agreement. Suppression records are kept so removed businesses stay
              removed.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>9. Your rights</h2>
            <p className={P}>
              You may ask what we hold about you, ask for corrections, ask for deletion where the
              law allows, object to processing, and withdraw consent for marketing. Write to{' '}
              <span className="text-foreground">team@businesshustle.co.za</span> and we will
              respond within the POPIA timeframes. If you are not satisfied, you may complain to
              the Information Regulator of South Africa.
            </p>
          </section>
        </div>
      </main>
    </CorporateShell>
  )
}
