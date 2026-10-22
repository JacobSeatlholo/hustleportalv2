import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { consumeAiBudget, aiBudgetExceeded } from '@/lib/aiusage'
import { bumpChallenge } from '@/lib/gamification'
import { geminiGenerate, GeminiHistoryTurn } from '@/lib/gemini'

export const maxDuration = 60

const NO_KEY_MSG =
  'HustlePortal AI is warming up and will be live shortly. You can also add your own free Gemini key at aistudio.google.com/apikey and paste it under Integrations to go live instantly.'

// POST /api/ai/advisor, AI Co-Founder chat, grounded in the user's real data
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // AI cost guard: one daily allowance per account, checked BEFORE any
  // Gemini/DeepSeek spend. Generous for humans, a wall for scripts.
  const budget = await consumeAiBudget(userId)
  if (!budget.ok) {
    return NextResponse.json(aiBudgetExceeded(budget), { status: 429 })
  }

  const { message } = await req.json()
  if (!message || !String(message).trim()) {
    return NextResponse.json({ error: 'Say something first.' }, { status: 400 })
  }

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // build context from real user data
  const [leadCount, openTasks, pipeline, wallet, lastPlan] = await Promise.all([
    db.lead.count({ where: { userId } }),
    db.task.count({ where: { OR: [{ assigneeId: userId }, { creatorId: userId }], NOT: { status: 'DONE' } } }),
    db.lead.findMany({ where: { userId, NOT: { stage: { in: ['WON', 'LOST'] } } }, select: { company: true, stage: true, value: true }, take: 8 }),
    db.wallet.findUnique({ where: { userId } }),
    db.aiPlan.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ])
  const pipelineValue = pipeline.reduce((a, l) => a + (l.value || 0), 0)

  const context = `Founder: ${user.name}. Business: ${user.businessName || 'not set'}. Industry: ${user.industry || 'not set'}. City: ${user.city || 'not set'}.
Data: ${leadCount} leads in CRM, pipeline worth R${pipelineValue.toFixed(0)} across: ${pipeline.map((l) => `${l.company} (${l.stage}, R${l.value})`).join('; ') || 'empty pipeline'}.
Tasks: ${openTasks} open. Credit balance: R${((wallet?.balance || 0) / 100).toFixed(2)}.
${lastPlan ? `They have an AI business plan generated on ${lastPlan.createdAt.toDateString()}.` : 'No business plan generated yet, suggest it if relevant.'}`

  const history = await db.aiMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  const msgs: GeminiHistoryTurn[] = history
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  await db.aiMessage.create({ data: { userId, role: 'user', content: String(message) } })

  const result = await geminiGenerate(userId, {
    system: `You are the AI Co-Founder inside HustlePortal, a business growth platform for South African entrepreneurs. You speak like a sharp, encouraging South African business partner, practical, warm, direct. Use rand values, SA context (WhatsApp marketing, Yoco, township economy, loadshedding). Reference the founder's real data when useful. If they ask about Google, Google Maps or their Google Business Profile, give a short answer and point them to the Google profile tab in the AI Co-Founder, which writes their full profile kit ready to paste. Keep answers under 180 words unless asked for detail. Never invent facts, numbers, prices or results: give advice from the context you have, and when you do not know, say what to check instead of guessing.\n\nCONTEXT:\n${context}`,
    prompt: String(message),
    history: msgs,
  })

  if (!result.ok) {
    if (result.error.startsWith('NO_KEY')) {
      return NextResponse.json({ error: NO_KEY_MSG, code: 'MISSING_GEMINI_KEY' }, { status: 400 })
    }
    console.error('advisor error', result.error)
    return NextResponse.json(
      { error: 'The AI Co-Founder could not answer right now. Try again in a moment.' },
      { status: 502 }
    )
  }

  const saved = await db.aiMessage.create({ data: { userId, role: 'assistant', content: result.text } })
  await bumpChallenge(userId, 'ai_chat')
  return NextResponse.json({ reply: saved.content })
}

// GET, chat history
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const msgs = await db.aiMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
  return NextResponse.json({ messages: msgs })
}
