import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { readLastSystemSend } from '@/lib/mailer'
import { deepseekBalance, getPlatformDeepseekKey } from '@/lib/deepseek'
import { getPlatformZaiKey, probeZaiKey } from '@/lib/zai'

export const dynamic = 'force-dynamic'

/**
 * GET /api/status — live platform status for the Integrations trust panel.
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
  // One 8-token call per 45s cache window — honest status at negligible cost.
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + encodeURIComponent(key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply: OK' }] }], generationConfig: { maxOutputTokens: 8, temperature: 0 } }),
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
 * DeepSeek engine — the pay-as-you-go lead ranker. Platform-level view: the
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

/**
 * z.ai GLM engine — the pay as you go web grounded engine. Platform-level view:
 * the operator's env key probed with a REAL micro generation through the two
 * door walk (a drained or rejected key can never fake Live). A user's own key
 * gets its verdict at save time under Integrations; this row answers for the
 * platform pool only.
 */
async function zaiService(): Promise<Svc> {
  const key = getPlatformZaiKey()
  if (!key) {
    return {
      key: 'zai',
      name: 'z.ai GLM engine',
      ok: false,
      detail: 'Optional pay as you go backup. Add your z.ai key under Integrations and lead discovery runs on your own credits with live web search, no Google quota.',
    }
  }
  const probe = await probeZaiKey(key, 15_000)
  if (probe.status === 200) {
    return {
      key: 'zai',
      name: 'z.ai GLM engine',
      ok: true,
      detail:
        probe.endpoint === 'zhipu'
          ? 'Live on the Zhipu open platform. Lead discovery keeps running here on GLM credits, no Google quota.'
          : 'Live. When Google acts up, lead discovery keeps running here on pay as you go credits.',
    }
  }
  if (probe.status === 401 || probe.status === 403) {
    return {
      key: 'zai',
      name: 'z.ai GLM engine',
      ok: false,
      detail: 'The platform GLM key was rejected by both doors. A fresh key from the API keys page of the platform where the credits live brings the engine back.',
    }
  }
  if (probe.status === 402 || probe.status === 429) {
    return {
      key: 'zai',
      name: 'z.ai GLM engine',
      ok: false,
      detail: 'GLM is pacing requests or the credits are spent. A top up on the billing page revives it.',
    }
  }
  if (probe.status === null) {
    return {
      key: 'zai',
      name: 'z.ai GLM engine',
      ok: false,
      detail: 'Could not reach GLM just now. It retries automatically.',
    }
  }
  return {
    key: 'zai',
    name: 'z.ai GLM engine',
    ok: false,
    detail: `GLM answered with status ${probe.status}. It retries on its own.`,
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

  const [database, ai, email, push, deepseek, zai] = await Promise.all([
    dbService(),
    aiService(),
    emailService(),
    pushService(),
    deepseekService(),
    zaiService(),
  ])
  const services = [database, ai, deepseek, zai, email, push]
  cache = { at: Date.now(), services }
  return NextResponse.json({
    services,
    checkedAt: new Date(cache.at).toISOString(),
    cached: false,
  })
}
