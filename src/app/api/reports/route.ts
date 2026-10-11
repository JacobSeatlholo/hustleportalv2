import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

// GET /api/reports → funnel + revenue/profit + invoice stats (leads → revenue story)
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [leads, clients, finance, invoices] = await Promise.all([
    db.lead.findMany({ where: { userId }, select: { stage: true, value: true, source: true, createdAt: true } }),
    db.client.findMany({ where: { userId }, select: { monthlyValue: true, status: true } }),
    db.financeEntry.findMany({ where: { userId }, select: { type: true, amount: true, occurredAt: true, category: true } }),
    db.invoice.findMany({ where: { userId }, select: { status: true, total: true, issuedAt: true } }),
  ])

  // Funnel
  const stages = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTE_SENT', 'WON', 'LOST']
  const funnel = stages.map((stage) => {
    const rows = leads.filter((l) => l.stage === stage)
    return {
      stage,
      count: rows.length,
      value: rows.reduce((s, l) => s + (l.value || 0), 0),
    }
  })
  const totalLeads = leads.length
  const won = leads.filter((l) => l.stage === 'WON').length
  const conversion = totalLeads > 0 ? Math.round((won / totalLeads) * 100) : 0

  // Money by month (last 6 months)
  const months: { key: string; label: string; income: number; expense: number }[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-ZA', { month: 'short' }), income: 0, expense: 0 })
  }
  for (const f of finance) {
    const key = new Date(f.occurredAt).toISOString().slice(0, 7)
    const m = months.find((x) => x.key === key)
    if (!m) continue
    if (f.type === 'INCOME') m.income += f.amount
    else m.expense += f.amount
  }
  const totalIncome = finance.filter((f) => f.type === 'INCOME').reduce((s, f) => s + f.amount, 0)
  const totalExpense = finance.filter((f) => f.type === 'EXPENSE').reduce((s, f) => s + f.amount, 0)

  // Invoice stats
  const invoiceStats = {
    total: invoices.length,
    paid: invoices.filter((i) => i.status === 'PAID').length,
    outstanding: invoices.filter((i) => i.status === 'SENT' || i.status === 'OVERDUE').length,
    overdue: invoices.filter((i) => i.status === 'OVERDUE').length,
    valuePaid: invoices.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.total, 0),
    valueOutstanding: invoices.filter((i) => i.status === 'SENT' || i.status === 'OVERDUE').reduce((s, i) => s + i.total, 0),
  }

  // Top expense categories
  const catTotals = new Map<string, number>()
  for (const f of finance.filter((x) => x.type === 'EXPENSE')) {
    const c = f.category || 'OTHER'
    catTotals.set(c, (catTotals.get(c) || 0) + f.amount)
  }
  const expenseCategories = [...catTotals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)

  return NextResponse.json({
    funnel,
    conversion,
    pipelineValue: leads.filter((l) => !['WON', 'LOST'].includes(l.stage)).reduce((s, l) => s + (l.value || 0), 0),
    recurringRevenue: clients.filter((c) => c.status === 'ACTIVE').reduce((s, c) => s + c.monthlyValue, 0),
    activeClients: clients.filter((c) => c.status === 'ACTIVE').length,
    months,
    totals: { income: totalIncome, expense: totalExpense, profit: totalIncome - totalExpense },
    invoiceStats,
    expenseCategories,
    leadSources: [...new Set(leads.map((l) => l.source))].map((source) => ({
      source,
      count: leads.filter((l) => l.source === source).length,
    })),
  })
}
