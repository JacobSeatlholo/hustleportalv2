/**
 * Referral engine, "teams invite teams" distribution loop.
 * Every user gets a personal code (lazy-generated). Attribution happens at
 * registration via ?ref=CODE. Rewards: R10 signup, R50 first subscription.
 */
import { db } from '@/lib/db'
import { addCredits } from '@/lib/wallet'
import { REFERRAL_REWARD_SIGNUP_CENTS, REFERRAL_REWARD_PAID_CENTS } from '@/lib/plans'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // unambiguous chars

/** Get-or-create the user's personal referral code. */
export async function ensureRefCode(userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, refCode: true, name: true } })
  if (!user) throw new Error('User not found')
  if (user.refCode) return user.refCode
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = ''
    for (let i = 0; i < 8; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    try {
      const updated = await db.user.update({ where: { id: userId }, data: { refCode: code } })
      return updated.refCode as string
    } catch {
      // unique collision, retry with a new code
    }
  }
  throw new Error('Could not generate a referral code')
}

export function refLink(code: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://hustleportal.online'
  return `${base}/?ref=${code}`
}

/**
 * Attribute a fresh registration to a referrer (if the code is valid and
 * not self-referral). Creates the Referral row + pays the R10 signup reward.
 * Returns the referrer id when a link was made.
 */
export async function attributeSignup(newUserId: string, newEmail: string, rawCode?: string | null): Promise<string | null> {
  const code = String(rawCode || '').trim().toUpperCase()
  if (!code) return null
  const referrer = await db.user.findUnique({ where: { refCode: code }, select: { id: true, name: true } })
  if (!referrer || referrer.id === newUserId) return null

  // Don't double-link if this user somehow already has a referral row.
  const existing = await db.referral.findFirst({ where: { invitedUserId: newUserId } })
  if (existing) return referrer.id

  await db.referral.create({
    data: {
      referrerId: referrer.id,
      invitedUserId: newUserId,
      invitedEmail: newEmail,
      status: 'SIGNED_UP',
    },
  })
  await addCredits(referrer.id, REFERRAL_REWARD_SIGNUP_CENTS, 'BONUS', `Referral reward, ${newEmail || 'a new member'} joined`)
  return referrer.id
}

/** Pay the R50 reward when an invited user's subscription activates. Idempotent. */
export async function rewardOnSubscribe(invitedUserId: string): Promise<void> {
  const referral = await db.referral.findFirst({
    where: { invitedUserId, status: 'SIGNED_UP' },
  })
  if (!referral) return
  // claim pattern: only the first update transitions the row
  const claim = await db.referral.updateMany({
    where: { id: referral.id, status: 'SIGNED_UP' },
    data: { status: 'SUBSCRIBED', rewardCents: REFERRAL_REWARD_SIGNUP_CENTS + REFERRAL_REWARD_PAID_CENTS, subscribedAt: new Date() },
  })
  if (claim.count === 0) return
  const invited = await db.user.findUnique({ where: { id: invitedUserId }, select: { email: true, name: true } })
  await addCredits(
    referral.referrerId,
    REFERRAL_REWARD_PAID_CENTS,
    'BONUS',
    `Referral reward, ${invited?.name || invited?.email || 'your invite'} subscribed 🎉`
  )
}
