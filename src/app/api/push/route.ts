import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { getVapidPublicKey, sendPushToUser } from '@/lib/push'

export const maxDuration = 30

/**
 * GET /api/push → { publicKey } — the VAPID public key the browser subscribes with.
 * POST /api/push { action:'subscribe', subscription } → store this device.
 * POST /api/push { action:'unsubscribe', endpoint } → forget this device.
 * POST /api/push { action:'test' } → send a real test push to all my devices.
 */
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const publicKey = await getVapidPublicKey()
    return NextResponse.json({ publicKey })
  } catch {
    return NextResponse.json({ error: 'Push is not available right now.' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))

  if (body.action === 'subscribe') {
    const sub = body.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription.' }, { status: 400 })
    }
    await db.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: req.headers.get('user-agent')?.slice(0, 200) || null,
      },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    })
    // Instant payoff: the first push proves the pipe works end to end.
    await sendPushToUser(userId, {
      title: 'Notifications are on 🎉',
      body: "You'll hear from HustlePortal when it matters — starting with tasks due today.",
      url: '/?view=tasks',
      tag: 'welcome',
    })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'unsubscribe') {
    const endpoint = String(body.endpoint || '')
    if (endpoint) await db.pushSubscription.deleteMany({ where: { userId, endpoint } })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'test') {
    const r = await sendPushToUser(userId, {
      title: 'Test from HustlePortal ✅',
      body: 'If you can read this, notifications work on this device.',
      url: '/?view=dashboard',
      tag: 'test',
    })
    if (r.sent === 0) {
      return NextResponse.json(
        { error: 'No device received the test push — turn notifications on first, then send a test.' },
        { status: 400 }
      )
    }
    return NextResponse.json({ ok: true, sent: r.sent })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
