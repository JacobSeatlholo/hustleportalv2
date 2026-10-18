import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { resolveProject } from '@/lib/workspace'

// GET /api/dashboard?projectId= — aggregated real user data
// projectId narrows the hustle numbers (pipeline, finance) to one workspace;
// projectId=ALL (or omitted) keeps the whole-business view. Tasks stay personal/team.
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const projectId = new URL(req.url).searchParams.get('projectId') || ''
  let projectFilter: Record<string, unknown> = {}
  if (projectId && projectId !== 'ALL') {
    const project = await resolveProject(userId, projectId)
    if (project.id !== projectId) return NextResponse.json({ error: 'Unknown project.' }, { status: 404 })
    projectFilter = { projectId }
  }

  const memberships = await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })
  const teamIds = memberships.map((m) => m.teamId)
  const leadScope = { ...(teamIds.length > 0 ? { OR: [{ userId }, { teamId: { in: teamIds } }] } : { userId }), ...projectFilter }
  const taskScope = teamIds.length > 0
    ? { OR: [{ assigneeId: userId }, { creatorId: userId, teamId: null }, { teamId: { in: teamIds } }] }
    : { OR: [{ assigneeId: userId }, { creatorId: userId, teamId: null }] }

  const [leads, tasks, finance, wallet, xpEvents, recentPlans, clientCount, invoiceCount] = await Promise.all([
    db.lead.findMany({ where: leadScope, select: { stage: true, value: true, createdAt: true, company: true, source: true } }),
    db.task.findMany({
      where: taskScope,
      select: { status: true, priority: true, dueDate: true },
    }),
    db.financeEntry.findMany({
      where: { userId, ...projectFilter, occurredAt: { gte: new Date(Date.now() - 180 * 24 * 3600 * 1000) } },
      orderBy: { occurredAt: 'asc' },
    }),
    db.wallet.findUnique({ where: { userId } }),
    db.xpEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    db.aiPlan.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } }),
    db.client.count({ where: { userId } }),
    db.invoice.count({ where: { userId } }),
  ])

  const pipeline = leads.filter((l) => !['WON', 'LOST'].includes(l.stage))
  const pipelineValue = pipeline.reduce((a, l) => a + (l.value || 0), 0)
  const won = leads.filter((l) => l.stage === 'WON')
  const wonValue = won.reduce((a, l) => a + (l.value || 0), 0)

  const byStage: Record<string, number> = {}
  for (const l of leads) byStage[l.stage] = (byStage[l.stage] || 0) + 1

  const now = new Date()
  const openTasks = tasks.filter((t) => t.status !== 'DONE')
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < now)
  const highPriority = openTasks.filter((t) => t.priority === 'HIGH')

  // revenue by month (last 6)
  const months: { key: string; label: string; income: number; expense: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString('en-ZA', { month: 'short' }),
      income: 0,
      expense: 0,
    })
  }
  for (const f of finance) {
    const key = f.occurredAt.toISOString().slice(0, 7)
    const m = months.find((x) => x.key === key)
    if (m) {
      if (f.type === 'INCOME') m.income += f.amount
      else m.expense += f.amount
    }
  }
  const thisMonth = months[months.length - 1]
  const lastMonth = months[months.length - 2]
  const revenue = thisMonth.income
  const expenses = thisMonth.expense
  const netProfit = revenue - expenses
  const revenueGrowth =
    lastMonth && lastMonth.income > 0 ? Math.round(((revenue - lastMonth.income) / lastMonth.income) * 100) : null

  // weekly activity (leads created + tasks completed last 7 days)
  const week: { day: string; count: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600 * 1000)
    week.push({ day: d.toLocaleDateString('en-ZA', { weekday: 'short' }), count: 0 })
  }
  for (const l of leads) {
    const diff = Math.floor((now.getTime() - l.createdAt.getTime()) / (24 * 3600 * 1000))
    if (diff >= 0 && diff < 7) week[6 - diff].count++
  }

  return NextResponse.json({
    kpis: {
      revenue,
      expenses,
      netProfit,
      revenueGrowth,
      pipelineValue,
      pipelineCount: pipeline.length,
      wonValue,
      wonCount: won.length,
      openTasks: openTasks.length,
      overdueTasks: overdue.length,
      highPriorityTasks: highPriority.length,
      totalLeads: leads.length,
      creditBalance: wallet?.balance ?? 0,
    },
    // Lifetime "ever did it" counts: the personalized track on the dashboard
    // checks real work, not taps, so a step is done when the thing exists.
    counts: { clients: clientCount, invoices: invoiceCount },
    byStage,
    months,
    week,
    recentXp: xpEvents,
    lastPlanAt: recentPlans[0]?.createdAt || null,
  })
}
