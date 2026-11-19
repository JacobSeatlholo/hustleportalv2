import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Users, Zap, Wallet, Handshake, Target, TrendingUp, Mail, CalendarClock } from 'lucide-react'
import CorporateShell from '@/components/hp/corporate/CorporateShell'
import DemoTools from '@/components/hp/corporate/DemoTools'
import { getStrategist, REFERRAL_PER_LEAD_CENTS, MANAGED_PER_LEAD_CENTS } from '@/lib/corporate'
import { dashboardKeyFor } from '@/lib/corporateKeys'
import { whitelabelMeta } from '@/lib/corporate'
import { db } from '@/lib/db'
import { sast } from '@/lib/esign'

// ============ PARTNER DASHBOARD (Task 215, owner; analytics upgrade Task 218) ============
// The strategist's own analytics surface: every corporate account that signed up
// through THEIR door, what the credit did, the outreach volume their clients run,
// and who to call next. Laws:
//   - PRIVACY IS THE WHERE-CLAUSE: every query filters corporatePartner = slug.
//     A signup that did not come through this strategist's link or door does not
//     exist on this page — not in the KPIs, not in the table, not anywhere. The
//     funnel QA suite pins this: freshly registered control accounts (B2C, no
//     partner) must never appear in this page's HTML.
//   - GATED like the deal room: wrong or missing ?key= returns notFound() —
//     the page does not exist for anyone else, and no public page links here.
//   - WHITELABEL: only the strategist's brand renders. The engine stays
//     invisible (Task 214 law holds on every partner surface).
//   - THE ECONOMICS ARE THE AGREEMENT: R50 per managed lead delivered on
//     clients the strategist introduced (REFERRAL_PER_LEAD_CENTS), computed
//     from live reveal transactions — accrual, not a promise.
//   - COLOURED TAGS (owner, Task 218): every account row carries status tags —
//     NEW (opened, not yet revealing), ACTIVATED (leads revealed), PAYING (real
//     money topped up), IDLE (activated but quiet 21+ days) — with a legend, so
//     the strategist reads the room at a glance.
//   - EMAIL CAMPAIGNS (owner, Task 218): aggregates only — how many emails the
//     platform sent on behalf of his clients. Never contents, never recipients:
//     those live inside each client's own account.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = getStrategist(slug)
  const meta = s
    ? whitelabelMeta(s, 'Partner dashboard', 'Your sign-ups, their numbers, and who to call next.')
    : { title: 'Partner dashboard' }
  return { ...meta, robots: { index: false, follow: false } }
}

const DAY = 24 * 60 * 60 * 1000

// Coloured status tags (owner: "there also needs to be tags with colours").
// Each tag: fixed label, tailwind classes, one-line legend meaning.
const TAGS = {
  NEW: { label: 'New', cls: 'bg-sky-500/15 text-sky-700 border-sky-500/40', legend: 'opened through your door, first managed lead not revealed yet' },
  ACTIVATED: { label: 'Activated', cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40', legend: 'already revealing managed leads' },
  PAYING: { label: 'Paying', cls: 'bg-amber-500/15 text-amber-700 border-amber-500/40', legend: 'real money topped up beyond the starting credit' },
  IDLE: { label: 'Idle', cls: 'bg-rose-500/15 text-rose-700 border-rose-500/40', legend: 'revealed before, but quiet for 21+ days — call today' },
} as const

type TagKey = keyof typeof TAGS

function tagsFor(r: { reveals: number; topupCents: number; lastActive: Date | null }): TagKey[] {
  const t: TagKey[] = []
  if (r.reveals > 0) t.push('ACTIVATED')
  if (r.topupCents > 0) t.push('PAYING')
  if (r.reveals === 0) t.push('NEW')
  else if (r.lastActive && Date.now() - r.lastActive.getTime() > 21 * DAY) t.push('IDLE')
  return t
}

export default async function PartnerDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ key?: string; demo?: string }>
}) {
  const { slug } = await params
  const { key, demo } = await searchParams
  const partner = getStrategist(slug)
  // Wrong key or unknown slug = indistinguishable from a dead link.
  if (!partner || key !== dashboardKeyFor(slug)) notFound()
  // Demo tools render ONLY when the URL carries &demo=1 — the walkthrough URL
  // the partner receives never does, so Kelo sees a populated dashboard with
  // no seed/reset chrome. The key gates the endpoint itself. (owner, Task 221
  // round 4)
  const showDemoTools = demo === '1'

  // THE PRIVACY LAW: every query below filters corporatePartner = slug. This is
  // the only attribution this page can ever see — signups that arrived any other
  // way (direct, referral code, another strategist) are invisible here.
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
  // Emails the platform engine sent on behalf of these clients, per account and
  // in aggregate. Aggregates only — never subjects, never recipients.
  const emailRows = ids.length > 0
    ? await db.emailLog.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, direction: 'OUT', status: 'SENT' },
        _count: { _all: true },
      })
    : []
  const emailByUser = new Map(emailRows.map((r) => [r.userId, r._count._all]))
  const email30 = ids.length > 0
    ? await db.emailLog.count({
        where: { userId: { in: ids }, direction: 'OUT', status: 'SENT', createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
      })
    : 0

  const rows = accounts.map((a) => ({
    ...a,
    reveals: revealsByUser.get(a.id) ?? 0,
    lastActive: lastByUser.get(a.id) ?? null,
    topupCents: topupByUser.get(a.id) ?? 0,
    emails: emailByUser.get(a.id) ?? 0,
    balance: a.wallet?.balance ?? 0,
  }))

  const totalReveals = rows.reduce((n, r) => n + r.reveals, 0)
  const activated = rows.filter((r) => r.reveals > 0).length
  // The strategist's share: R50 per managed lead, straight from the agreement.
  const shareCents = totalReveals * REFERRAL_PER_LEAD_CENTS
  // Signup momentum (owner: "number of sign ups").
  const new7 = accounts.filter((a) => Date.now() - a.createdAt.getTime() < 7 * DAY).length
  const new30 = accounts.filter((a) => Date.now() - a.createdAt.getTime() < 30 * DAY).length
  // Eight-week signup histogram, one bar per week, oldest left.
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = Date.now() - (7 - i) * 7 * DAY
    const start = end - 7 * DAY
    const n = accounts.filter((a) => a.createdAt.getTime() > start && a.createdAt.getTime() <= end).length
    return { n, label: new Date(start + 6 * DAY).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) }
  })
  const weekMax = Math.max(1, ...weeks.map((w) => w.n))
  // Client money aggregates: real top-ups and credit still on the card.
  const topupTotal = rows.reduce((n, r) => n + r.topupCents, 0)
  const balanceTotal = rows.reduce((n, r) => n + r.balance, 0)
  const emailTotal = rows.reduce((n, r) => n + r.emails, 0)
  // Closing targets: a balance below one managed lead cannot reveal anything —
  // that account needs the top-up conversation now.
  const callNow = rows.filter((r) => r.reveals > 0 && r.balance < MANAGED_PER_LEAD_CENTS)
  const warming = rows.filter((r) => r.reveals > 0 && r.balance >= MANAGED_PER_LEAD_CENTS && r.balance < 3 * MANAGED_PER_LEAD_CENTS)

  // THE NETWORK (owner, Task 221 round 4): members of this floor who
  // introduced other members of this floor through their Grow & Share links
  // (?ref=CODE on the partnership's own domain). The referral law pays the
  // member R10 when their invite opens an account, and the desk splits the
  // R50 managed-lead share per the agreement (R25 to the sourcing member).
  // Names and counts only: the same privacy where-clause rules everything
  // here, both sides of every row must belong to THIS slug's floor.
  const networkRows = await db.referral.findMany({
    where: { invitedUser: { corporatePartner: slug }, referrer: { corporatePartner: slug } },
    select: {
      referrer: { select: { id: true, name: true } },
      invitedUser: { select: { id: true, name: true } },
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  const networkMap = new Map<string, { name: string; invited: number; activated: number; lastAt: Date }>()
  for (const r of networkRows) {
    const e = networkMap.get(r.referrer.id) ?? { name: r.referrer.name, invited: 0, activated: 0, lastAt: r.createdAt }
    e.invited += 1
    if (r.invitedUser && (revealsByUser.get(r.invitedUser.id) ?? 0) > 0) e.activated += 1
    if (r.createdAt > e.lastAt) e.lastAt = r.createdAt
    networkMap.set(r.referrer.id, e)
  }
  const network = [...networkMap.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.invited - a.invited)

  return (
    <CorporateShell footer={false}>
      <main className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-6 py-14 space-y-10">
          {showDemoTools && <DemoTools slug={slug} dashKey={key as string} />}
          <header className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand flex items-center gap-2">
              <Handshake className="h-3.5 w-3.5" /> Partner dashboard — {partner.company}
            </p>
            <h1 className="font-display text-4xl leading-tight">Your numbers, live</h1>
            <p className="text-muted-foreground">
              Every corporate account opened through your door, what their starting credit did, the
              outreach volume they run, and where the top-up conversations are. Accounts that did not
              come through your link never appear here. Your share accrues at R50 per managed lead
              delivered on clients you introduced, per the partnership agreement.
            </p>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Users, big: String(rows.length), small: 'corporate accounts opened through your door' },
              { icon: CalendarClock, big: String(new7), small: `sign-ups in the last 7 days · ${new30} in 30 days` },
              { icon: Zap, big: String(activated), small: 'accounts already revealing leads (activated)' },
              { icon: TrendingUp, big: String(totalReveals), small: 'managed leads delivered, all accounts' },
              { icon: Wallet, big: `R${Math.round(shareCents / 100)}`, small: 'your accrued share at R50 per managed lead' },
              { icon: Mail, big: String(emailTotal), small: `emails sent for your clients · ${email30} in the last 30 days` },
              { icon: Wallet, big: `R${Math.round(topupTotal / 100)}`, small: 'real money your clients topped up' },
              { icon: Target, big: `R${Math.round(balanceTotal / 100)}`, small: 'client credit on hand across all accounts' },
            ].map((c, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-5 space-y-1.5">
                <c.icon className="h-5 w-5 text-brand" />
                <p className="font-display text-2xl">{c.big}</p>
                <p className="text-xs text-muted-foreground">{c.small}</p>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <p className="font-semibold text-sm">Sign-ups per week, last 8 weeks</p>
            <div className="flex items-end gap-2 h-28">
              {weeks.map((w, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${w.n} sign-ups`}>
                  <div className="w-full rounded-t-md bg-brand/80" style={{ height: `${Math.max(4, (w.n / weekMax) * 88)}px` }} />
                  <span className="text-[10px] text-muted-foreground">{w.n}</span>
                  <span className="text-[9px] text-muted-foreground/70">{w.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 space-y-2">
            <p className="font-semibold text-sm">What the tags mean</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TAGS) as TagKey[]).map((k) => (
                <span key={k} className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${TAGS[k].cls}`}>
                  {TAGS[k].label}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {(Object.keys(TAGS) as TagKey[]).map((k) => `${TAGS[k].label} — ${TAGS[k].legend}`).join(' · ')}
            </p>
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
                the moment it registers, with its tags and numbers.
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-semibold">Account</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Opened</th>
                        <th className="px-4 py-3 font-semibold">Balance</th>
                        <th className="px-4 py-3 font-semibold">Leads revealed</th>
                        <th className="px-4 py-3 font-semibold">Top-ups</th>
                        <th className="px-4 py-3 font-semibold">Emails sent</th>
                        <th className="px-4 py-3 font-semibold">Last activity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => {
                        const tags = tagsFor(r)
                        return (
                          <tr key={r.id}>
                            <td className="px-4 py-3">
                              <p className="font-semibold">{r.businessName || r.name}</p>
                              <p className="text-xs text-muted-foreground">{r.name}</p>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {tags.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                                {tags.map((t) => (
                                  <span key={t} className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${TAGS[t].cls}`}>
                                    {TAGS[t].label}
                                  </span>
                                ))}
                              </div>
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
                            <td className="px-4 py-3 text-muted-foreground">{r.emails > 0 ? r.emails : '—'}</td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">
                              {r.lastActive ? sast(r.lastActive) : 'not yet'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Balances below R{Math.round(MANAGED_PER_LEAD_CENTS / 100)} cannot afford their next
              managed lead — those are your close-now list. Share accrues per the agreement and is
              invoiced against delivered leads. Email counts are volumes only; what your clients say
              stays inside their own accounts.
            </p>
          </section>

          {/* THE NETWORK (owner, Task 221 round 4): the flywheel made visible.
              The floor's members are the marketing force; this section shows
              the strategist whose introductions actually land. */}
          <section className="space-y-3">
            <h2 className="font-display text-2xl">Your network</h2>
            <p className="text-sm text-muted-foreground">
              Every member of your floor carries a Grow &amp; Share link that points at your own
              domain{partner.appDomain ? <> ({partner.appDomain})</> : null}. When they bring a
              business owner in through it, the account opens on your funnel, the member earns R10
              on the spot, and the referral law pays on delivered leads: R50 per managed lead is
              your share, R25 of it to the member who sourced the signup. Your clients become your
              marketing force.
            </p>
            {network.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
                No member introductions yet. Tell your floor: their invite link is under Grow &amp;
                Share in their menu, and every business owner they bring in lands on your door.
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-semibold">Member</th>
                        <th className="px-4 py-3 font-semibold">Introduced</th>
                        <th className="px-4 py-3 font-semibold">Activated</th>
                        <th className="px-4 py-3 font-semibold">Last introduction</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {network.map((n) => (
                        <tr key={n.id}>
                          <td className="px-4 py-3 font-semibold">{n.name}</td>
                          <td className="px-4 py-3">{n.invited}</td>
                          <td className="px-4 py-3 text-muted-foreground">{n.activated}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{sast(n.lastAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </CorporateShell>
  )
}
