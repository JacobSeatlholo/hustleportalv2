'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { api, rands, type CreditTx, type TopUpPack } from './shared'
import { SPEND_ACTIONS, COMING_SOON_SKUS, TOPUP_MIN_CENTS, TOPUP_MAX_CENTS, bonusForLoad, creditsForLoad } from '@/lib/spend'
import { levelFor, revealPriceForLevel, REVEAL_DISCOUNT_MIN_LEVEL, DISCOUNTED_REVEAL_PRICE_CENTS } from '@/lib/levels'
import { useHp } from './store'
import { Wallet, Loader2, ArrowDownLeft, ArrowUpRight, Sparkles, ShieldCheck, Gift, Coins } from 'lucide-react'

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
  const [returnNote, setReturnNote] = useState<string | null>(null)
  const [customRands, setCustomRands] = useState('')

  // Custom load derived state: rands -> cents -> ladder bonus -> pack shape
  // identical to the fixed packs, so the same topUp() path serves both.
  const customCents = Math.round(Number(customRands || 0) * 100)
  const customPack: TopUpPack | null =
    customCents >= TOPUP_MIN_CENTS && customCents <= TOPUP_MAX_CENTS
      ? { id: 'custom', name: 'Custom load', amountCents: customCents, creditCents: creditsForLoad(customCents), bonus: bonusForLoad(customCents) }
      : null
  const isValidCustom = customPack !== null

  async function load() {
    try {
      setData(await api<WalletData>('/api/wallet'))
    } catch {
      toast({ title: 'Failed to load wallet', variant: 'destructive' })
    }
  }

  useEffect(() => {
    load()
    // Return-from-Yoco handling: credits land via webhook a few seconds after payment.
    const params = new URLSearchParams(window.location.search)
    const t = params.get('topup')
    if (t) {
      if (t === 'success') {
        setReturnNote('Payment received, your credits are being added to your wallet right now.')
        setTimeout(load, 4000)
        setTimeout(load, 9000)
      } else if (t === 'cancelled') {
        setReturnNote('Checkout cancelled, nothing was charged.')
      } else if (t === 'failed') {
        setReturnNote('Payment did not go through. No charge was made, please try again.')
      }
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function topUp(pack: TopUpPack) {
    setBuying(pack.id)
    try {
      const res = await api<{ ok: boolean; redirectUrl?: string; sandbox?: boolean }>(
        '/api/wallet/topup',
        { method: 'POST', body: JSON.stringify({ packageId: pack.id, ...(pack.id === 'custom' ? { amountCents: Math.round(Number(customRands) * 100) } : {}) }) }
      )
      if (res.redirectUrl) {
        // Live Yoco Checkout, hand off to the hosted payment page.
        window.location.href = res.redirectUrl
        return
      }
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

      {returnNote && (
        <div className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand shrink-0" />
          <span>{returnNote}</span>
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setReturnNote(null)}>✕</button>
        </div>
      )}

      {/* Balance hero */}
      <div className="rounded-2xl bg-sidebar text-sidebar-foreground p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-brand/15 p-3"><Wallet className="h-7 w-7 text-brand" /></div>
          <div>
            <div className="text-sm text-sidebar-foreground/60">Available credits</div>
            <div className="font-display text-4xl">{rands(data?.wallet.balance ?? session?.wallet.balance ?? 0)}</div>
          </div>
        </div>
        <div className="text-xs text-sidebar-foreground/50 max-w-xs">
          Your airtime: load once, spend it on the things that grow the business, reload when you run dry. Failed deliveries never cost a cent.
        </div>
      </div>

      {/* What your credits buy — the airtime price list, outcome-led. Prices come
          from the ONE catalog (src/lib/spend.ts) the server also charges from. */}
      <div className="rounded-xl border bg-card p-4">
        <h2 className="font-medium mb-1 flex items-center gap-2"><Coins className="h-4 w-4 text-brand" /> What your credits buy</h2>
        <p className="text-xs text-muted-foreground mb-3">Loaded once, spent only when something actually happens for your business.</p>
        <ul className="space-y-2.5 text-sm">
          <li className="flex gap-3">
            <span className="font-display text-brand shrink-0 w-16">{rands(SPEND_ACTIONS.EMAIL_SEND.cents)}</span>
            <span><span className="font-medium">Outreach email</span> — {SPEND_ACTIONS.EMAIL_SEND.outcome}</span>
          </li>
          <li className="flex gap-3">
            <span className="font-display text-brand shrink-0 w-16">{rands(revealPriceForLevel(levelFor(session?.user?.xp ?? 0).level))}</span>
            <span><span className="font-medium">Verified lead reveal</span> — Real contact details of a real business, verified before a cent leaves your wallet. Your own imported contacts stay free. {levelFor(session?.user?.xp ?? 0).level >= REVEAL_DISCOUNT_MIN_LEVEL ? 'You reveal at the Operator perk price.' : `Reveal at R15 once you reach Operator (level 3).`}</span>
          </li>
          {COMING_SOON_SKUS.map((sku) => (
            <li key={sku.key} className="flex gap-3 text-muted-foreground">
              <span className="font-display shrink-0 w-16">{rands(sku.cents)}</span>
              <span><span className="font-medium">{sku.label}</span> <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">soon</Badge> — {sku.outcome}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mt-3 border-t pt-3">
          On a plan? Your monthly send bundle rides first — Operator carries 150 emails a month, Boss 400. Airtime only starts spending once your free monthly sends are done, and failed deliveries never cost a cent.
        </p>
      </div>

      {/* Packs */}
      <div>
        <h2 className="font-medium mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /> Top-up packs</h2>
        <div className="grid md:grid-cols-3 gap-3">
          {!data && [...Array(3)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
          {data?.packs.map((p, i) => (
            <Card key={p.id} className={`relative ${i === 1 ? 'border-brand shadow-md shadow-brand/20' : ''}`}>
              {i === 1 && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand text-black hover:bg-brand">
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

        {/* Custom load: any amount from R50, ladder bonus exactly like the packs. */}
        <Card className="mt-3">
          <CardContent className="p-5 space-y-3">
            <div className="font-medium text-sm">Load your own amount</div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R</span>
                <Input
                  type="number"
                  min={TOPUP_MIN_CENTS / 100}
                  max={TOPUP_MAX_CENTS / 100}
                  step="10"
                  placeholder="e.g. 250"
                  value={customRands}
                  onChange={(e) => setCustomRands(e.target.value)}
                  className="pl-7"
                  aria-label="Custom top-up amount in rands"
                />
              </div>
              <Button
                variant="outline"
                disabled={buying !== null || !isValidCustom}
                onClick={() => customPack && topUp(customPack)}
              >
                {buying === 'custom' ? <Loader2 className="h-4 w-4 animate-spin" /> : `Load ${customRands ? rands(creditsForLoad(customCents)) : 'airtime'}`}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {customRands && isValidCustom && bonusForLoad(customCents) > 0
                ? <>You load <span className="font-medium text-foreground">{rands(customCents)}</span> and your wallet grows by <span className="font-medium text-emerald-600">{rands(creditsForLoad(customCents))}</span> — a {bonusForLoad(customCents)}% bonus airtime.</>
                : <>Minimum R50. Bonus airtime from R1,500 (+10%) and R5,000 (+15%) — the same ladder the packs ride.</>}
            </p>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          Paid securely with Yoco (card, Apple Pay, Google Pay). Credits land in your wallet the moment your payment clears.
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
              <div className={`rounded-lg p-2 ${t.amount >= 0 ? 'bg-emerald-500/15' : 'bg-brand/15'}`}>
                {t.amount >= 0
                  ? <ArrowDownLeft className="h-4 w-4 text-emerald-400" />
                  : <ArrowUpRight className="h-4 w-4 text-brand" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {t.description}
                  {t.type === 'BONUS' && <Gift className="h-3.5 w-3.5 text-brand" />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(t.createdAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })} · balance {rands(t.balanceAfter)}
                </div>
              </div>
              <span className={`text-sm font-semibold shrink-0 ${t.amount >= 0 ? 'text-emerald-400' : 'text-brand'}`}>
                {t.amount >= 0 ? '+' : ''}{rands(t.amount)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
