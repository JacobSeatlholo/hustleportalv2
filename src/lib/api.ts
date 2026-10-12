import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Lazily flip SENT invoices past their due date to OVERDUE. */
export async function refreshOverdueInvoices() {
  const overdue = await db.invoice.updateMany({
    where: { status: 'SENT', dueDate: { lt: new Date() } },
    data: { status: 'OVERDUE' },
  })
  return overdue.count
}

export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v)
}

export function optStr(v: unknown): string | null {
  if (v == null || v === '') return null
  return typeof v === 'string' ? v : String(v)
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}

export function optNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

export function bool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

export function optDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function optId(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0 && v !== 'none') return v
  return null
}
