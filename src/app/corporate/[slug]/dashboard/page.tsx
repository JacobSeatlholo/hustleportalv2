import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Users, Zap, Wallet, Handshake, Target, TrendingUp } from 'lucide-react'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import { getStrategist, REFERRAL_PER_LEAD_CENTS, MANAGED_PER_LEAD_CENTS } from '@/lib/corporate'
import { whitelabelMeta } from '@/lib/corporate'
import { db } from '@/lib/db'
import { sast } from '@/lib/esign'

// ============ PARTNER DASHBOARD (Task 215, owner) ============
// The strategist's own exec dashboard: every corporate account that signed up
// through their door, what the credit did, and who to call next. Laws:
//   - GATED like the deal room: wrong or missing ?key= returns notFound() —
//     the page does not exist for anyone else, and no public page links here.
//   - WHITELABEL: only the strategist's brand renders. The engine stays
//     invisible (Task 214 law holds on every partner surface).
//   - THE ECONOMICS ARE THE AGREEMENT: R50 per managed lead delivered on
//     clients the strategist introduced (REFERRAL_PER_LEAD_CENTS), computed
//     from live reveal transactions — accrual, not a promise.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = getStrategist(slug)
  const meta = s
    ? whitelabelMeta(s, 'Partner dashboard', 'Your sign-ups, their credit, and who to call next.')
    : { title: 'Partner dashboard' }
  return { ...meta, robots: { index: false, follow: false } }
}

export default async function PartnerDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ key?: string }>
}) {
  const { slug } = await params
  const { key } = await searchParams
  const partner = getStrategist(slug)
  // Wrong key or unknown slug = indistinguishable from a dead link.
  if (!partner || key !== partner.dashboardKey) notFound()

  const accounts = await db.user.findMany({
    where: { corporatePartner: slug },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, businessName: true, email: true, createdAt: true,
      wallet: { select: { balance: true } },
    },
  })
  const ids = accounts.map((a) => a.id)
  // Reveal counts per account: the managed-leads meter and the R50 accrual.
  const revealRows = ids.length > 0
    ? await db.creditTx.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, type: 'LEAD_REVEAL' },
        _count: { _all: true },
        _sum: { amount: true },
      })
    : []
  const revealsByUser = new Map(revealRows.map((r) => [r.userId, r._count._all]))
  const lastActivity = ids.length > 0
    ? await db.creditTx.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _max: { createdAt: true },
      })
    : []
  const lastByUser = new Map(lastActivity.map((r) => [r.userId, r._max.createdAt]))
  const topupRows = ids.length > 0
    ? await db.topUp.findMany({
        where: { userId: { in: ids }, status: 'PAID' },
        select: { userId: true, amountCents: true },
      })
    : []
  const topupByUser = new Map<string, number>()
  for (const t of topupRows) topupByUser.set(t.userId, (topupByUser.get(t.userId) ?? 0) + t.amountCents)

  const rows = accounts.map((a) => ({
    ...a,
    reveals: revealsByUser.get(a.id) ?? 0,
    lastActive: lastByUser.get(a.id) ?? null,
    topupCents: topupByUser.get(a.id) ?? 0,
    balance: a.wallet?.balance ?? 0,
  }))

  const totalReveals = rows.reduce((n, r) => n + r.reveals, 0)
  const activated = rows.filter((r) => r.reveals > 0).length
  // The strategist's share: R50 per managed lead, straight from the agreement.
  const shareCents = totalReveals * REFERRAL_PER_LEAD_CENTS
  // Closing targets: a balance below one managed lead cannot reveal anything —
  // that account needs the top-up conversation now.
  const callNow = rows.filter((r) => r.reveals > 0 && r.balance < MANAGED_PER_LEAD_CENTS)
  const warming = rows.filter((r) => r.reveals > 0 && r.balance >= MANAGED_PER_LEAD_CENTS && r.balance < 3 * MANAGED_PER_LEAD_CENTS)

  return (
    <CorporateShell footer={false}>
      <main className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-6 py-14 space-y-10">
          <header className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand flex items-center gap-2">
              <Handshake className="h-3.5 w-3.5" /> Partner dashboard — {partner.company}
            </p>
            <h1 className="font-display text-4xl leading-tight">Your sign-ups, live</h1>
            <p className="text-muted-foreground">
              Every corporate account opened through your door, what their starting credit did, and
              where the top-up conversations are. Your share accrues at R50 per managed lead
              delivered on clients you introduced, per the partnership agreement.
            </p>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Users, big: String(rows.length), small: 'corporate accounts opened through your door' },
              { icon: Zap, big: String(activated), small: 'accounts already revealing leads (activated)' },
              { icon: TrendingUp, big: String(totalReveals), small: 'managed leads delivered, all accounts' },
              { icon: Wallet, big: `R${Math.round(shareCents / 100)}`, small: 'your accrued share at R50 per managed lead' },
            ].map((c) => (
              <div key={c.small} className="rounded-2xl border border-border bg-card p-5 space-y-1.5">
                <c.icon className="h-5 w-5 text-brand" />
                <p className="font-display text-2xl">{c.big}</p>
                <p className="text-xs text-muted-foreground">{c.small}</p>
              </div>
            ))}
          </section>

          {callNow.length > 0 && (
            <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 space-y-2">
              <p className="font-semibold text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-amber-600" /> Close now — balance below one managed lead
              </p>
              <p className="text-sm text-muted-foreground">
                These accounts used their credit and cannot afford their next reveal. The top-up
                conversation is due: {callNow.map((r) => r.businessName || r.name).join(', ')}.
              </p>
            </section>
          )}
          {warming.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-5 space-y-2">
              <p className="font-semibold text-sm">Warming up — credit still on the card</p>
              <p className="text-sm text-muted-foreground">
                Active accounts with under three leads left in credit: {warming.map((r) => r.businessName || r.name).join(', ')}.
                A check-in now lands the top-up before they stall.
              </p>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="font-display text-2xl">Accounts</h2>
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
                No sign-ups yet. Share your door — every account that opens through it shows up here
                the moment it registers.
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-semibold">Account</th>
                        <th className="px-4 py-3 font-semibold">Opened</th>
                        <th className="px-4 py-3 font-semibold">Balance</th>
                        <th className="px-4 py-3 font-semibold">Leads revealed</th>
                        <th className="px-4 py-3 font-semibold">Top-ups</th>
                        <th className="px-4 py-3 font-semibold">Last activity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-3">
                            <p className="font-semibold">{r.businessName || r.name}</p>
                            <p className="text-xs text-muted-foreground">{r.name}</p>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{sast(r.createdAt)}</td>
                          <td className="px-4 py-3">
                            <span className={`font-semibold ${r.balance < MANAGED_PER_LEAD_CENTS ? 'text-amber-600' : ''}`}>
                              {`R${Math.round(r.balance / 100)}`}
                            </span>
                          </td>
                          <td className="px-4 py-3">{r.reveals}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {r.topupCents > 0 ? `R${Math.round(r.topupCents / 100)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {r.lastActive ? sast(r.lastActive) : 'not yet'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Balances below R{Math.round(MANAGED_PER_LEAD_CENTS / 100)} cannot afford their next
              managed lead — those are your close-now list. Share accrues per the agreement and is
              invoiced against delivered leads.
            </p>
          </section>
        </div>
      </main>
    </CorporateShell>
  )
}
