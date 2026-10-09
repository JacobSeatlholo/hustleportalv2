import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { db } from '@/lib/db'
import { todaysChallenges } from '@/lib/gamification'

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const challenges = await todaysChallenges(userId)
  const total = challenges.reduce((a, c) => a + (c.done ? c.xp : 0), 0)
  const max = challenges.reduce((a, c) => a + c.xp, 0)
  return NextResponse.json({ challenges, earned: total, max })
}
