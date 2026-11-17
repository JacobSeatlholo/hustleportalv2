import type { Metadata } from 'next'
import Link from 'next/link'
import CorporateShell from '@/components/hp/corporate/CorporateShell'

// Task 213: plain-language terms of service, linked from the corporate trust
// footer. Operator details are the ones the platform already trades under;
// no registration numbers or invented policy IDs appear anywhere here.

export const metadata: Metadata = {
  title: 'Terms of Service — HustlePortal',
  robots: { index: true, follow: true },
}

const H2 = 'font-display text-xl pt-2'
const P = 'text-sm text-muted-foreground leading-relaxed'

export default function TermsPage() {
  return (
    <CorporateShell>
      <main className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-14 space-y-6">
          <header className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Legal</p>
            <h1 className="font-display text-3xl">Terms of Service</h1>
            <p className={P}>
              These terms govern your use of HustlePortal™, the lead generation and business
              platform. They are written in plain language so nothing hides in the small print.
            </p>
          </header>

          <section className="space-y-2">
            <h2 className={H2}>1. Who we are</h2>
            <p className={P}>
              HustlePortal™ is built and operated by Business Hustle, a trading name of Simple
              Eternity Holdings (Pty) Ltd, 99 Kloof St, Gardens, Cape Town, 8001, South Africa.
              Reach us at <span className="text-foreground">team@businesshustle.co.za</span> or{' '}
              <span className="text-foreground">support@hustleportal.online</span> for anything
              about these terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>2. What the service does</h2>
            <p className={P}>
              HustlePortal finds, verifies and delivers business contact data as leads, and gives
              you the working tools around them: a pipeline, tasks, clients, mail, calendar and
              documents. The self-serve edition runs on prepaid credits. The corporate edition is
              managed for you and runs on a written agreement with its own agreed rate.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>3. Your account</h2>
            <p className={P}>
              Give us accurate details when you register, keep your password safe, and do not share
              one seat between several people. You are responsible for what happens on your account.
              Tell us immediately if you suspect someone else is in it, and we will lock it down and
              help you recover it.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>4. Credits, payments and the verification guarantee</h2>
            <p className={P}>
              A lead reveal consumes credits at the rate shown to you in the product before you
              spend. Our billing guarantee is simple and enforced in code: an unverified lead is
              never charged. Credits are prepaid, they have no cash value, and unused credits stay
              on your wallet for as long as your account is active. Corporate accounts are billed
              per the agreement you signed, at the flat agreed rate.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>5. How you may use the lead data</h2>
            <p className={P}>
              Leads are business contact details delivered for your own sales and marketing use.
              When you contact them you act as the responsible party under POPIA: contact people in
              connection with their business, honour a request to stop contacting, and never resell
              raw lists without a written agreement with us. If a business asks you who supplied
              the details, do not hide us; if they ask to be removed, point them to the Remove my
              business page and we will hold the suppression.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>6. Acceptable use</h2>
            <p className={P}>
              Do not use the platform for anything unlawful, do not attack or probe it, do not
              scrape it, do not abuse the mail or signing systems, and do not try to get around
              credit costs or access controls. We may pause an account that breaks these rules,
              with an explanation and a path to restore it.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>7. Electronic signatures</h2>
            <p className={P}>
              Documents signed on HustlePortal are signed on our own first-party e-sign system. In
              South Africa an ordinary electronic signature has legal effect under the Electronic
              Communications and Transactions Act 25 of 2002, and every signing session produces a
              timestamped audit certificate. Signed files and their certificates are retained in
              the document owner&apos;s records.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>8. Data protection</h2>
            <p className={P}>
              We process personal information under the Protection of Personal Information Act. Our
              privacy notice, which forms part of these terms, explains exactly what we process,
              why, and how to exercise your rights. See{' '}
              <Link href="/legal/privacy" className="text-brand underline underline-offset-2">Privacy &amp; POPIA</Link>.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>9. Availability</h2>
            <p className={P}>
              We keep the platform online and patched, and we fix faults fast, but no service is
              perfect. Where something breaks we say so plainly, we work on it, and your data is
              never lost to a silent outage.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>10. Ending the service</h2>
            <p className={P}>
              You can close your account at any time and take your data with you; ask and we will
              provide an export. We may end these terms for an account that seriously or repeatedly
              breaks them, with notice where the law requires it. Sections that should survive
              ending, like data protection and liability, do survive.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>11. Liability</h2>
            <p className={P}>
              The platform is a business tool, sold as a business tool. To the maximum extent the
              law allows, our total liability to you for any claim is limited to the amounts you
              paid us in the three months before the claim, and we are not liable for indirect or
              consequential loss such as lost profits or lost data caused by your own use of the
              leads. Nothing here limits liability that cannot legally be limited.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className={H2}>12. Changes and governing law</h2>
            <p className={P}>
              If we change these terms materially we will tell you in the product or by email
              before the change takes effect. These terms are governed by the laws of South Africa
              and the South African courts have jurisdiction.
            </p>
          </section>
        </div>
      </main>
    </CorporateShell>
  )
}
