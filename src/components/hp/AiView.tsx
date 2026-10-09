'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api } from './shared'
import { useHp } from './store'
import { Loader2, Send, BrainCircuit, Sparkles, CheckCircle2, FileText } from 'lucide-react'

interface PlanRecord {
  id: string
  content: string
  createdAt: string
  answers: string
}

const QUESTIONS = [
  { key: 'business', q: 'What is your business name and what does it do?', placeholder: 'e.g. FlexFit SA — online personal training platform' },
  { key: 'targetMarket', q: 'Who is your target market?', placeholder: 'e.g. Working professionals aged 25–40 in SA cities' },
  { key: 'revenueModel', q: 'How does your business make money?', placeholder: 'e.g. Monthly subscriptions + coaching sessions' },
  { key: 'competitors', q: 'Who are your competitors and what makes you different?', placeholder: 'e.g. Virgin Active, but 10x cheaper and fully remote' },
  { key: 'goals', q: 'What is your 12-month goal?', placeholder: 'e.g. 100 paying customers and R50k monthly revenue' },
] as const

// Renders simple markdown (headings, bold, lists) without a heavy lib
function renderMd(md: string) {
  const lines = md.split('\n')
  const out: React.ReactNode[] = []
  let list: string[] = []
  const flush = (k: number) => {
    if (list.length) {
      out.push(
        <ul key={`ul-${k}`} className="list-disc pl-5 space-y-1 my-2">
          {list.map((li, i) => <li key={i}>{inline(li)}</li>)}
        </ul>
      )
      list = []
    }
  }
  lines.forEach((raw, k) => {
    const line = raw.trim()
    if (line.startsWith('## ')) {
      flush(k)
      out.push(<h3 key={k} className="font-display text-xl mt-4 mb-1">{line.slice(3)}</h3>)
    } else if (line.startsWith('# ')) {
      flush(k)
      out.push(<h3 key={k} className="font-display text-xl mt-4 mb-1">{line.slice(2)}</h3>)
    } else if (/^([-*•]|\d+\.)\s+/.test(line)) {
      list.push(line.replace(/^([-*•]|\d+\.)\s+/, ''))
    } else if (line === '') {
      flush(k)
    } else {
      flush(k)
      out.push(<p key={k} className="my-1.5">{inline(line)}</p>)
    }
  })
  flush(9999)
  return out
}

function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p
  )
}

export default function AiView() {
  const { bumpRefresh } = useHp()
  const { toast } = useToast()
  const [tab, setTab] = useState<'plan' | 'advisor'>('plan')

  // Plan wizard
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [activePlan, setActivePlan] = useState<PlanRecord | null>(null)

  // Advisor
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const chatEnd = useRef<HTMLDivElement>(null)

  async function loadPlans() {
    try {
      const res = await api<{ plans: PlanRecord[] }>('/api/ai/plan')
      setPlans(res.plans)
      if (res.plans[0]) setActivePlan(res.plans[0])
    } catch { /* ignore */ }
  }

  async function loadChat() {
    try {
      const res = await api<{ messages: { role: string; content: string }[] }>('/api/ai/advisor')
      setMessages(res.messages)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadPlans()
    loadChat()
  }, [])

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatBusy])

  async function generate() {
    setGenerating(true)
    try {
      const res = await api<{ plan: PlanRecord }>('/api/ai/plan', {
        method: 'POST',
        body: JSON.stringify(answers),
      })
      setActivePlan(res.plan)
      setPlans((p) => [res.plan, ...p])
      setStep(0)
      setAnswers({})
      toast({ title: 'Your business plan is ready', description: '+30 XP earned' })
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Plan generation failed', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  async function sendChat() {
    const q = chatInput.trim()
    if (!q || chatBusy) return
    setChatInput('')
    setMessages((m) => [...m, { role: 'user', content: q }])
    setChatBusy(true)
    try {
      const res = await api<{ reply: string }>('/api/ai/advisor', {
        method: 'POST',
        body: JSON.stringify({ message: q }),
      })
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }])
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Advisor unavailable', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setChatBusy(false)
    }
  }

  const q = QUESTIONS[step]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl">AI Co-Founder</h1>
        <p className="text-sm text-muted-foreground">Plans and advice grounded in your real business data.</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'plan' | 'advisor')}>
        <TabsList>
          <TabsTrigger value="plan" className="gap-1"><FileText className="h-3.5 w-3.5" /> Business plan</TabsTrigger>
          <TabsTrigger value="advisor" className="gap-1"><BrainCircuit className="h-3.5 w-3.5" /> Advisor chat</TabsTrigger>
        </TabsList>

        {/* PLAN TAB */}
        <TabsContent value="plan" className="space-y-4">
          {!activePlan && !generating && (
            <Card>
              <CardContent className="p-6 md:p-8">
                <div className="flex items-center gap-2 text-amber-600 text-sm font-medium">
                  <Sparkles className="h-4 w-4" /> Free · about 60 seconds
                </div>
                <div className="mt-2 flex gap-1.5">
                  {QUESTIONS.map((_, i) => (
                    <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-amber-500' : 'bg-muted'}`} />
                  ))}
                </div>
                <div className="mt-6">
                  <p className="text-xs text-muted-foreground">Question {step + 1} of {QUESTIONS.length}</p>
                  <h2 className="text-xl font-medium mt-1">{q.q}</h2>
                  <Textarea
                    autoFocus
                    value={answers[q.key] || ''}
                    onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
                    placeholder={q.placeholder}
                    rows={3}
                    className="mt-4"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        if (step < QUESTIONS.length - 1) setStep(step + 1)
                        else generate()
                      }
                    }}
                  />
                  <div className="flex gap-2 mt-4">
                    {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>← Back</Button>}
                    {step < QUESTIONS.length - 1 ? (
                      <Button onClick={() => setStep(step + 1)} disabled={!answers[q.key]?.trim()} className="flex-1">
                        Next →
                      </Button>
                    ) : (
                      <Button onClick={generate} disabled={!answers[q.key]?.trim()} className="flex-1">
                        🚀 Generate my plan
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t grid sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                  {['Clear mission statement', 'Target market analysis', 'Revenue streams with R pricing', '90-day milestones', 'Marketing plan (WhatsApp-first)', 'This week actions'].map((f) => (
                    <div key={f} className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {f}</div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {generating && (
            <Card>
              <CardContent className="p-10 text-center space-y-3">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-amber-500" />
                <p className="font-medium">Writing your plan…</p>
                <Progress value={80} className="max-w-xs mx-auto" />
                <p className="text-xs text-muted-foreground">Grounded in SA market reality — this takes up to a minute.</p>
              </CardContent>
            </Card>
          )}

          {activePlan && !generating && (
            <div className="grid lg:grid-cols-4 gap-4">
              <Card className="lg:col-span-3">
                <CardContent className="p-6 md:p-8">
                  <div className="flex items-center justify-between mb-4">
                    <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">AI Business Plan</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(activePlan.createdAt).toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                    </span>
                  </div>
                  <div className="prose-sm max-w-none text-sm leading-relaxed">
                    {renderMd(activePlan.content)}
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => { setActivePlan(null); setAnswers({}); setStep(0) }}
                >
                  ✨ New plan
                </Button>
                {plans.length > 1 && (
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Previous plans</p>
                      <div className="space-y-1">
                        {plans.filter((p) => p.id !== activePlan.id).map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setActivePlan(p)}
                            className="w-full text-left text-xs rounded-lg border p-2 hover:border-amber-300 transition"
                          >
                            {new Date(p.createdAt).toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ADVISOR TAB */}
        <TabsContent value="advisor">
          <Card className="flex flex-col h-[calc(100vh-16rem)] min-h-[420px]">
            <CardContent className="p-0 flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto hp-scroll p-4 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center py-10 space-y-2">
                    <BrainCircuit className="h-10 w-10 mx-auto text-amber-400" />
                    <p className="font-medium">Your AI Co-Founder knows your numbers</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      It can see your pipeline, tasks, finance and profile. Ask about pricing, growth, proposals or what to focus on today.
                    </p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`rounded-2xl px-4 py-2.5 text-sm max-w-[85%] md:max-w-[70%] whitespace-pre-wrap leading-relaxed ${
                      m.role === 'user' ? 'bg-sidebar text-white rounded-br-sm' : 'bg-muted rounded-bl-sm'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatBusy && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-muted px-4 py-3 rounded-bl-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={chatEnd} />
              </div>
              <div className="border-t p-3 flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                  placeholder="Ask anything… strategy, pricing, growth"
                  className="flex-1"
                />
                <Button size="icon" onClick={sendChat} disabled={chatBusy || !chatInput.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
