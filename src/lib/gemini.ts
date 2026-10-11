/**
 * Gemini calls grounded in the user's business profile.
 * Uses the USER'S OWN Gemini API key (UserSetting: GEMINI_API_KEY), set in the
 * Integrations hub — HustlePortal ships no keys of its own.
 */
import { db } from '@/lib/db'

const MODEL = 'gemini-2.0-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

export async function getUserGeminiKey(userId: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: 'GEMINI_API_KEY' } },
  })
  return row?.value || null
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
  const key = await getUserGeminiKey(userId)
  if (!key) {
    return { ok: false, error: 'NO_KEY: Add your Gemini API key in Integrations to unlock AI drafts.' }
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
