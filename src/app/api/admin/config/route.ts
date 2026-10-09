import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { getConfig, setConfig, CONFIG_KEYS } from '@/lib/config'
import { db } from '@/lib/db'

function isAdmin(role: string) {
  return role === 'ADMIN'
}

// GET /api/admin/config — platform settings + stats (admin only)
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await db.user.findUnique({ where: { id: userId } })
  if (!me || !isAdmin(me.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [expleeKey, leadPrice, mode, packs] = await Promise.all([
    getConfig(CONFIG_KEYS.EXPLEE_API_KEY),
    getConfig(CONFIG_KEYS.LEAD_PRICE),
    getConfig(CONFIG_KEYS.MODE),
    getConfig(CONFIG_KEYS.TOPUP_PACKS),
  ])
  const [userCount, leadCount, txAgg] = await Promise.all([
    db.user.count(),
    db.lead.count(),
    db.creditTx.aggregate({ where: { type: 'TOPUP' }, _sum: { amount: true } }),
  ])
  const users = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, name: true, email: true, businessName: true, role: true, xp: true, createdAt: true, wallet: { select: { balance: true } } },
  })
  return NextResponse.json({
    config: {
      expleeKeySet: expleeKey.length > 5,
      expleeKeyMasked: expleeKey ? `${expleeKey.slice(0, 6)}••••${expleeKey.slice(-4)}` : '',
      leadPrice: parseInt(leadPrice) || 1500,
      mode,
      packs: JSON.parse(packs || '[]'),
    },
    stats: {
      userCount,
      leadCount,
      topupTotal: txAgg._sum.amount || 0,
    },
    users,
  })
}

// POST /api/admin/config — update settings
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await db.user.findUnique({ where: { id: userId } })
  if (!me || !isAdmin(me.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  if ('expleeApiKey' in body) await setConfig(CONFIG_KEYS.EXPLEE_API_KEY, String(body.expleeApiKey).trim())
  if ('leadPrice' in body) await setConfig(CONFIG_KEYS.LEAD_PRICE, String(parseInt(body.leadPrice) || 1500))
  if ('mode' in body) await setConfig(CONFIG_KEYS.MODE, body.mode === 'LIVE' ? 'LIVE' : 'DEMO')
  if ('packs' in body && Array.isArray(body.packs)) {
    await setConfig(CONFIG_KEYS.TOPUP_PACKS, JSON.stringify(body.packs))
  }
  return NextResponse.json({ ok: true })
}
