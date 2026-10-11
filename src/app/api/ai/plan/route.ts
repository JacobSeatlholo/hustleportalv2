import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { awardXp, bumpChallenge } from '@/lib/gamification'
import { geminiGenerate } from '@/lib/gemini'

export const maxDuration = 60

const NO_KEY_MSG =
  'The AI business plan needs your free Gemini API key. Get one in 1 minute at aistudio.google.com/apikey, then paste it under Integrations.'

// POST /api/ai/plan — generate a real business plan from wizard answers
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const answers = await req.json()

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    business, targetMarket, revenueModel, competitors, goals,
  } = answers

  const prompt = `You are a practical South African business advisor. Write a concise, actionable business plan in markdown for this business. Use rand (R) values. Ground everything in the South African market reality (loadshedding resilience, WhatsApp-first marketing, township economics where relevant, Yoco/SnapScan payments, SEZ/SARS basics if relevant). Be specific and practical, not generic.

Business: ${business}
Target market: ${targetMarket}
How it makes money: ${revenueModel}
Competitors/edge: ${competitors}
12-month goal: ${goals}

Owner context: ${user.name}, business ${user.businessName || '(as above)'}, industry ${user.industry || 'unspecified'}, city ${user.city || 'South Africa'}.

Structure the plan with these markdown sections (## level):
1. Mission (2 sentences)
2. Target Market (who, where, why they buy — 4-5 sentences)
3. Revenue Streams (a markdown list with realistic pricing in R)
4. Marketing Plan (WhatsApp-first, community, referrals — 5 bullet actions)
5. 90-Day Milestones (4 measurable milestones)
6. This Week (3 concrete actions)
7. Risks & Fixes (2 risks with practical fixes)

Keep it under 700 words. No preamble, start with the first heading.`

  const result = await geminiGenerate(userId, {
    system: 'You are a no-nonsense South African small business advisor. You write tight, practical plans. Markdown only.',
    prompt,
  })

  if (!result.ok) {
    if (result.error.startsWith('NO_KEY')) {
      return NextResponse.json({ error: NO_KEY_MSG, code: 'MISSING_GEMINI_KEY' }, { status: 400 })
    }
    console.error('ai plan error', result.error)
    return NextResponse.json(
      { error: 'The AI could not generate your plan right now. Please try again in a moment.' },
      { status: 502 }
    )
  }
  const content = result.text

  const plan = await db.aiPlan.create({
    data: { userId, answers: JSON.stringify(answers), content },
  })
  await bumpChallenge(userId, 'ai_plan')
  await awardXp(userId, 'AI_PLAN', 30, 'Generated AI business plan')
  return NextResponse.json({ plan })
}

// GET /api/ai/plan — list user's plans
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const plans = await db.aiPlan.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, createdAt: true, answers: true, content: true },
  })
  return NextResponse.json({ plans })
}
