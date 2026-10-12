'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export function fmtMoney(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}

export function fmtDate(v: string | Date | null | undefined) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function daysUntil(v: string | Date | null | undefined) {
  if (!v) return null
  const d = new Date(v)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

export function fmtHours(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}`.trim() : `${m}m`
}

export const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  LEAD: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  INACTIVE: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  PLANNING: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  PAUSED: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  DRAFT: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  SENT: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  PAID: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  OVERDUE: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  TODO: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  DONE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  LOW: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  MEDIUM: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  URGENT: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border-transparent font-medium', STATUS_STYLES[status] ?? '', className)}>
      {status.replace('_', ' ')}
    </Badge>
  )
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  icon: LucideIcon
  tone?: 'default' | 'positive' | 'negative' | 'warning'
}) {
  const tones: Record<string, string> = {
    default: 'text-foreground',
    positive: 'text-emerald-600 dark:text-emerald-400',
    negative: 'text-rose-600 dark:text-rose-400',
    warning: 'text-amber-600 dark:text-amber-400',
  }
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className={cn('mt-1 truncate text-xl font-bold tabular-nums sm:text-2xl', tones[tone])}>{value}</p>
            {sub ? <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p> : null}
          </div>
          <div className="rounded-lg bg-muted p-2">
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-12 text-center">
      <div className="rounded-full bg-muted p-3">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-rose-50 py-10 text-center dark:bg-rose-950/30">
      <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{message}</p>
      {onRetry ? (
        <button onClick={onRetry} className="text-xs font-medium underline underline-offset-4">
          Try again
        </button>
      ) : null}
    </div>
  )
}

export const CATEGORIES = ['SOFTWARE', 'EQUIPMENT', 'MARKETING', 'TRAVEL', 'OFFICE', 'SUBSCRIPTION', 'OTHER'] as const
export const PAY_METHODS = ['BANK', 'CASH', 'CARD', 'PAYPAL', 'OTHER'] as const
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'ZAR', 'NGN', 'KES', 'AED', 'INR'] as const
