'use client'

import { ErrorState, LoadingRows, StatCard, StatusBadge, fmtDate, fmtMoney } from '@/components/hustle/kit'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useResource } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import {
  Banknote, CalendarClock, CheckCircle2, Clock3, HandCoins, ReceiptText,
  Target, TrendingDown, TrendingUp, Wallet, Users,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'

type Dashboard = {
  kpis: {
    paidThisMonth: number; revenueAllTime: number; outstanding: number; overdueAmount: number
    expensesThisMonth: number; netThisMonth: number; activeClients: number; totalClients: number
    openTasks: number; activeProjects: number; billableHours: number; hoursThisMonth: number
    unpaidInvoices: number
  }
  series: { month: string; income: number; expenses: number }[]
  invoiceStatus: { status: string; count: number; amount: number }[]
  upcomingTasks: { id: string; title: string; status: string; priority: string; dueDate: string | null }[]
  recentPayments: { id: string; amount: number; method: string; paidAt: string; invoiceNumber: string; clientName: string }[]
  goals: { id: string; title: string; metric: string; targetValue: number; currentValue: number; period: string; status: string }[]
}

const PIE_COLORS: Record<string, string> = {
  PAID: '#059669', SENT: '#d97706', OVERDUE: '#e11d48', DRAFT: '#a1a1aa',
}

export function DashboardView({ currency }: { currency: string }) {
  const { data, loading, error, refresh } = useResource<Dashboard>('/api/dashboard')

  if (loading) return <LoadingRows rows={8} />
  if (error || !data) return <ErrorState message={error ?? 'Failed to load dashboard'} onRetry={refresh} />

  const { kpis, series, invoiceStatus, upcomingTasks, recentPayments, goals } = data
  const pieData = invoiceStatus.filter((s) => s.count > 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:gap-4">
        <StatCard label="Collected this month" value={fmtMoney(kpis.paidThisMonth, currency)} sub={`${fmtMoney(kpis.revenueAllTime, currency)} all time`} icon={Banknote} tone="positive" />
        <StatCard label="Outstanding" value={fmtMoney(kpis.outstanding, currency)} sub={kpis.overdueAmount > 0 ? `${fmtMoney(kpis.overdueAmount, currency)} overdue` : `${kpis.unpaidInvoices} unpaid invoices`} icon={HandCoins} tone={kpis.overdueAmount > 0 ? 'negative' : 'warning'} />
        <StatCard label="Expenses this month" value={fmtMoney(kpis.expensesThisMonth, currency)} icon={ReceiptText} />
        <StatCard label="Net this month" value={fmtMoney(kpis.netThisMonth, currency)} sub="collected − spent" icon={kpis.netThisMonth >= 0 ? TrendingUp : TrendingDown} tone={kpis.netThisMonth >= 0 ? 'positive' : 'negative'} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:gap-4">
        <StatCard label="Active clients" value={String(kpis.activeClients)} sub={`${kpis.totalClients} in CRM`} icon={Users} />
        <StatCard label="Active projects" value={String(kpis.activeProjects)} icon={Target} />
        <StatCard label="Open tasks" value={String(kpis.openTasks)} icon={CheckCircle2} />
        <StatCard label="Hours logged (month)" value={`${kpis.hoursThisMonth}h`} sub={`${kpis.billableHours}h billable all time`} icon={Clock3} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Income vs expenses — last 6 months</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.2)" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={52} tickFormatter={(v: number) => fmtMoney(v, currency)} />
                  <Tooltip formatter={(v: number | string) => fmtMoney(Number(v), currency)} cursor={{ fill: 'rgba(128,128,128,0.08)' }} />
                  <Bar dataKey="income" name="Income" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="expenses" name="Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoices by status</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No invoices yet</p>
            ) : (
              <>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="count" nameKey="status" innerRadius={45} outerRadius={68} paddingAngle={3} strokeWidth={0}>
                        {pieData.map((s) => (
                          <Cell key={s.status} fill={PIE_COLORS[s.status] ?? '#a1a1aa'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number | string, name: string) => [`${v} invoice${Number(v) === 1 ? '' : 's'}`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1.5">
                  {invoiceStatus.map((s) => (
                    <div key={s.status} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[s.status] }} />
                        <span className="capitalize">{s.status.toLowerCase()}</span>
                      </span>
                      <span className="font-medium tabular-nums">{fmtMoney(s.amount, currency)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4" aria-hidden /> Upcoming & overdue tasks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcomingTasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled — inbox zero 🎉</p>
            ) : (
              upcomingTasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">Due {fmtDate(t.dueDate)}</p>
                  </div>
                  <StatusBadge status={t.priority} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4" aria-hidden /> Recent payments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentPayments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No payments recorded yet</p>
            ) : (
              recentPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.invoiceNumber} · {p.clientName}</p>
                    <p className="text-xs text-muted-foreground capitalize">{p.method.toLowerCase()} · {fmtDate(p.paidAt)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+{fmtMoney(p.amount, currency)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" aria-hidden /> Goals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {goals.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No goals set yet</p>
            ) : (
              goals.slice(0, 4).map((g) => {
                const pct = g.targetValue > 0 ? Math.min(100, Math.round((g.currentValue / g.targetValue) * 100)) : 0
                return (
                  <div key={g.id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="truncate font-medium">{g.title}</span>
                      <span className={cn('tabular-nums', pct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{pct}%</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {g.metric === 'REVENUE' ? fmtMoney(g.currentValue, currency) : g.currentValue} of {g.metric === 'REVENUE' ? fmtMoney(g.targetValue, currency) : g.targetValue} · {g.period.toLowerCase()}
                    </p>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
