'use client'

import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { api } from './shared'
import { useHp } from './store'
import { RESOURCES } from '@/data/resources'
import { BookOpen, ExternalLink, Search } from 'lucide-react'

export default function ResourcesView() {
  const bumpRefresh = useHp((s) => s.bumpRefresh)
  const [q, setQ] = useState('')

  // "Explore the Resource Hub" daily challenge
  useEffect(() => {
    api('/api/gamification/challenges', {
      method: 'POST',
      body: JSON.stringify({ key: 'explore_resources' }),
    })
      .then(() => bumpRefresh())
      .catch(() => {})
  }, [bumpRefresh])

  const cats = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return RESOURCES
    return RESOURCES.map((c) => ({
      ...c,
      items: c.items.filter(
        (t) =>
          t.name.toLowerCase().includes(needle) ||
          t.desc.toLowerCase().includes(needle) ||
          c.title.toLowerCase().includes(needle)
      ),
    })).filter((c) => c.items.length > 0)
  }, [q])

  const totalTools = RESOURCES.reduce((a, c) => a + c.items.length, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-brand" /> RESOURCES
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Free tools, guides &amp; learning materials — {totalTools} hand-picked links for business owners
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tools…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {cats.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          No tools match &ldquo;{q}&rdquo; — try another search.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {cats.map((cat) => (
            <div
              key={cat.title}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              <div
                className="px-4 py-3 flex items-center gap-2.5 border-b border-border"
                style={{ backgroundColor: `${cat.color}14` }}
              >
                <span className="text-lg">{cat.icon}</span>
                <span className="font-semibold text-sm" style={{ color: cat.color }}>
                  {cat.title}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {cat.items.length} {cat.items.length === 1 ? 'tool' : 'tools'}
                </span>
              </div>
              <div className="divide-y divide-white/5">
                {cat.items.map((t) => (
                  <a
                    key={t.name + t.url}
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium group-hover:text-brand transition truncate">
                        {t.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{t.desc}</div>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-brand transition shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground text-center pt-2">
        Curated by the HustlePortal team — free tools your business can use today. Suggest a tool via WhatsApp.
      </p>
    </div>
  )
}
