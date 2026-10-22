'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api, randsPlain } from './shared'
import { useHp } from './store'
import { Loader2, TrendingUp, TrendingDown, Plus } from 'lucide-react'

interface Entry {
  id: string
  type: string
  description: string
  category: string | null
  amount: number
  occurredAt: string
}

export default function FinanceView() {
  const { bumpRefresh } = useHp()
  const { toast } = useToast()
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [type, setType] = useState('INCOME')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Sales')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const res = await api<{ entries: Entry[] }>('/api/finance')
      setEntries(res.entries)
    } catch {
      toast({ title: 'Failed to load finance', variant: 'destructive' })
    }
  }

  useEffect(() => {
    load()
     
  }, [])

  async function add() {
    if (!description.trim() || !Number(amount)) return
    setBusy(true)
    try {
      await api('/api/finance', {
        method: 'POST',
        body: JSON.stringify({ type, description, amount: Number(amount), category }),
      })
      setDescription('')
      setAmount('')
      toast({ title: 'Entry logged' })
      load()
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const income = (entries || []).filter((e) => e.type === 'INCOME').reduce((a, e) => a + e.amount, 0)
  const expense = (entries || []).filter((e) => e.type === 'EXPENSE').reduce((a, e) => a + e.amount, 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl">Finance</h1>
        <p className="text-sm text-muted-foreground">Simple money in, money out, the numbers that matter.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-2"><TrendingUp className="h-5 w-5 text-emerald-700" /></div>
              <div>
                <div className="text-xs text-muted-foreground">Total income</div>
                <div className="font-display text-2xl">{randsPlain(income)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-100 p-2"><TrendingDown className="h-5 w-5 text-red-700" /></div>
              <div>
                <div className="text-xs text-muted-foreground">Total expenses</div>
                <div className="font-display text-2xl">{randsPlain(expense)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Log an entry</CardTitle></CardHeader>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-2">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INCOME">Income</SelectItem>
                <SelectItem value="EXPENSE">Expense</SelectItem>
              </SelectContent>
            </Select>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it? e.g. Deposit from Nkosi Brands" className="flex-1 min-w-[180px]" />
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (R)" className="w-[130px]" />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['Sales', 'Services', 'Stock', 'Transport', 'Data & Airtime', 'Rent', 'Other'].map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={add} disabled={busy || !description.trim() || !Number(amount)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Log
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y max-h-[50vh] overflow-y-auto hp-scroll">
            {entries === null && [...Array(4)].map((_, i) => <Skeleton key={i} className="m-3 h-10" />)}
            {entries?.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nothing logged yet. Recording even small income builds your dashboard trends.
              </p>
            )}
            {entries?.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`rounded-lg p-2 ${e.type === 'INCOME' ? 'bg-emerald-100' : 'bg-red-100'}`}>
                  {e.type === 'INCOME'
                    ? <TrendingUp className="h-4 w-4 text-emerald-700" />
                    : <TrendingDown className="h-4 w-4 text-red-700" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{e.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.occurredAt).toLocaleDateString('en-ZA', { dateStyle: 'medium' })} · {e.category || 'Other'}
                  </div>
                </div>
                <span className={`text-sm font-semibold ${e.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {e.type === 'INCOME' ? '+' : '−'}{randsPlain(e.amount)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
