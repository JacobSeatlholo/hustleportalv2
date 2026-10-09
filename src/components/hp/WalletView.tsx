'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { api, rands, type CreditTx, type TopUpPack } from './shared'
import { useHp } from './store'
import { Wallet, Loader2, ArrowDownLeft, ArrowUpRight, Sparkles, ShieldCheck, Gift } from 'lucide-react'

interface WalletData {
  wallet: { balance: number }
  txs: CreditTx[]
  packs: TopUpPack[]
}

export default function WalletView() {
  const { session, loadSession, bumpRefresh } = useHp()
  const { toast } = useToast()
  const [data, setData] = useState<WalletData | null>(null)
  const [buying, setBuying] = useState<string | null>(null)

  async function load() {
    try {
      setData(await api<WalletData>('/api/wallet'))
    } catch {
      toast({ title: 'Failed to load wallet', variant: 'destructive' })
    }
  }

  useEffect(() => {
    load()
     
  }, [])

  async function topUp(pack: TopUpPack) {
    setBuying(pack.id)
    try {
      await api('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ packageId: pack.id }) })
      toast({
        title: 'Top-up successful',
        description: `${rands(pack.creditCents)} in credits added to your wallet.`,
      })
      await load()
      await loadSession()
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Top-up failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBuying(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl">Credit Wallet</h1>
        <p className="text-sm text-muted-foreground">Top up once, reveal leads as you go. Credits never expire.</p>
      </div>

      {/* Balance hero */}
      <div className="rounded-2xl bg-sidebar text-sidebar-foreground p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-amber-400/15 p-3"><Wallet className="h-7 w-7 text-amber-400" /></div>
          <div>
            <div className="text-sm text-sidebar-foreground/60">Available credits</div>
            <div className="font-display text-4xl">{rands(data?.wallet.balance ?? session?.wallet.balance ?? 0)}</div>
          </div>
        </div>
        <div className="text-xs text-sidebar-foreground/50 max-w-xs">
          Credits reveal verified contact details (email + phone) on leads. Your own imported contacts are always free.
        </div>
      </div>

      {/* Packs */}
      <div>
        <h2 className="font-medium mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-500" /> Top-up packs</h2>
        <div className="grid md:grid-cols-3 gap-3">
          {!data && [...Array(3)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
          {data?.packs.map((p, i) => (
            <Card key={p.id} className={`relative ${i === 1 ? 'border-amber-400 shadow-md shadow-amber-100' : ''}`}>
              {i === 1 && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-amber-400 text-black hover:bg-amber-400">
                  Most popular
                </Badge>
              )}
              <CardContent className="p-5 text-center space-y-2">
                <div className="font-display text-2xl">{p.name}</div>
                <div className="font-display text-4xl">{rands(p.amountCents)}</div>
                <div className="text-sm text-muted-foreground">
                  {rands(p.creditCents)} in credits
                  {p.bonus > 0 && (
                    <span className="text-emerald-600 font-medium"> · {p.bonus}% bonus</span>
                  )}
                </div>
                <Button
                  className="w-full mt-2"
                  variant={i === 1 ? 'default' : 'outline'}
                  onClick={() => topUp(p)}
                  disabled={buying !== null}
                >
                  {buying === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Top up'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          Paid securely with Yoco (card, Apple Pay, Google Pay). Sandbox mode confirms instantly for demo — live Yoco Checkout wires in with production keys.
        </p>
      </div>

      {/* Ledger */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Transaction history</CardTitle>
        </CardHeader>
        <CardContent className="divide-y max-h-96 overflow-y-auto hp-scroll">
          {data?.txs.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No transactions yet. Your welcome bonus is waiting in your balance.
            </p>
          )}
          {data?.txs.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <div className={`rounded-lg p-2 ${t.amount >= 0 ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                {t.amount >= 0
                  ? <ArrowDownLeft className="h-4 w-4 text-emerald-700" />
                  : <ArrowUpRight className="h-4 w-4 text-amber-700" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {t.description}
                  {t.type === 'BONUS' && <Gift className="h-3.5 w-3.5 text-amber-500" />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(t.createdAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })} · balance {rands(t.balanceAfter)}
                </div>
              </div>
              <span className={`text-sm font-semibold shrink-0 ${t.amount >= 0 ? 'text-emerald-600' : 'text-amber-700'}`}>
                {t.amount >= 0 ? '+' : ''}{rands(t.amount)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
