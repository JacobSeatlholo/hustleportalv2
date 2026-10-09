import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { bumpChallenge } from '@/lib/gamification'

export const maxDuration = 120

// POST /api/ai/advisor — chat with business context
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
${lastPlan ? `They have an AI business plan generated on ${lastPlan.createdAt.toDateString()}.` : 'No business plan generated yet — suggest it if relevant.'}`

  const history = await db.aiMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  const msgs = history.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  await db.aiMessage.create({ data: { userId, role: 'user', content: String(message) } })

  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: `You are the BH AI Advisor inside HustlePortal, a business growth platform for South African entrepreneurs. You speak like a sharp, encouraging South African business partner — practical, warm, direct. Use rand values, SA context (WhatsApp marketing, Yoco, township economy, loadshedding). Reference the founder's real data when useful. Keep answers under 180 words unless asked for detail. Never invent data that contradicts the context.\n\nCONTEXT:\n${context}`,
        },
        ...msgs,
        { role: 'user', content: String(message) },
      ],
      thinking: { type: 'disabled' },
    })
    const reply = completion?.choices?.[0]?.message?.content || ''
    if (!reply.trim()) throw new Error('empty reply')
    const saved = await db.aiMessage.create({ data: { userId, role: 'assistant', content: reply } })
    await bumpChallenge(userId, 'ai_chat')
    return NextResponse.json({ reply: saved.content })
  } catch (e) {
    console.error('advisor error', e)
    return NextResponse.json(
      { error: 'The advisor is resting for a moment. Try again shortly.' },
      { status: 503 }
    )
  }
}

// GET — chat history
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
