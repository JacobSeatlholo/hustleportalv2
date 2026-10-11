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

    // 2) Live 1-shot generate on the alias-first chain — catches retired-model 404s
    const tryModels = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash']
    let liveOk = false
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
        } else {
          report.checks.push({ source, test: `live-generate:${model}`, ok: false, status: res.status, detail: raw.slice(0, 200) || `Google returned ${res.status}.` })
          break
        }
      } catch (e) {
        report.checks.push({ source, test: `live-generate:${model}`, ok: false, status: null, detail: `Network error: ${e instanceof Error ? e.message : 'request failed'}` })
        break
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
