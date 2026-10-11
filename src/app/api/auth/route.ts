import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, createSession, verifyPassword } from '@/lib/auth'
import { ensureWallet, addCredits } from '@/lib/wallet'
import { getConfig, CONFIG_KEYS } from '@/lib/config'
import { awardXp, bumpChallenge } from '@/lib/gamification'
import { attributeSignup } from '@/lib/referral'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'register') {
      const { email, password, name, businessName, industry, city, phone } = body
      if (!email || !password || !name) {
        return NextResponse.json({ error: 'Name, email and password are required.' }, { status: 400 })
      }
      if (String(password).length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
      }
      const normalized = String(email).toLowerCase().trim()
      const exists = await db.user.findUnique({ where: { email: normalized } })
      if (exists) {
        return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
      }
      const userCount = await db.user.count()
      const user = await db.user.create({
        data: {
          email: normalized,
          passwordHash: await hashPassword(String(password)),
          name: String(name),
          businessName: businessName || null,
          industry: industry || null,
          city: city || null,
          phone: phone || null,
          role: userCount === 0 ? 'ADMIN' : 'MEMBER',
        },
      })
      await createSession(user.id)
      await ensureWallet(user.id)
      // welcome bonus credits (free reveals)
      const freeCredits = parseInt(await getConfig(CONFIG_KEYS.FREE_LEADS)) || 3
      const leadPrice = parseInt(await getConfig(CONFIG_KEYS.LEAD_PRICE)) || 1500
      if (freeCredits > 0) {
        await addCredits(user.id, freeCredits * leadPrice, 'BONUS', `Welcome bonus — ${freeCredits} free lead reveals`)
      }
      await awardXp(user.id, 'SIGNUP', 50, 'Joined HustlePortal')
      await bumpChallenge(user.id, 'login')
      // Referral attribution (teams invite teams) — R10 to the referrer on signup.
      try {
        await attributeSignup(user.id, normalized, body.refCode)
      } catch { /* attribution must never block registration */ }
      return NextResponse.json({ ok: true })
    }

    if (action === 'login') {
      const { email, password } = body
      if (!email || !password) {
        return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
      }
      const user = await db.user.findUnique({ where: { email: String(email).toLowerCase().trim() } })
      if (!user || !(await verifyPassword(String(password), user.passwordHash))) {
        return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
      }
      await createSession(user.id)
      await ensureWallet(user.id)
      await bumpChallenge(user.id, 'login')
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    console.error('auth error', e)
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
  }
}
