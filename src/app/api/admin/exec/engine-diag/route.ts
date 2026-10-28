import { NextResponse } from 'next/server'
import { requireExec } from '@/lib/admin'
import { geminiGenerate } from '@/lib/gemini'
import { zaiGenerate } from '@/lib/zai'

export const maxDuration = 60

/**
 * ENGINE DIAGNOSTIC, the operator's stethoscope. POST /api/admin/exec/engine-diag
 *
 * One plain Gemini call, one grounded (google_search) Gemini call and one GLM
 * web-search call, each at the smallest useful size, each returning its own
 * result PLUS the engine trace (raw status lines and, on 429, the quota
 * bucket fields Google named). Answers the questions the friendly error
 * messages deliberately hide from members:
 *   - does the platform key still work for PLAIN generation at all?
 *   - does the SEARCH bucket 429, and which bucket exactly (per-day drain on
 *     which model, or a project whose free grounding tier reads zero)?
 *   - does the GLM door answer searches (funded) or refuse (balance)?
 * Read only, no money moves, no limits touched: each probe is one call.
 */
export async function POST() {
  const gate = await requireExec()
  if (!gate.ok) return gate.res

  const probePrompt =
    'Is there a real business called "Vida e Caffe" in Cape Town, South Africa? ' +
    'Return ONLY JSON: {"found":true|false,"phone":"","source":"where you saw it"}'

  const plainTrace: string[] = []
  const searchTrace: string[] = []
  const glmTrace: string[] = []

  const [plain, search, glm] = await Promise.all([
    geminiGenerate(gate.me.id, {
      prompt: 'Reply with the single word OK and nothing else.',
      timeoutMs: 15_000,
      trace: plainTrace,
    }),
    geminiGenerate(gate.me.id, {
      search: true,
      json: true,
      maxOutputTokens: 800,
      timeoutMs: 30_000,
      trace: searchTrace,
      prompt: probePrompt,
    }),
    zaiGenerate(gate.me.id, {
      search: true,
      json: true,
      maxTokens: 600,
      timeoutMs: 25_000,
      trace: glmTrace,
      prompt: probePrompt,
    }),
  ])

  return NextResponse.json({
    ok: true,
    geminiPlain: { ok: plain.ok, ...(plain.ok ? { text: plain.text?.slice(0, 120) } : { error: plain.error }), trace: plainTrace },
    geminiSearch: { ok: search.ok, ...(search.ok ? { text: search.text?.slice(0, 400) } : { error: search.error }), trace: searchTrace },
    glmSearch: { ok: glm.ok, ...(glm.ok ? { text: (glm as { text?: string }).text?.slice(0, 400) } : { error: glm.error }), trace: glmTrace },
  })
}
