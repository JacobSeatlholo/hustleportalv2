import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health → liveness + which platform integrations are wired.
 * Reports PRESENCE ONLY (booleans) and a classified DB ping — never secret
 * values, never hostnames or usernames from the connection string.
 *
 * dbPingError classes (Prisma codes) map to concrete user actions:
 *  P1001  can't reach server      → Neon project paused/deleted, wrong host, network
 *  P1000  auth failed             → wrong password in DATABASE_URL
 *  P1003  database does not exist → DB name wrong or branch deleted
 *  P2021  table does not exist    → schema not synced (db push never ran)
 *  TIMEDOUT / others              → network/latency issue
 */

function classifyDbError(e: unknown): string {
  const raw = e instanceof Error ? `${e.message}` : String(e)
  // Strip anything that could leak connection details (hosts, users, IPs).
  const sanitized = raw
    .replace(/([a-zA-Z0-9-]+\.)+(neon|aws|amazonaws|vercel-dns|com|tech|app)[^/\s"']*/g, '[host]')
    .replace(/postgresql?:\/\/[^\s"']+/g, '[conn]')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '[ip]')
    .slice(0, 160)
  const code = (raw.match(/P1\d{3}|P2\d{3}/) || [])[0]
  return code ? `${code}: ${sanitized}` : sanitized
}

export async function GET() {
  let dbPing = false
  let dbPingError: string | null = null
  let tables: string[] | null = null
  let userQuery: 'ok' | string | null = null
  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    try {
      await prisma.$queryRaw`SELECT 1`
      dbPing = true
      // Enumerate public tables (names only — no data) to detect empty/partial schema.
      const rows = (await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`) as { table_name: string }[]
      tables = rows.map((r) => String(r.table_name))
      try {
        await prisma.user.findFirst({ select: { id: true } })
        userQuery = 'ok'
      } catch (e) {
        userQuery = classifyDbError(e)
      }
    } finally {
      await prisma.$disconnect().catch(() => {})
    }
  } catch (e) {
    dbPingError = classifyDbError(e)
  }

  // Mirror the auth route's import graph + first DB calls to pinpoint the
  // exact failing step (modules can fail at import time; the shared db
  // singleton can behave differently from a fresh client).
  const steps: Record<string, string> = {}
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
      steps[name] = 'ok'
    } catch (e) {
      steps[name] = classifyDbError(e)
    }
  }

  try {
    const dbMod = await import('@/lib/db')
    await step('user.count', () => dbMod.db.user.count())
    await step('challengeProgress.findFirst', () =>
      dbMod.db.challengeProgress.findFirst({ select: { id: true } })
    )
  } catch (e) {
    steps['diag-fatal'] = e instanceof Error ? e.message.slice(0, 120) : 'unknown'
  }

  // Hardened disclosure: an anonymous visitor gets liveness + integration
  // PRESENCE booleans only. The deep diagnostics (table inventory, error
  // classes, step-by-step results) are an owner/exec eye — they describe the
  // database schema shape, which is attack-planning material, not public info.
  const gate = await requireExec()
  const detail = gate.ok
    ? { error: dbPingError, tables, userQuery, steps }
    : { error: null, tables: null, userQuery: null, steps: {} }

  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    db: { ping: dbPing, ...detail },
    integrations: {
      aiPlatformKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
      emailPlatformKey: Boolean(process.env.RESEND_API_KEY?.trim()),
      emailFrom: Boolean(process.env.RESEND_FROM?.trim()),
      authSecret: Boolean(process.env.AUTH_SECRET?.trim()),
      yoco: Boolean(process.env.YOCO_SECRET_KEY?.trim()),
      verifiedFeed: Boolean(process.env.EXPLEE_API_KEY?.trim()),
      database: Boolean(process.env.DATABASE_URL?.trim()),
    },
  })
}
