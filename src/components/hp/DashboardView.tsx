'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { api, rands, randsPlain, type Lead, type Task } from './shared'
import { useHp } from './store'
import SetupChecklist from './SetupChecklist'
import {
  ArrowRight, ArrowUpRight, ArrowDownRight, Sparkles, Send, Target, CheckSquare,
  Wallet, TrendingUp, Clock, Flame, Loader2, Trophy, ListTodo, Users, BrainCircuit,
} from 'lucide-react'

interface DashData {
  kpis: {
    revenue: number; expenses: number; netProfit: number; revenueGrowth: number | null
    pipelineValue: number; pipelineCount: number; wonValue: number; wonCount: number
    openTasks: number; overdueTasks: number; highPriorityTasks: number; totalLeads: number
    creditBalance: number
  }
  byStage: Record<string, number>
  months: { key: string; label: string; income: number; expense: number }[]
  week: { day: string; count: number }[]
  recentXp: { id: string; type: string; amount: number; description: string | null; createdAt: string }[]
  lastPlanAt: string | null
}

const QUICK_CHIPS = [
  { label: 'Find me new leads', action: 'leads' },
  { label: 'What should I focus on today?', action: 'chat' },
  { label: 'How is my pipeline doing?', action: 'chat' },
  { label: 'Grow my revenue', action: 'chat' },
] as const

export default function DashboardView() {
  const { session, activeProjectId, setView, setAiBarQuery } = useHp()
  const { toast } = useToast()
  const [data, setData] = useState<DashData | null>(null)
  const [newLeads, setNewLeads] = useState<Lead[]>([])
  const [myTasks, setMyTasks] = useState<Task[]>([])
  const [aiQuery, setAiQuery] = useState('')
  const [aiReply, setAiReply] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)

  async function load() {
    try {
      // Hustle numbers follow the active workspace (top nav switcher); tasks stay personal.
      const pid = activeProjectId ? `projectId=${encodeURIComponent(activeProjectId)}` : ''
      const [d, leads, tasks] = await Promise.all([
        api<DashData>(`/api/dashboard${pid ? `?${pid}` : ''}`),
        api<{ leads: Lead[] }>(`/api/leads${pid ? `?${pid}` : ''}`),
        api<{ tasks: Task[] }>('/api/tasks?scope=mine'),
      ])
      setData(d)
      setNewLeads(leads.leads.filter((l) => l.stage === 'NEW').slice(0, 6))
      setMyTasks(tasks.tasks.filter((t) => t.status !== 'DONE').slice(0, 5))
    } catch {
      toast({ title: 'Could not load dashboard', variant: 'destructive' })
    }
  }

  useEffect(() => {
    load()
  }, [activeProjectId])

  async function askAi(text?: string) {
    const q = (text ?? aiQuery).trim()
    if (!q) return
    setAiBusy(true)
    setAiReply(null)
    try {
      const res = await api<{ reply: string }>('/api/ai/advisor', {
        method: 'POST',
        body: JSON.stringify({ message: q }),
      })
      setAiReply(res.reply)
      setAiQuery('')
    } catch (e) {
      toast({ title: 'AI Advisor', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally {
      setAiBusy(false)
    }
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid md:grid-cols-3 gap-4">
          <Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-28 rounded-2xl" />
        </div>
      </div>
    )
  }

  const k = data.kpis
  const firstName = session?.user.name.split(' ')[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const maxWeek = Math.max(...data.week.map((w) => w.count), 1)
  const maxRevenue = Math.max(...data.months.map((m) => Math.max(m.income, m.expense)), 1)
  const doneChallenges = session?.challenges.filter((c) => c.done).length ?? 0

  return (
    <div className="space-y-4">
      <SetupChecklist />
      {/* Hero + AI command bar */}
      <div className="rounded-2xl bg-sidebar text-sidebar-foreground p-6 md:p-8 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-brand/10 blur-2xl" />
        <div className="flex items-center gap-2 text-brand text-sm font-medium">
          <Sparkles className="h-4 w-4" /> HustlePortal Business OS
        </div>
        <h1 className="font-display text-4xl md:text-5xl mt-2">
          {greeting}, {firstName}.
        </h1>
        <p className="text-sidebar-foreground/60 text-sm mt-1">
          {session?.user.businessName || 'Your business'} · {session?.user.city || 'South Africa'}
        </p>

        <div className="mt-5 flex items-center gap-2 bg-white/10 rounded-full p-1.5 pl-4 max-w-2xl">
          <BrainCircuit className="h-4 w-4 text-brand shrink-0" />
          <input
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && askAi()}
            placeholder="Ask your AI Co-Founder…"
            className="bg-transparent outline-none text-sm flex-1 placeholder:text-white/40"
          />
          <Button size="icon" className="rounded-full h-8 w-8" onClick={() => askAi()} disabled={aiBusy}>
            {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_CHIPS.map((c) => (
            <button
              key={c.label}
              onClick={() => {
                if (c.action === 'leads') {
                  setAiBarQuery(''); setView('leads')
                } else askAi(c.label)
              }}
              className="text-xs rounded-full border border-border px-3 py-1.5 text-white/80 hover:bg-white/10 transition"
            >
              {c.label}
            </button>
          ))}
        </div>
        {aiReply && (
          <div className="mt-4 rounded-lg bg-white/5 border border-border p-4 text-sm leading-relaxed whitespace-pre-wrap max-w-2xl">
            {aiReply}
          </div>
        )}
      </div>

      {/* Module shortcuts */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="cursor-pointer hover:shadow-md transition group" onClick={() => setView('leads')}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-brand/15 p-2"><Target className="h-5 w-5 text-brand" /></div>
              <div>
                <div className="font-medium">Leads &amp; Pipeline</div>
                <div className="text-xs text-muted-foreground">{k.pipelineCount} active · {randsPlain(k.pipelineValue)}</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition" />
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition group" onClick={() => setView('tasks')}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-brand/15 p-2"><CheckSquare className="h-5 w-5 text-brand" /></div>
              <div>
                <div className="font-medium">Tasks</div>
                <div className="text-xs text-muted-foreground">{k.openTasks} open{k.overdueTasks ? ` · ${k.overdueTasks} overdue` : ''}</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition" />
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition group" onClick={() => setView('wallet')}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-brand/15 p-2"><Wallet className="h-5 w-5 text-brand" /></div>
              <div>
                <div className="font-medium">Credit Wallet</div>
                <div className="text-xs text-muted-foreground">{rands(k.creditBalance)} available</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition" />
          </CardContent>
        </Card>
      </div>

      {/* AI-scout teaser — real leads from the seller's own website, for an empty pipeline */}
      {k.pipelineCount === 0 && (
        <Card
          className="cursor-pointer hover:shadow-md transition border-brand/40 bg-brand/5"
          onClick={() => {
            setView('leads')
            window.dispatchEvent(new CustomEvent('hp:discover'))
          }}
        >
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="rounded-lg bg-brand/15 p-2 shrink-0"><Sparkles className="h-5 w-5 text-brand" /></div>
              <div className="min-w-0">
                <div className="font-medium">AI scout — real leads from your website</div>
                <div className="text-xs text-muted-foreground">
                  Gemini searches the live web for real businesses in your area that need what you sell. Real results, free to try — your welcome credits cover the first reveals.
                </div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      )}

      {/* KPI row */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Revenue this month" value={randsPlain(k.revenue)}
          sub={k.revenueGrowth === null ? 'Log income to track growth' : k.revenueGrowth >= 0 ? `▲ ${k.revenueGrowth}% vs last month` : `▼ ${Math.abs(k.revenueGrowth)}% vs last month`}
          icon={<TrendingUp className="h-4 w-4" />}
          positive={k.revenueGrowth !== null && k.revenueGrowth >= 0}
        />
        <KpiCard label="Net profit" value={randsPlain(k.netProfit)} sub={`after ${randsPlain(k.expenses)} expenses`} icon={<TrendingUp className="h-4 w-4" />} positive={k.netProfit >= 0} />
        <KpiCard label="Pipeline" value={randsPlain(k.pipelineValue)} sub={`${k.pipelineCount} open deals · ${k.wonCount} won ${randsPlain(k.wonValue)}`} icon={<Target className="h-4 w-4" />} />
        <KpiCard label="Open tasks" value={String(k.openTasks)} sub={k.overdueTasks ? `${k.overdueTasks} overdue · act now` : `${k.highPriorityTasks} high priority`} icon={<ListTodo className="h-4 w-4" />} warn={k.overdueTasks > 0} />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              Weekly activity <span className="text-xs font-normal text-muted-foreground">new leads · last 7 days</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-36">
              {data.week.map((w, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t-md bg-brand/30 relative" style={{ height: `${Math.max((w.count / maxWeek) * 110, 4)}px` }}>
                    {w.count > 0 && (
                      <div className="absolute inset-x-0 bottom-0 rounded-t-md bg-brand" style={{ height: `${(w.count / maxWeek) * 110}px` }} />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{w.day}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activity overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <OverviewRow label="Total leads" value={k.totalLeads} pct={Math.min(100, k.totalLeads * 4)} />
            <OverviewRow label="New stage" value={data.byStage.NEW || 0} pct={Math.min(100, (data.byStage.NEW || 0) * 8)} />
            <OverviewRow label="Won this month" value={k.wonCount} pct={Math.min(100, k.wonCount * 12)} />
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground"><Flame className="h-4 w-4 text-brand" /> Daily challenges</span>
                <Badge className="bg-brand/15 text-brand hover:bg-brand/15">{doneChallenges}/{session?.challenges.length} done</Badge>
              </div>
              <Progress value={(doneChallenges / Math.max(session?.challenges.length || 1, 1)) * 100} className="mt-2 h-2" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              New leads
              <button className="text-xs text-brand hover:underline" onClick={() => setView('leads')}>Open →</button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {newLeads.length === 0 ? (
              <EmptyMini
                text="No leads yet. Source your first batch with AI."
                action={{ label: 'Find leads', onClick: () => setView('leads') }}
              />
            ) : (
              newLeads.map((l) => (
                <div key={l.id} className="flex items-center gap-3 py-1.5">
                  <div className="h-8 w-8 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold shrink-0">
                    {l.company.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{l.company}</div>
                    <div className="text-xs text-muted-foreground">{l.city || 'SA'} · {l.industry || 'Business'}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{l.source}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              Priority tasks
              <button className="text-xs text-brand hover:underline" onClick={() => setView('tasks')}>Open →</button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {myTasks.length === 0 ? (
              <EmptyMini
                text="Nothing planned. Add your first task."
                action={{ label: 'Plan my day', onClick: () => setView('tasks') }}
              />
            ) : (
              myTasks.map((t) => {
                const overdue = t.dueDate && new Date(t.dueDate) < new Date()
                return (
                  <div key={t.id} className="flex items-center gap-3 py-1.5">
                    <Clock className={`h-4 w-4 shrink-0 ${overdue ? 'text-red-500' : 'text-muted-foreground'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : 'No date'}
                        {t.assignee && t.assignee.id !== session?.user.id ? ` · ${t.assignee.name}` : t.team ? ` · ${t.team.name}` : ''}
                      </div>
                    </div>
                    {t.priority === 'HIGH' && <Badge variant="destructive" className="text-[10px]">HIGH</Badge>}
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><Trophy className="h-4 w-4 text-brand" /> XP feed</span>
              <button className="text-xs text-brand hover:underline" onClick={() => setView('profile')}>Level →</button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recentXp.length === 0 ? (
              <EmptyMini text="Complete challenges to earn XP and level up." />
            ) : (
              data.recentXp.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm py-1">
                  <span className="text-muted-foreground truncate pr-2">{e.description || e.type.replace(/_/g, ' ').toLowerCase()}</span>
                  <Badge variant="outline" className="text-brand border-brand/50 shrink-0">+{e.amount} XP</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue strip */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            Revenue — last 6 months
            <button className="text-xs text-brand hover:underline" onClick={() => setView('finance')}>Log income →</button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 h-28">
            {data.months.map((m) => (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{m.income > 0 ? randsPlain(m.income) : ''}</span>
                <div className="w-full rounded-t-md bg-stone-200" style={{ height: `${Math.max((m.income / maxRevenue) * 80, 3)}px` }} />
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
          {data.months.every((m) => m.income === 0) && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              No income logged yet — your chart fills in as you record revenue in Finance.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({ label, value, sub, icon, positive, warn }: {
  label: string; value: string; sub: string; icon: React.ReactNode; positive?: boolean; warn?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {label}
          <span className={warn ? 'text-red-500' : ''}>{icon}</span>
        </div>
        <div className="font-display text-3xl mt-1">{value}</div>
        <div className={`text-xs mt-1 flex items-center gap-1 ${warn ? 'text-red-500' : positive ? 'text-emerald-600' : 'text-muted-foreground'}`}>
          {positive === true && <ArrowUpRight className="h-3 w-3" />}
          {positive === false && <ArrowDownRight className="h-3 w-3" />}
          {sub}
        </div>
      </CardContent>
    </Card>
  )
}

function OverviewRow({ label, value, pct }: { label: string; value: number; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <Progress value={pct} className="mt-1 h-1.5" />
    </div>
  )
}

function EmptyMini({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="py-6 text-center space-y-2">
      <p className="text-xs text-muted-foreground px-4">{text}</p>
      {action && (
        <Button size="sm" variant="outline" className="text-xs" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
