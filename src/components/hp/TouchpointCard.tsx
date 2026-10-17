'use client'

import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { tpSnooze, tpRetire } from './touchpoints'

/**
 * TouchpointCard — the ONE visual form every conversion touchpoint takes.
 * Slim, calm, professional: a quiet suggestion at the right moment.
 * The product never shouts — the card states the outcome, offers two taps,
 * and gets out of the way.
 */
export function TouchpointCard({
  id,
  title,
  body,
  children,
  snoozeDays = 7,
  footer,
}: {
  id: string
  title: string
  body: string
  /** Action buttons — usually one store deep-link + one service request. */
  children: React.ReactNode
  snoozeDays?: number
  /** Tiny trust line under the actions (e.g. "Quoted before any work starts"). */
  footer?: string
}) {
  return (
    <div className="relative rounded-lg border border-brand/30 bg-brand/[0.06] p-4 pr-12 space-y-2.5">
      <button
        aria-label="Dismiss for good"
        title="Don't show suggestions like this"
        onClick={() => tpRetire(id)}
        className="absolute right-2.5 top-2.5 text-muted-foreground/60 hover:text-foreground transition"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-2.5">
        <div className="rounded-lg bg-brand/15 p-1.5 mt-0.5 shrink-0">
          <Sparkles className="h-4 w-4 text-brand" />
        </div>
        <div className="space-y-1 min-w-0">
          <p className="font-medium text-sm leading-snug">{title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[42px]">
        {children}
        <button
          onClick={() => tpSnooze(id, snoozeDays)}
          className="text-[11px] text-muted-foreground hover:text-foreground transition"
        >
          Maybe later
        </button>
      </div>
      {footer && (
        <p className="text-[10px] text-muted-foreground/70 pl-[42px]">{footer}</p>
      )}
    </div>
  )
}

/** Reusable quiet action for touchpoint cards. */
export function TouchpointAction({
  onClick,
  primary,
  children,
}: {
  onClick: () => void
  primary?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      size="sm"
      variant={primary ? 'default' : 'outline'}
      onClick={onClick}
      className={primary ? 'bg-brand text-black hover:bg-brand/90 font-semibold' : ''}
    >
      {children}
    </Button>
  )
}
