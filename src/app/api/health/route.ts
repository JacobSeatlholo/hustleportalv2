import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET /api/health → liveness + which platform integrations are wired.
// Reports PRESENCE ONLY (booleans) — never secret values.
export async function GET() {
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
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
