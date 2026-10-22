import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { rateLimit, clientIp, tooMany } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

const PERSONAS = ['FIND_CLIENTS', 'GET_PAID', 'STAY_ON_TOP', 'RUN_EVERYTHING']
const PROFESSIONS = ['ACCOUNTANT', 'ADVISOR', 'LAWYER', 'ENTREPRENEUR', 'SOLOPRENEUR', 'OTHER']

/**
 * POST /api/onboard, save the two question post signup survey: how they work
 * (profession) and what they want first (persona). Idempotent: answering again
 * from Profile simply updates the answers, so personalization can follow the
 * user as their business changes. First completion stamps onboardedAt, which
 * releases the checkout intent handoff and the welcome tour in the right order.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = rateLimit(`onboard:ip:${clientIp(req)}`, 30, 60 * 60 * 1000)
  if (!gate.ok) return NextResponse.json(tooMany(gate.retryAfterSec), { status: 429 })

  try {
    const body = await req.json().catch(() => ({}))
    const persona = String(body.persona || '').trim()
    const profession = String(body.profession || '').trim()
    if (!PERSONAS.includes(persona)) {
      return NextResponse.json({ error: 'Choose what you want to do first.' }, { status: 400 })
    }
    if (!PROFESSIONS.includes(profession)) {
      return NextResponse.json({ error: 'Choose what you do.' }, { status: 400 })
    }

    const before = await db.user.findUnique({ where: { id: userId }, select: { onboardedAt: true } })
    if (!before) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await db.user.update({
      where: { id: userId },
      data: {
        persona,
        profession,
        ...(before.onboardedAt ? {} : { onboardedAt: new Date() }),
      },
      select: { persona: true, profession: true, onboardedAt: true },
    })
    return NextResponse.json({ ok: true, user })
  } catch (e) {
    console.error('onboard error', e)
    return NextResponse.json({ error: 'Could not save your answers. Try again.' }, { status: 500 })
  }
}
