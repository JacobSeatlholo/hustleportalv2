import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { consumeAiBudget, aiBudgetExceeded } from '@/lib/aiusage'
import { resolveProject, profileText } from '@/lib/workspace'
import { db } from '@/lib/db'
import { geminiGenerate } from '@/lib/gemini'

export const maxDuration = 60

// POST /api/ai/sales-pitch { projectId? } → AI pitch grounded in the business profile, persisted to Project.salesPitch
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // AI cost guard: one daily allowance per account, checked BEFORE any
  // Gemini/DeepSeek spend. Generous for humans, a wall for scripts.
  const budget = await consumeAiBudget(userId)
  if (!budget.ok) {
    return NextResponse.json(aiBudgetExceeded(budget), { status: 429 })
  }
  const body = await req.json().catch(() => ({}))
  const project = await resolveProject(userId, body.projectId)

  const filled = [project.industry, project.valueProp, project.targetMarket, project.offerings].filter(Boolean).length
  if (filled === 0) {
    return NextResponse.json({
      error: 'Fill in at least your industry and what you offer first, the AI pitches from your profile, not thin air.',
    }, { status: 400 })
  }

  const result = await geminiGenerate(userId, {
    system:
      'You are a sharp South African sales copywriter. Write a sales pitch grounded ONLY in the business profile provided, never invent products, clients or prices. ' +
      'Plain text, 3 short paragraphs: (1) hook that names the target market, (2) what they offer + the value proposition, (3) a concrete call to action. ' +
      'No headings, no markdown, no emojis.',
    prompt: `=== BUSINESS PROFILE ===\n${profileText(project)}\n\nWrite the pitch.`,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const pitch = result.text.trim()
  const updated = await db.project.update({ where: { id: project.id }, data: { salesPitch: pitch } })
  return NextResponse.json({ pitch, project: updated, ...(result.notice ? { notice: result.notice } : {}) })
}
