import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { readLastSystemSend } from '@/lib/mailer'
import { deepseekBalance, getPlatformDeepseekKey } from '@/lib/deepseek'
import { geminiFetchTarget } from '@/lib/gemini'

export const dynamic = 'force-dynamic'

/**
 * GET /api/status, live platform status for the Integrations trust panel.
 * Presence plus the last honest outcome only: never secret values, never hosts.
 * Cached 45s in the instance so the panel can poll freely without cost.
 *
 * Rows the BROWSER knows better than the server (voice dictation support) are
 * added client side; this endpoint answers for everything with a heartbeat:
 * database, AI engine, email engine, push notifications.
 */

interface Svc {
  key: string
  name: string
  ok: boolean
  detail: string
}

let cache: { at: number; services: Svc[] } | null = null
const TTL_MS = 45_000

async function dbService(): Promise<Svc> {
  try {
    await db.$queryRaw`SELECT 1`
    return {
      key: 'database',
      name: 'Business data',
      ok: true,
      detail: 'Live. Your records save and sync the moment you press save.',
    }
  } catch {
    return {
      key: 'database',
      name: 'Business data',
      ok: false,
      detail: 'Struggling to reach the data store right now. Nothing is lost, it retries on its own.',
    }
  }
}

async function aiService(): Promise<Svc> {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) {
    return {
      key: 'ai',
      name: 'AI engine',
      ok: false,
      detail: 'Not switched on yet. The operator adds one key and every AI feature lights up.',
    }
  }
  // Probe a REAL generation, not ListModels: a key whose daily free-tier bucket is
  // drained still passes ListModels, which would show "Live" while every scan fails.
  // One 8-token call per 45s cache window, honest status at negligible cost.
  try {
    // Probe on a LITE model: the full flash alias is a thinking model whose latency
    // can outlive a 6s probe and read as an outage that is not there. Lite answers
    // in about a second, so false alarms stay off the status panel.
    const target = geminiFetchTarget(key, '/models/gemini-flash-lite-latest:generateContent')
    const res = await fetch(
      target.url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...target.headers },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply: OK' }] }], generationConfig: { maxOutputTokens: 64, temperature: 0 } }),
        signal: AbortSignal.timeout(6_000),
      },
    )
    if (res.ok) {
      return {
        key: 'ai',
        name: 'AI engine',
        ok: true,
        detail: 'Live. Lead finder, diary scanner and the Co-Founder are answering.',
      }
    }
    if (res.status === 429) {
      return {
        key: 'ai',
        name: 'AI engine',
        ok: false,
        detail: 'Daily free quota used up. It resets around 02:00 South African time, and the map directory covers lead searches meanwhile.',
      }
    }
    if (res.status === 403 || res.status === 401) {
      return {
        key: 'ai',
        name: 'AI engine',
        ok: false,
        detail: 'The platform AI key was rejected by Google. A fresh key from AI Studio brings everything back.',
      }
    }
    return {
      key: 'ai',
      name: 'AI engine',
      ok: false,
      detail: `Google answered with status ${res.status}. It retries on its own.`,
    }
  } catch {
    return {
      key: 'ai',
      name: 'AI engine',
      ok: false,
      detail: 'Could not reach Google just now. It retries automatically.',
    }
  }
}

async function emailService(): Promise<Svc> {
  const configured = Boolean(process.env.RESEND_API_KEY?.trim())
  if (!configured) {
    return {
      key: 'email',
      name: 'Email engine',
      ok: false,
      detail: 'Not configured yet. Sends will flow the moment the operator adds the sending key.',
    }
  }
  const last = await readLastSystemSend().catch(() => null)
  if (last?.ok) {
    const ageH = Math.max(0, Math.round((Date.now() - new Date(last.at).getTime()) / 36e5))
    return {
      key: 'email',
      name: 'Email engine',
      ok: true,
      detail: `Live. The last system email landed ${ageH === 0 ? 'within this hour' : `${ageH} hour${ageH === 1 ? '' : 's'} ago`}.`,
    }
  }
  if (last && !last.ok) {
    return {
      key: 'email',
      name: 'Email engine',
      ok: false,
      detail: 'The last system email hit a snag and will retry. Your own sends still go out.',
    }
  }
  return {
    key: 'email',
    name: 'Email engine',
    ok: true,
    detail: 'Configured and standing by. Your emails go out the moment you press send.',
  }
}

/**
 * DeepSeek engine, the pay-as-you-go lead ranker. Platform-level view: the
 * operator's env key and its real credit balance. A user's own key (the common
 * case) gets its verdict at save time under Integrations; this row answers for
 * the platform pool only.
 */
async function deepseekService(): Promise<Svc> {
  const key = getPlatformDeepseekKey()
  if (!key) {
    return {
      key: 'deepseek',
      name: 'DeepSeek engine',
      ok: false,
      detail: 'Optional pay-as-you-go ranker. Add your DeepSeek key under Integrations and lead ranking runs on your own credits with no daily quota wall.',
    }
  }
  const bal = await deepseekBalance(key, 6_000)
  if (!bal) {
    return {
      key: 'deepseek',
      name: 'DeepSeek engine',
      ok: false,
      detail: 'Could not reach DeepSeek just now. It retries automatically.',
    }
  }
  if (!bal.available) {
    return {
      key: 'deepseek',
      name: 'DeepSeek engine',
      ok: false,
      detail: 'DeepSeek flags the account unavailable. Check platform.deepseek.com, then check again here.',
    }
  }
  return {
    key: 'deepseek',
    name: 'DeepSeek engine',
    ok: true,
    detail: `Live. $${(bal.totalUsd ?? 0).toFixed(2)} of credits standing by for lead ranking.`,
  }
}

async function pushService(): Promise<Svc> {
  try {
    const rows = await db.platformConfig.findMany({
      where: { key: { in: ['PUSH_VAPID_PUBLIC', 'PUSH_VAPID_PRIVATE'] } },
    })
    const ready = rows.filter((r) => Boolean(r.value)).length >= 2
    return ready
      ? {
          key: 'push',
          name: 'Push notifications',
          ok: true,
          detail: 'Live. Installed apps receive task reminders and due date alerts.',
        }
      : {
          key: 'push',
          name: 'Push notifications',
          ok: false,
          detail: 'Warming up. Keys generate themselves on the first push subscribe.',
        }
  } catch {
    return {
      key: 'push',
      name: 'Push notifications',
      ok: false,
      detail: 'Could not check just now. It retries automatically.',
    }
  }
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({
      services: cache.services,
      checkedAt: new Date(cache.at).toISOString(),
      cached: true,
    })
  }

  const [database, ai, email, push, deepseek] = await Promise.all([
    dbService(),
    aiService(),
    emailService(),
    pushService(),
    deepseekService(),
  ])
  const services = [database, ai, deepseek, email, push]
  cache = { at: Date.now(), services }
  return NextResponse.json({
    services,
    checkedAt: new Date(cache.at).toISOString(),
    cached: false,
  })
}
