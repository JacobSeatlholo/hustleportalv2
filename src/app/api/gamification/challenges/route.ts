import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { bumpChallenge, todaysChallenges } from '@/lib/gamification'

// keys that may be bumped straight from the client (view visits)
const CLIENT_BUMPABLE = new Set(['browse_store', 'explore_resources'])

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const challenges = await todaysChallenges(userId)
  const total = challenges.reduce((a, c) => a + (c.done ? c.xp : 0), 0)
  const max = challenges.reduce((a, c) => a + c.xp, 0)
  return NextResponse.json({ challenges, earned: total, max })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { key } = await req.json().catch(() => ({ key: null }))
  if (!key || typeof key !== 'string' || !CLIENT_BUMPABLE.has(key)) {
    return NextResponse.json({ error: 'Unknown challenge.' }, { status: 400 })
  }
  await bumpChallenge(userId, key)
  const challenges = await todaysChallenges(userId)
  return NextResponse.json({ ok: true, challenges })
}
