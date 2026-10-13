import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { getUserGeminiKey, getPlatformGeminiKey } from '@/lib/gemini'

export const maxDuration = 60

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

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

  if (keys.length === 0) {
    report.verdict = 'No Gemini key is configured at all — AI features are dormant.'
    report.advice.push('Add your free Gemini key under Integrations (aistudio.google.com → Get API key), or the operator must set GEMINI_API_KEY on the platform.')
    return NextResponse.json({ ok: true, ...report })
  }

  for (const { source, key } of keys) {
    // 1) ListModels — catches disabled API, restricted keys, bad keys
    try {
      const res = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=100`, {
        method: 'GET',
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

    // 2) Live 1-shot generate on the alias-first chain — catches retired-model 404s.
    //    A 429 does NOT stop the walk: we test EVERY model so the report shows which
    //    buckets still have headroom — the exact signal that separates a burned daily
    //    cap from a zero free-tier limit on the project (different fixes entirely).
    const tryModels = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash']
    let liveOk = false
    const quota429: { model: string; detail: string; zero: boolean; perDay: boolean }[] = []
    for (const model of tryModels) {
      try {
        const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }], generationConfig: { maxOutputTokens: 8, temperature: 0 } }),
          signal: AbortSignal.timeout(20_000),
        })
        const raw = await res.text().catch(() => '')
        if (res.ok) {
          report.checks.push({ source, test: `live-generate:${model}`, ok: true, status: 200, detail: 'Live AI call succeeded.' })
          liveOk = true
          break
        } else if (res.status === 404) {
          report.checks.push({ source, test: `live-generate:${model}`, ok: false, status: 404, detail: 'Model not available for this key — trying the next model in the chain.' })
          continue
        } else if (res.status === 429) {
          const { detail, zero, perDay } = quotaForensics(raw, model)
          quota429.push({ model, detail, zero, perDay })
          report.checks.push({ source, test: `live-generate:${model}`, ok: false, status: 429, detail })
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
    // Quota verdict — scenario advice from the actual bucket names Google returned.
    if (quota429.length > 0) {
      const who = source === 'user' ? 'YOUR saved key' : 'the platform key'
      const anyZero = quota429.some((q) => q.zero)
      const anyPerDay = quota429.some((q) => q.perDay)
      const drained = quota429.map((q) => q.model).join(', ')
      if (liveOk) {
        report.advice.push(`Some models are quota-blocked (${drained}) but at least one model answered — the app keeps working on the healthy model. ${anyZero ? 'The zero-limit models need billing or a different project (see below).' : anyPerDay ? 'Day buckets reset around 02:00 South African time (midnight UTC).' : 'Minute buckets clear on their own.'}`)
      } else if (anyZero) {
        report.advice.push(`ZERO FREE-TIER LIMIT on ${who} (${drained}): Google returned limit 0 — this project has NO free quota for these models, so waiting will not fix it. Two real fixes: (1) In Google Cloud console, open the project behind this key and enable billing — the API then runs on pay-as-you-go Tier 1 (Flash-class models cost a few dollars per million tokens; a scanning month costs a few rand). (2) Create a brand-new AI Studio key in a DIFFERENT project (aistudio.google.com/apikey) and update ${source === 'user' ? 'the key under Integrations' : 'GEMINI_API_KEY in Vercel env'}, then redeploy. Confirm which project the key belongs to at https://ai.dev/rate-limit while logged into the right Google account.`)
      } else if (anyPerDay) {
        report.advice.push(`DAILY CAP BURNED on ${who} (${drained}): every model hit its per-day free-tier bucket. Google's own reset clock (retryDelay) points to midnight UTC — around 02:00 South African time. Options: wait for the reset, scan fewer searches per day, or enable billing on the Google project behind the key for Tier 1 limits (pay-as-you-go, a few rand per scanning month on Flash models).`)
      } else {
        report.advice.push(`MINUTE CAP on ${who} (${drained}): the per-minute free-tier bucket is drained. It clears on its own within a minute — spaced-out scanning avoids it.`)
      }
    }
    if (liveOk && source === 'platform') report.verdict = `AI is healthy on the platform key — scans and drafts work.${userKey ? ' Note: YOUR key is tried first; if it is broken the platform key silently takes over.' : ''}`
    else if (liveOk && source === 'user' && keys.length === 1) report.verdict = 'AI is healthy on your own key.'
  }

  if (!report.verdict) {
    const anyOk = report.checks.some((c) => c.ok && c.test.startsWith('live-generate'))
    report.verdict = anyOk
      ? 'AI is working on at least one key — the fallback chain keeps every feature running.'
      : 'No key could complete a live AI call — this is why scans return errors. Apply the advice below.'
  }

  return NextResponse.json({ ok: true, ...report })
}
