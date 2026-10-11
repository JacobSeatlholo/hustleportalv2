'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { api } from './shared'
import { useHp } from './store'
import { SHOP_ITEMS, SHOP_CATEGORIES, waLink, type ShopItem } from '@/data/shop'
import { ExternalLink, Loader2, MessageCircle, Search, ShoppingCart, Sparkles } from 'lucide-react'

export default function StoreView() {
  const bumpRefresh = useHp((s) => s.bumpRefresh)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('All')
  const [active, setActive] = useState<ShopItem | null>(null)
  const [imgError, setImgError] = useState<Record<string, boolean>>({})

  // "Browse the Store" daily challenge
  useEffect(() => {
    api('/api/gamification/challenges', {
      method: 'POST',
      body: JSON.stringify({ key: 'browse_store' }),
    })
      .then(() => bumpRefresh())
      .catch(() => {})
  }, [bumpRefresh])

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return SHOP_ITEMS.filter((i) => {
      const catOk = cat === 'All' || i.cat === cat
      const qOk =
        !needle ||
        i.title.toLowerCase().includes(needle) ||
        i.desc.toLowerCase().includes(needle) ||
        i.cat.toLowerCase().includes(needle)
      return catOk && qOk
    })
  }, [q, cat])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-brand" /> STORE
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            Pay securely with Yoco · Card, Apple Pay &amp; Google Pay accepted
          </p>
        </div>
        <a
          href="https://app.businesshustle.co.za/shop"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-brand inline-flex items-center gap-1"
        >
          Full shop online <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* search + category filters */}
      <div className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search packages & services…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SHOP_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                cat === c
                  ? 'bg-brand border-brand text-black font-semibold'
                  : 'bg-card text-muted-foreground hover:border-brand/60'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* product grid */}
      {items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          Nothing matches &ldquo;{q}&rdquo; — try another search.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <button
              key={item.title}
              onClick={() => setActive(item)}
              className="text-left rounded-xl border border-white/10 bg-card overflow-hidden hover:border-brand/60 transition group"
            >
              <div
                className="h-36 relative overflow-hidden"
                style={{ backgroundColor: `${item.color}22` }}
              >
                {!imgError[item.title] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.img}
                    alt={item.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover group-hover:scale-[1.03] transition duration-300"
                    onError={() => setImgError((m) => ({ ...m, [item.title]: true }))}
                  />
                ) : (
                  <div
                    className="h-full w-full flex items-center justify-center font-display text-4xl"
                    style={{ color: item.color }}
                  >
                    BH
                  </div>
                )}
                <Badge
                  className="absolute top-2 left-2 text-[10px] border-0"
                  style={{ backgroundColor: item.color, color: '#0a0a0b' }}
                >
                  {item.tag}
                </Badge>
              </div>
              <div className="p-3.5 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm leading-tight">{item.title}</div>
                  <div className="font-display text-brand whitespace-nowrap">{item.price}</div>
                </div>
                <div className="text-xs text-muted-foreground line-clamp-2">{item.desc}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60 pt-1">
                  {item.cat}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* product detail dialog */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-md bg-card border-white/10">
          {active && (
            <div className="space-y-4">
              <div
                className="rounded-lg overflow-hidden h-44 relative"
                style={{ backgroundColor: `${active.color}22` }}
              >
                {!imgError[active.title] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={active.img}
                    alt={active.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                    onError={() => setImgError((m) => ({ ...m, [active.title]: true }))}
                  />
                ) : (
                  <div
                    className="h-full w-full flex items-center justify-center font-display text-5xl"
                    style={{ color: active.color }}
                  >
                    BH
                  </div>
                )}
              </div>
              <DialogHeader className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge style={{ backgroundColor: active.color, color: '#0a0a0b' }} className="border-0">
                    {active.tag}
                  </Badge>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {active.cat}
                  </span>
                </div>
                <DialogTitle className="font-display text-2xl text-left">{active.title}</DialogTitle>
                <div className="font-display text-brand text-xl text-left">{active.price}</div>
                <DialogDescription className="text-left text-sm">
                  {active.fullDesc}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2">
                <Button asChild className="bg-brand text-black hover:bg-brand/90 font-semibold">
                  <a href={waLink(active.waMsg)} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-4 w-4 mr-1.5" /> Order on WhatsApp
                  </a>
                </Button>
                <Button asChild variant="outline" className="border-white/20">
                  <a href={active.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1.5" /> Product page
                  </a>
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground text-center">
                Secured by Yoco — card, Apple Pay &amp; Google Pay. Custom requests? WhatsApp us.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground pt-2">
        <Loader2 className="h-3 w-3 animate-spin hidden" />
        <span>Every purchase directly funds your hustle — built by Business Hustle, for SA hustlers.</span>
      </div>
    </div>
  )
}
