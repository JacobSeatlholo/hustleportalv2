import { NextResponse } from 'next/server'

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
  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    try {
      await prisma.$queryRaw`SELECT 1`
      dbPing = true
    } finally {
      await prisma.$disconnect().catch(() => {})
    }
  } catch (e) {
    dbPingError = classifyDbError(e)
  }

  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    db: { ping: dbPing, error: dbPingError },
    integrations: {
      aiPlatformKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
      emailPlatformKey: Boolean(process.env.RESEND_API_KEY?.trim()),
      emailFrom: Boolean(process.env.RESEND_FROM?.trim()),
      authSecret: Boolean(process.env.AUTH_SECRET?.trim()),
      yoco: Boolean(process.env.YOCO_SECRET_KEY?.trim()),
      database: Boolean(process.env.DATABASE_URL?.trim()),
    },
  })
}
