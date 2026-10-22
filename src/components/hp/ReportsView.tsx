'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { api, randsPlain } from './shared'
import { useToast } from '@/hooks/use-toast'
import { Download, Loader2, LineChart, TrendingUp, Users, Wallet, ReceiptText } from 'lucide-react'

type Report = {
  funnel: { stage: string; count: number; value: number }[]
  conversion: number
  pipelineValue: number
  recurringRevenue: number
  activeClients: number
  months: { key: string; label: string; income: number; expense: number }[]
  totals: { income: number; expense: number; profit: number }
  invoiceStats: { total: number; paid: number; outstanding: number; overdue: number; valuePaid: number; valueOutstanding: number }
  expenseCategories: { category: string; amount: number }[]
  leadSources: { source: string; count: number }[]
}

const STAGE_LABELS: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', QUOTE_SENT: 'Quote sent', WON: 'Won', LOST: 'Lost',
}

const EXPORTS = [
  { type: 'leads', label: 'Leads CSV' },
  { type: 'clients', label: 'Clients CSV' },
  { type: 'finance', label: 'Finance CSV' },
  { type: 'invoices', label: 'Invoices CSV' },
  { type: 'appointments', label: 'Appointments CSV' },
]

export default function ReportsView() {
  const { toast } = useToast()
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await api<Report>('/api/reports'))
    } catch (e) {
      toast({ title: 'Could not load reports', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  function exportCsv(type: string) {
    const url = `/api/export?type=${type}`
    const a = document.createElement('a')
    a.href = url
    a.download = `hustleportal-${type}.csv`
    a.click()
    toast({ title: 'Export started', description: `hustleportal-${type} CSV downloaded.` })
  }

  if (loading) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-lg bg-white/5 animate-pulse" />)}</div>
  }
  if (!report) return <p className="text-sm text-muted-foreground">No report data yet.</p>

  const maxFunnel = Math.max(1, ...report.funnel.map((f) => f.count))
  const maxMonth = Math.max(1, ...report.months.map((m) => Math.max(m.income, m.expense)))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Reports</h2>
          <p className="text-sm text-muted-foreground">Leads → revenue → profit, the whole story in numbers.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EXPORTS.map((x) => (
            <button
              key={x.type}
              onClick={() => exportCsv(x.type)}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs hover:border-brand transition"
            >
              <Download className="h-3 w-3" /> {x.label}
            </button>
          ))}
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric icon={<Wallet className="h-4 w-4 text-brand" />} label="Pipeline value" value={randsPlain(report.pipelineValue)} sub={`${report.conversion}% lead → won`} />
        <Metric icon={<TrendingUp className="h-4 w-4 text-brand" />} label="Profit (all time)" value={randsPlain(report.totals.profit)} sub={`${randsPlain(report.totals.income)} in / ${randsPlain(report.totals.expense)} out`} />
        <Metric icon={<Users className="h-4 w-4 text-brand" />} label="Monthly recurring" value={randsPlain(report.recurringRevenue)} sub={`${report.activeClients} active clients`} />
        <Metric icon={<ReceiptText className="h-4 w-4 text-brand" />} label="Outstanding invoices" value={randsPlain(report.invoiceStats.valueOutstanding)} sub={`${report.invoiceStats.outstanding} unpaid · ${report.invoiceStats.overdue} overdue`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Funnel */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-medium text-sm mb-4">Lead funnel</h3>
          <div className="space-y-2.5">
            {report.funnel.map((f) => (
              <div key={f.stage}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span>{STAGE_LABELS[f.stage] || f.stage}</span>
                  <span className="text-muted-foreground">{f.count} · {randsPlain(f.value)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${f.stage === 'WON' ? 'bg-emerald-500' : f.stage === 'LOST' ? 'bg-stone-500' : 'bg-brand'}`}
                    style={{ width: `${(f.count / maxFunnel) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {report.leadSources.map((s) => (
              <Badge key={s.source} variant="secondary" className="text-[10px]">{s.source}: {s.count}</Badge>
            ))}
          </div>
        </div>

        {/* Income vs expense */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-medium text-sm mb-4 flex items-center gap-2"><LineChart className="h-4 w-4 text-brand" /> Income vs expenses, 6 months</h3>
          <div className="flex items-end gap-3 h-44">
            {report.months.map((m) => (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-1 h-36">
                  <div className="w-3.5 md:w-5 bg-brand rounded-t" style={{ height: `${(m.income / maxMonth) * 100}%` }} title={`Income ${randsPlain(m.income)}`} />
                  <div className="w-3.5 md:w-5 bg-white/15 rounded-t" style={{ height: `${(m.expense / maxMonth) * 100}%` }} title={`Expenses ${randsPlain(m.expense)}`} />
                </div>
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand" /> Income</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-white/15" /> Expenses</span>
          </div>
          {report.expenseCategories.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Top expense categories</p>
              <div className="space-y-1.5">
                {report.expenseCategories.map((c) => (
                  <div key={c.category} className="flex justify-between text-xs">
                    <span className="capitalize">{c.category.toLowerCase()}</span>
                    <span className="tabular-nums text-muted-foreground">{randsPlain(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Metric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="font-display text-2xl mt-1.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}
