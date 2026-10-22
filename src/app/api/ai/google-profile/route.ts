import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { consumeAiBudget, aiBudgetExceeded } from '@/lib/aiusage'
import { bumpChallenge } from '@/lib/gamification'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'

export const maxDuration = 60

const NO_KEY_MSG =
  'HustlePortal AI is warming up and will be live shortly. You can also add your own free Gemini key at aistudio.google.com/apikey and paste it under Integrations to go live instantly.'

export interface GoogleProfileKit {
  description: string
  descriptionChars: number
  descriptionOverLimit: boolean
  categories: { primary: string; extra: string[] }
  services: string[]
  posts: { title: string; body: string }[]
  reviewReplies: { positive: string; negative: string }
  photos: string[]
  keywords: string[]
  steps: string[]
}

// POST /api/ai/google-profile — the AI Co-Founder writes the member's complete
// Google Business Profile kit: description, categories, services, posts, review
// replies, photo checklist and the apply steps. Google's own Business Profile API
// is gated behind an access request that takes about two weeks and is aimed at
// agencies, so v1 writes everything and the member pastes it into Google in about
// ten minutes. Zero marginal cost: one Gemini call inside the daily AI budget.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const budget = await consumeAiBudget(userId)
  if (!budget.ok) {
    return NextResponse.json(aiBudgetExceeded(budget), { status: 429 })
  }

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    differentiator?: unknown
    offer?: unknown
    currentDescription?: unknown
  }
  const clean = (v: unknown, cap: number) =>
    typeof v === 'string' ? v.trim().slice(0, cap) : ''
  const differentiator = clean(body.differentiator, 600)
  const offer = clean(body.offer, 300)
  const currentDescription = clean(body.currentDescription, 800)

  const system = `You write Google Business Profile content for South African small businesses. You write like their sharp honest cofounder.

Rules for every word you produce:
Simple English a busy owner reads fast. Short sentences. Strong plain words, no fluff.
No emoji anywhere. No hyphens and no dashes of any kind. No ALL CAPS words. At most one exclamation mark in the whole answer.
Never invent facts. No fake awards, no years in business, no review counts, no ratings, no customers you have not seen. When a fact is missing, use a short placeholder in square brackets like [your suburb].
The description must follow Google rules: under 700 characters, no prices, no links, no time limited promo language, no superlatives you cannot prove. The first 250 characters must carry the business type, the main services, the city and what makes the business different.
Categories must be real Google Business Profile categories that exist in South Africa. The primary category is the exact kind of business, the extras are closely related.
Keywords are the phrases a local customer actually types into Google when they need this business, and each one includes the city or a nearby area.
Posts sound like the owner talking to the neighbourhood. One post can use the special offer when one was provided.
Review replies are warm, professional and honest. A negative reply stays calm, apologises once and moves the conversation offline. Put [name] where a customer name would go.
Steps tell the owner exactly where to paste each piece: google.com/business or the business card in Google search, the info section for description and categories, the services section, the photos section, the updates section for posts, and the reviews section for replies. Also remind them to keep the business name, address and phone exactly the same everywhere online.

Return ONLY valid JSON in this exact shape, no markdown around it:
{
  "description": "string under 700 characters",
  "categories": { "primary": "string", "extra": ["3 to 4 strings"] },
  "services": ["4 to 6 short strings"],
  "posts": [ { "title": "string under 60 characters", "body": "string under 300 characters" }, { "title": "string", "body": "string" }, { "title": "string", "body": "string" } ],
  "reviewReplies": { "positive": "string 40 to 80 words", "negative": "string 40 to 80 words" },
  "photos": ["6 short strings, one photo idea each"],
  "keywords": ["6 to 8 strings"],
  "steps": ["6 to 8 short strings, one action each"]
}`

  const prompt = `Business: ${user.businessName || 'not set'}
Industry: ${user.industry || 'not set'}
City: ${user.city || 'not set'}
Phone: ${user.phone || 'not set'}
What makes us different: ${differentiator || 'not provided, work it out from the industry and city'}
Special offer to promote: ${offer || 'none'}
Current Google description: ${currentDescription || 'none yet'}

Write my full Google profile kit.`

  const result = await geminiGenerate(userId, {
    system,
    prompt,
    json: true,
    maxOutputTokens: 3000,
  })

  if (!result.ok) {
    if (result.error.startsWith('NO_KEY')) {
      return NextResponse.json({ error: NO_KEY_MSG, code: 'MISSING_GEMINI_KEY' }, { status: 400 })
    }
    console.error('google-profile error', result.error)
    return NextResponse.json(
      { error: 'The AI Co-Founder could not write the kit right now. Try again in a moment.' },
      { status: 502 }
    )
  }

  const raw = parseJsonLoose<Record<string, unknown>>(result.text)
  if (!raw || typeof raw.description !== 'string' || !raw.description.trim()) {
    return NextResponse.json(
      { error: 'The kit came back incomplete. Try again — the second run usually lands it.' },
      { status: 502 }
    )
  }

  const strArr = (v: unknown, max: number, cap: number): string[] => {
    if (!Array.isArray(v)) return []
    return v
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((s) => s.trim().slice(0, cap))
      .slice(0, max)
  }

  const cats = (raw.categories || {}) as { primary?: unknown; extra?: unknown }
  const postsRaw = Array.isArray(raw.posts) ? raw.posts : []
  const replies = (raw.reviewReplies || {}) as { positive?: unknown; negative?: unknown }

  const description = raw.description.trim()
  const descriptionChars = [...description].length

  const kit: GoogleProfileKit = {
    description,
    descriptionChars,
    descriptionOverLimit: descriptionChars > 750,
    categories: {
      primary: typeof cats.primary === 'string' ? cats.primary.trim().slice(0, 80) : '',
      extra: strArr(cats.extra, 4, 80),
    },
    services: strArr(raw.services, 6, 80),
    posts: postsRaw
      .slice(0, 3)
      .map((p) => {
        const o = (p || {}) as { title?: unknown; body?: unknown }
        return {
          title: typeof o.title === 'string' ? o.title.trim().slice(0, 80) : '',
          body: typeof o.body === 'string' ? o.body.trim().slice(0, 400) : '',
        }
      })
      .filter((p) => p.body),
    reviewReplies: {
      positive: typeof replies.positive === 'string' ? replies.positive.trim().slice(0, 600) : '',
      negative: typeof replies.negative === 'string' ? replies.negative.trim().slice(0, 600) : '',
    },
    photos: strArr(raw.photos, 6, 120),
    keywords: strArr(raw.keywords, 8, 80),
    steps: strArr(raw.steps, 8, 200),
  }

  await bumpChallenge(userId, 'google_profile')
  return NextResponse.json({ kit })
}
