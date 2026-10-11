/**
 * Gemini calls grounded in the user's business profile.
 * PLUG & PLAY: works out of the box with the platform key (Vercel env GEMINI_API_KEY).
 * A user's own key (UserSetting: GEMINI_API_KEY, Integrations hub) is an OPTIONAL
 * override — power users can run AI on their own quota.
 */
import { db } from '@/lib/db'

const MODEL = 'gemini-3.8-flash' // gemini-2.0-flash retired (Google 404) — keep current per API guidance
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

export async function getUserGeminiKey(userId: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: 'GEMINI_API_KEY' } },
  })
  return row?.value || null
}

/** Platform key from the environment (set once on the server by the operator). */
export function getPlatformGeminiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null
}

/** Resolution order: user's own key (override) → platform key → null. */
export async function resolveGeminiKey(
  userId: string
): Promise<{ key: string | null; source: 'user' | 'platform' | 'none' }> {
  const userKey = await getUserGeminiKey(userId)
  if (userKey) return { key: userKey, source: 'user' }
  const platformKey = getPlatformGeminiKey()
  if (platformKey) return { key: platformKey, source: 'platform' }
  return { key: null, source: 'none' }
}

export type GeminiResult = { ok: true; text: string } | { ok: false; error: string }

export interface GeminiHistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

export async function geminiGenerate(
  userId: string,
  opts: { system?: string; prompt: string; json?: boolean; history?: GeminiHistoryTurn[] },
): Promise<GeminiResult> {
  const { key } = await resolveGeminiKey(userId)
  if (!key) {
    return {
      ok: false,
      error:
        'NO_KEY: HustlePortal AI is not switched on yet — try again soon. You can also add your own free Gemini key under Integrations to go live instantly.',
    }
  }
  try {
    const history = (opts.history || []).slice(-10).map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }))
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [...history, { role: 'user', parts: [{ text: opts.prompt }] }],
        ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
        generationConfig: {
          temperature: opts.json ? 0.4 : 0.8,
          maxOutputTokens: 1200,
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Gemini API ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
    if (!text.trim()) return { ok: false, error: 'Gemini returned an empty response.' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Gemini request failed' }
  }
}

/** Parse a JSON object out of a Gemini response (tolerates ``` fences). */
export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0]) as T
      } catch {}
    }
    return null
  }
}
