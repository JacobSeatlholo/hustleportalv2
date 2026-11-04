import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'

// GET /api/reports → funnel + revenue/profit + invoice stats (leads → revenue story)
//
// The funnel counts the SAME leads the pipeline board shows: own + team-shared
// (mirroring /api/leads default scope and /api/dashboard). Counting only the
// user's own rows made reports disagree with the board — a deal won on the
// team lane never showed as a win here. Stage labels are the user's OWN
// PIPELINE_STAGES renames (the words the board carries), so every screen
// speaks the same language; the keys never move, only the words.

const DEFAULT_STAGE_LABELS: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', QUOTE_SENT: 'Quote sent', WON: 'Won', LOST: 'Lost',
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberships = await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })
  const teamIds = memberships.map((m) => m.teamId)
  const leadScope = teamIds.length > 0 ? { OR: [{ userId }, { teamId: { in: teamIds } }] } : { userId }

  const [leads, clients, finance, invoices, settings] = await Promise.all([
    db.lead.findMany({ where: leadScope, select: { stage: true, value: true, source: true, createdAt: true } }),
    db.client.findMany({ where: { userId }, select: { monthlyValue: true, status: true } }),
    db.financeEntry.findMany({ where: { userId }, select: { type: true, amount: true, occurredAt: true, category: true } }),
    db.invoice.findMany({ where: { userId }, select: { status: true, total: true, issuedAt: true, kind: true } }),
    db.userSetting.findFirst({ where: { userId, key: 'PIPELINE_STAGES' } }),
  ])

  let renamed: Record<string, string> = {}
  if (settings?.value) {
    try {
      const parsed = JSON.parse(settings.value)
      if (parsed && typeof parsed === 'object') renamed = parsed as Record<string, string>
    } catch { /* junk setting reads as defaults */ }
  }
  const stageLabel = (key: string) => {
    const custom = renamed[key]
    if (custom && custom.trim()) return custom.trim()
    return DEFAULT_STAGE_LABELS[key] || key
  }

  // Funnel
  const stages = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTE_SENT', 'WON', 'LOST']
  const funnel = stages.map((stage) => {
    const rows = leads.filter((l) => l.stage === stage)
    return {
      stage,
      label: stageLabel(stage),
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

  // Invoice stats — quotes (kind=QUOTE) are PAPER until accepted, never money:
  // a sent quote is not outstanding cash, so only real invoices count here.
  const moneyDocs = invoices.filter((i) => i.kind !== 'QUOTE')
  const invoiceStats = {
    total: moneyDocs.length,
    paid: moneyDocs.filter((i) => i.status === 'PAID').length,
    outstanding: moneyDocs.filter((i) => i.status === 'SENT' || i.status === 'OVERDUE').length,
    overdue: moneyDocs.filter((i) => i.status === 'OVERDUE').length,
    valuePaid: moneyDocs.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.total, 0),
    valueOutstanding: moneyDocs.filter((i) => i.status === 'SENT' || i.status === 'OVERDUE').reduce((s, i) => s + i.total, 0),
    quotes: invoices.filter((i) => i.kind === 'QUOTE').length,
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
