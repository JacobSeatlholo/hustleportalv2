import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { getUserGeminiKey, getPlatformGeminiKey, geminiFetchTarget, thinkingConfigFor } from '@/lib/gemini'
import { resolveDeepseekKey } from '@/lib/deepseek'
import { resolveZaiKey, probeZaiKey, probeZaiSearch } from '@/lib/zai'

export const maxDuration = 60

/**
 * GET /api/ai/diagnose — WHY is AI failing? Tests the full key chain the same way
 * the scan/AI features do, and reports exactly what Google returns for each key:
 *   1. Key presence (user key, platform key) — masked.
 *   2. ListModels per key (catches disabled API / restricted keys / 403s).
 *   3. A tiny live generateContent on the alias model (catches retired-model 404s).
 * Returns plain-language advice the user (or the operator) can act on immediately.
 */
function mask(v: string) {
  return v.length <= 8 ? '••••' : `${v.slice(0, 6)}…${v.slice(-4)}`
}

/**
 * Pull the useful bones out of a 429 body: which quota bucket, what limit, when it
 * resets. Google puts violations in error.details[] (quotaId like
 * "GenerateRequestsPerDayPerProjectPerModel", a numeric limit, and a retryDelay).
 * A limit of 0 is the smoking gun for "no free tier on this project for this model".
 */
function quotaForensics(raw: string, model: string): { detail: string; zero: boolean; perDay: boolean } {
  let zero = /"limit":\s*"?0"?|limit:\s*0\b/i.test(raw)
  let perDay = /PerDay/i.test(raw)
  let retryDelay: string | null = null
  try {
    const j = JSON.parse(raw) as {
      error?: {
        message?: string
        details?: { violations?: { quotaMetric?: string; quotaId?: string }[]; quotaLimit?: number | string; retryDelay?: string }[]
      }
    }
    const details = j.error?.details || []
    const viol = details.find((d) => Array.isArray(d.violations))?.violations?.[0]
    const limit = details.find((d) => typeof d.quotaLimit !== 'undefined')?.quotaLimit
    retryDelay = details.find((d) => typeof d.retryDelay === 'string')?.retryDelay || null
    if (viol) {
      if (typeof limit !== 'undefined') zero = zero || String(limit) === '0'
      if (viol.quotaId) perDay = perDay || /PerDay/i.test(viol.quotaId)
      return {
        detail: JSON.stringify({ bucket: viol.quotaId, metric: viol.quotaMetric, limit, retryDelay }),
        zero,
        perDay,
      }
    }
  } catch { /* plain-text body — regex flags already set */ }
  return { detail: `429 on ${model}${retryDelay ? ` — retry in ${retryDelay}` : ''}${zero ? ' — LIMIT 0 (no free tier for this model on this project)' : perDay ? ' — daily bucket burned' : ''}`, zero, perDay }
}

interface DeepseekDiag {
  configured: boolean
  keySource: 'user' | 'platform' | 'none'
  masked?: string
  ok: boolean
  balanceUsd?: number | null
  message: string
}

/** DeepSeek side of the engine: key present, accepted, and the REAL credit balance. */
async function deepseekDiag(userId: string): Promise<DeepseekDiag> {
  const { key, source } = await resolveDeepseekKey(userId)
  if (!key) {
    return {
      configured: false,
      keySource: 'none',
      ok: false,
      message: 'No DeepSeek key saved. Lead ranking falls back to Gemini search grounding or the raw map directory.',
    }
  }
  const who = source === 'user' ? 'your key' : 'the platform key'
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401) {
      return {
        configured: true,
        keySource: source,
        masked: mask(key),
        ok: false,
        message: `DeepSeek rejected ${who}. Paste a fresh key from platform.deepseek.com/api_keys under Integrations.`,
      }
    }
    if (!res.ok) {
      return {
        configured: true,
        keySource: source,
        masked: mask(key),
        ok: false,
        message: `DeepSeek answered with status ${res.status}. It retries on its own.`,
      }
    }
    const data = (await res.json()) as {
      is_available?: boolean
      balance_infos?: { currency?: string; total_balance?: string }[]
    }
    const usd = Number((data.balance_infos || []).find((b) => (b.currency || '').toUpperCase() === 'USD')?.total_balance ?? NaN)
    const balanceUsd = Number.isFinite(usd) ? usd : null
    if (data.is_available === false) {
      return {
        configured: true,
        keySource: source,
        masked: mask(key),
        ok: false,
        balanceUsd,
        message: `DeepSeek flags the account behind ${who} unavailable. Check platform.deepseek.com.`,
      }
    }
    if (balanceUsd !== null && balanceUsd <= 0) {
      return {
        configured: true,
        keySource: source,
        masked: mask(key),
        ok: false,
        balanceUsd,
        message: `DeepSeek credits are used up on ${who}. Top up at platform.deepseek.com. The map directory and Gemini fallback keep scans alive meanwhile.`,
      }
    }
    return {
      configured: true,
      keySource: source,
      masked: mask(key),
      ok: true,
      balanceUsd,
      message: `DeepSeek is live on ${who}${balanceUsd !== null ? ` with $${balanceUsd.toFixed(2)} of credits` : ''}. Lead ranking runs here first, with no daily quota wall.`,
    }
  } catch {
    return {
      configured: true,
      keySource: source,
      masked: mask(key),
      ok: false,
      message: 'Could not reach DeepSeek just now. It retries automatically.',
    }
  }
}

interface ZaiDiag {
  configured: boolean
  keySource: 'user' | 'platform' | 'none'
  masked?: string
  ok: boolean
  message: string
  searchOk?: boolean
  searchRaw?: string | null
}

/** z.ai side of the chain: key present, accepted, and a REAL micro generation. */
async function zaiDiag(userId: string): Promise<ZaiDiag> {
  const { key, source } = await resolveZaiKey(userId)
  if (!key) {
    return {
      configured: false,
      keySource: 'none',
      ok: false,
      message: 'No z.ai key saved. Lead discovery rides on Gemini and the map directory.',
    }
  }
  const who = source === 'user' ? 'your key' : 'the platform key'
  const probe = await probeZaiKey(key, 15_000)
  if (probe.status === 200) {
    // Plain generation works. But lead scans live or die by the live web
    // search tool, so that gets its own probe too: probeZaiSearch pins the
    // paid workhorse model and FORCES a real search invocation, so a free
    // flash rung answering plain generation can no longer dress an empty
    // wallet up as search ready. The door's own words stay for the operator.
    const sprobe = await probeZaiSearch(key, 12_000)
    if (sprobe.ok) {
      return {
        configured: true,
        keySource: source,
        masked: mask(key),
        ok: true,
        searchOk: true,
        message: `z.ai GLM is live on ${who}${sprobe.endpoint === 'zhipu' ? ' via the Zhipu open platform' : ''}. When Google acts up, lead discovery keeps running here on pay as you go credits, with live web search grounding.`,
      }
    }
    return {
      configured: true,
      keySource: source,
      masked: mask(key),
      ok: false,
      searchOk: false,
      searchRaw: sprobe.words,
      message: `GLM answers on ${who}, but the web search tool was refused for balance on both doors (status ${sprobe.status ?? 'none'}). One login serves both GLM doors and search is billed apart from model tokens, so a small top up or a search bundle on the billing page of the platform where your credits live is the part to fix. The engine said: ${sprobe.words || 'no message'}`,
    }
  }
  if (probe.status === 401 || probe.status === 403) {
    return {
      configured: true,
      keySource: source,
      masked: mask(key),
      ok: false,
      message: `z.ai rejected ${who} on both GLM doors. Generate a fresh key on the API keys page of the platform where the credits live and save it where the old one lives.`,
    }
  }
  if (probe.status === 402 || probe.status === 429) {
    return {
      configured: true,
      keySource: source,
      masked: mask(key),
      ok: false,
      message: `GLM is pacing requests or the credits behind ${who} are spent. A top up on the billing page revives it. The map directory and Gemini keep scans alive meanwhile.`,
    }
  }
  if (probe.status === null) {
    return {
      configured: true,
      keySource: source,
      masked: mask(key),
      ok: false,
      message: 'Could not reach GLM just now. It retries automatically.',
    }
  }
  return {
    configured: true,
    keySource: source,
    masked: mask(key),
    ok: false,
    message: `GLM answered with status ${probe.status}. It retries on its own.`,
  }
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userKey = await getUserGeminiKey(userId)
  const platformKey = getPlatformGeminiKey()
  const keys = [
    ...(userKey ? [{ source: 'user' as const, key: userKey }] : []),
    ...(platformKey && platformKey !== userKey ? [{ source: 'platform' as const, key: platformKey }] : []),
  ]

  const report = {
    checkedAt: new Date().toISOString(),
    keys: {
      userKey: userKey ? { present: true, masked: mask(userKey) } : { present: false },
      platformKey: platformKey ? { present: true, masked: mask(platformKey) } : { present: false },
    },
    checks: [] as {
      source: string
      test: string
      ok: boolean
      status: number | null
      detail: string
      models?: string[]
    }[],
    advice: [] as string[],
    verdict: '',
  }

  const deepseek = await deepseekDiag(userId)
  const zai = await zaiDiag(userId)

  if (keys.length === 0) {
    report.verdict = 'No Gemini key is configured at all — AI features are dormant.'
    report.advice.push('Add your free Gemini key under Integrations (aistudio.google.com → Get API key), or the operator must set GEMINI_API_KEY on the platform.')
    if (zai.configured && zai.ok) {
      report.verdict = 'Gemini has no key configured, but the z.ai GLM engine is live — lead discovery still works end to end with web search grounding.'
    } else if (deepseek.configured && deepseek.ok) {
      report.verdict = 'Gemini has no key configured, but DeepSeek is live — lead scans still work end to end.'
    }
    return NextResponse.json({ ok: true, deepseek, zai, ...report })
  }

  for (const { source, key } of keys) {
    // 1) ListModels — catches disabled API, restricted keys, bad keys
    try {
      const target = geminiFetchTarget(key, '/models?pageSize=100')
      const res = await fetch(target.url, {
        method: 'GET',
        headers: target.headers,
        signal: AbortSignal.timeout(15_000),
      })
      const raw = await res.text().catch(() => '')
      if (res.ok) {
        let names: string[] = []
        try {
          const data = JSON.parse(raw) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }
          names = (data.models || [])
            .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
            .map((m) => (m.name || '').replace('models/', ''))
            .filter(Boolean)
        } catch {}
        report.checks.push({ source, test: 'list-models', ok: true, status: 200, detail: `Key accepted — ${names.length} models visible.`, models: names.slice(0, 40) })
      } else {
        const cls = /API_KEY_INVALID|API key not valid/i.test(raw)
          ? 'Key is invalid, deleted or mistyped.'
          : res.status === 403
            ? 'Key rejected (403) — the Generative Language API is not enabled for this key\'s project, or the key has API/website restrictions.'
            : `Google returned ${res.status}.`
        report.checks.push({ source, test: 'list-models', ok: false, status: res.status, detail: cls })
        if (source === 'user') {
          report.advice.push(`Your own key failed the key check: ${cls} Fix it at aistudio.google.com or remove it under Integrations — the platform key takes over automatically.`)
        } else {
          report.advice.push(`PLATFORM KEY FAILED: ${cls} Operator action — check GEMINI_API_KEY on the server (Vercel env) and enable the Generative Language API in that Google project.`)
        }
      }
    } catch (e) {
      report.checks.push({ source, test: 'list-models', ok: false, status: null, detail: `Network error: ${e instanceof Error ? e.message : 'request failed'}` })
    }

    // 2) Live 1-shot generate across the DISCOVERED pool — the same filter the
    //    engine uses, so the report maps exactly the buckets the app will try.
    //    When a model SUCCEEDS we stop (health proven, quota saved). When models
    //    FAIL we walk the WHOLE pool: 429 (quota), 503 (Google shedding load) and
    //    404 (model unavailable for this key) are all per-model, never project-wide.
    const seenModels = (report.checks.find((c) => c.test === 'list-models' && c.ok && c.models)?.models || []) as string[]
    // Lite models lead the walk: they skip extended thinking, so a healthy key
    // proves itself in seconds instead of strangling the probe on a thinking alias.
    const PREF = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']
    const tryModels = seenModels.length > 0
      ? [
          ...PREF.filter((m) => seenModels.includes(m)),
          ...seenModels.filter((m) => !PREF.includes(m) && /flash/i.test(m) && !/tts|image|embed|transcribe|robotics|computer|omni|banana|lyria|antigravity|customtools/i.test(m)),
        ].slice(0, 12)
      : ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite']
    let liveOk = false
    let liveOn = ''
    const quota429: { model: string; detail: string; zero: boolean; perDay: boolean }[] = []
    const overload: string[] = []
    const unavailable: string[] = []
    for (const model of tryModels) {
      try {
        const target = geminiFetchTarget(key, `/models/${model}:generateContent`)
        const cfg = thinkingConfigFor(model)
        const res = await fetch(target.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...target.headers },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
            generationConfig: {
              maxOutputTokens: 64,
              temperature: 0,
              ...(cfg ? { thinkingConfig: cfg } : {}),
            },
          }),
          signal: AbortSignal.timeout(20_000),
        })
        const raw = await res.text().catch(() => '')
        if (res.ok) {
          report.checks.push({ source, test: `live-generate:${model}`, ok: true, status: 200, detail: 'Live AI call succeeded.' })
          liveOk = true
          liveOn = model
          break
        } else if (res.status === 404) {
          unavailable.push(model)
          report.checks.push({ source, test: `live-generate:${model}`, ok: false, status: 404, detail: 'Model not available for this key.' })
          continue
        } else if (res.status === 429) {
          const { detail, zero, perDay } = quotaForensics(raw, model)
          quota429.push({ model, detail, zero, perDay })
          report.checks.push({ source, test: `live-generate:${model}`, ok: false, status: 429, detail })
          continue
        } else if (res.status >= 500) {
          overload.push(`${model} (${res.status})`)
          report.checks.push({ source, test: `live-generate:${model}`, ok: false, status: res.status, detail: 'Google is shedding load on this model right now (temporary, self-heals).' })
          continue
        } else {
          report.checks.push({ source, test: `live-generate:${model}`, ok: false, status: res.status, detail: raw.slice(0, 300) || `Google returned ${res.status}.` })
          if (res.status === 403) {
            if (/denied access/i.test(raw)) {
              report.advice.push(`OPERATOR ACTION (platform key): Google has DENIED the whole key's project ("Your project has been denied access"). The key itself is valid — the Google Cloud project behind it is suspended/flagged. Fix: create a NEW project at aistudio.google.com, generate a fresh API key, and replace GEMINI_API_KEY in Vercel environment variables, then redeploy. Users can also add their own working key under Integrations to run AI immediately.`)
            } else {
              report.advice.push(`Platform AI call blocked (403). Enable the "Generative Language API" for the key's project and clear API/website restrictions on the key (aistudio.google.com / Cloud console).`)
            }
            break
          }
          break
        }
      } catch (e) {
        report.checks.push({ source, test: `live-generate:${model}`, ok: false, status: null, detail: `Network error: ${e instanceof Error ? e.message : 'request failed'}` })
        break
      }
    }
    // Quota + overload verdict — scenario advice from what Google actually returned.
    if (quota429.length > 0) {
      const who = source === 'user' ? 'YOUR saved key' : 'the platform key'
      const anyZero = quota429.some((q) => q.zero)
      const anyPerDay = quota429.some((q) => q.perDay)
      const drained = quota429.map((q) => q.model).join(', ')
      if (liveOk) {
        report.advice.push(`AI answered on ${liveOn}. Resting right now: ${drained}${overload.length ? `, overloaded: ${overload.join(', ')}` : ''}. The engine spreads the day across the pool automatically. ${anyZero ? 'The zero-limit models need billing or a different project (see below).' : anyPerDay ? 'Day buckets reset around 02:00 South African time (midnight UTC).' : 'Minute buckets clear on their own.'}`)
      } else if (anyZero) {
        report.advice.push(`ZERO FREE-TIER LIMIT on ${who} (${drained}): Google returned limit 0 — this project has NO free quota for these models, so waiting will not fix it. Two real fixes: (1) In Google Cloud console, open the project behind this key and enable billing — the API then runs on pay-as-you-go Tier 1 (Flash-class models cost a few dollars per million tokens; a scanning month costs a few rand). (2) Create a brand-new AI Studio key in a DIFFERENT project (aistudio.google.com/apikey) and update ${source === 'user' ? 'the key under Integrations' : 'GEMINI_API_KEY in Vercel env'}, then redeploy. Confirm which project the key belongs to at https://ai.dev/rate-limit while logged into the right Google account.`)
      } else if (anyPerDay) {
        report.advice.push(`DAILY CAP BURNED on ${who} (${drained}): every model hit its per-day free-tier bucket. Google's own reset clock (retryDelay) points to midnight UTC — around 02:00 South African time. Options: wait for the reset, scan fewer searches per day, or enable billing on the Google project behind the key for Tier 1 limits (pay-as-you-go, a few rand per scanning month on Flash models).`)
      } else {
        report.advice.push(`MINUTE CAP on ${who} (${drained}): the per-minute free-tier bucket is drained. It clears on its own within a minute — spaced-out scanning avoids it.`)
      }
    } else if (overload.length > 0 && !liveOk) {
      report.advice.push(`GOOGLE IS SHEDDING FREE-TIER LOAD right now (${overload.join(', ')}) — 503 high demand is temporary and usually clears within minutes. No action needed; the engine rotates models automatically and retries.`)
    }
    if (liveOk && source === 'platform') report.verdict = `AI is healthy on the platform key (${liveOn}) — scans and drafts work.${userKey ? ' Note: YOUR key is tried first; if it is broken the platform key silently takes over.' : ''}`
    else if (liveOk && source === 'user' && keys.length === 1) report.verdict = 'AI is healthy on your own key.'
    else if (!liveOk && overload.length > 0 && quota429.length === 0) report.verdict = 'Google is shedding free-tier load at this moment (503 high demand) — temporary, it clears on its own. Details below.'
  }

  if (!report.verdict) {
    const anyOk = report.checks.some((c) => c.ok && c.test.startsWith('live-generate'))
    report.verdict = anyOk
      ? 'AI is working on at least one key — the fallback chain keeps every feature running.'
      : 'No key could complete a live AI call — this is why scans return errors. Apply the advice below.'
  }

  return NextResponse.json({ ok: true, deepseek, zai, ...report })
}
