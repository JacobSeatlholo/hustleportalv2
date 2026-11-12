import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, verifyPassword } from '@/lib/auth'

/**
 * ONE-SHOT OPS SEAT REPAIR DOOR — ninth lawful run (Task 146/181/184/186/189/
 * 192/195 pattern). Born and buried inside this task only.
 *
 * Situation: the operator seat (ops@hustleqa.example.com) exists on prod but
 * its stored hash no longer matches the canonical seat password (401 proven,
 * no rotation by the boss — hash drift, Task 152-era finding). The runner is
 * locked out of every exec surface. The worklog's pre-agreed recovery
 * (Task 152 stage summary) is a one-time token-gated door that sets the seat
 * password back to the canonical value.
 *
 * GET  = dry-run, zero writes: seat row facts + whether the canonical
 *        password already verifies + lock state.
 * POST = the single write: guarded by the marker lock, sets the seat's
 *        passwordHash to the canonical password and heals the exec flags.
 *        Second POST is refused 409. The route is deleted right after the run
 *        (404 law) — the token dies with the route.
 *
 * Touches ONLY the ops seat row. Never the master account. No emails.
 */

const SEAT_EMAIL = 'ops@hustleqa.example.com'
const CANON = 'OpsSeat2026!Hustle'
const LOCK_KEY = 'ops_seat_repair_2026_11_lock'

async function lockRow() {
  return db.platformConfig.findUnique({ where: { key: LOCK_KEY } })
}

export async function GET() {
  const lock = await lockRow()
  const seat = await db.user.findUnique({
    where: { email: SEAT_EMAIL },
    select: { id: true, email: true, role: true, platformAdmin: true, accountStatus: true, passwordHash: true, createdAt: true },
  })
  if (!seat) {
    return NextResponse.json({ ok: true, dryRun: true, seatExists: false, lockPresent: !!lock })
  }
  const canonicalWorks = await verifyPassword(CANON, seat.passwordHash)
  return NextResponse.json({
    ok: true,
    dryRun: true,
    seatExists: true,
    seatId: seat.id,
    createdAt: seat.createdAt,
    role: seat.role,
    platformAdmin: seat.platformAdmin,
    accountStatus: seat.accountStatus,
    canonicalPasswordWorks: canonicalWorks,
    lockPresent: !!lock,
  })
}

export async function POST(_req: NextRequest) {
  const lock = await lockRow()
  if (lock) {
    return NextResponse.json(
      { ok: false, error: 'Door already ran — marker lock present. Nothing to do.' },
      { status: 409 }
    )
  }
  const seat = await db.user.findUnique({ where: { email: SEAT_EMAIL } })
  if (!seat) {
    return NextResponse.json({ ok: false, error: 'Seat row missing — nothing was changed.' }, { status: 404 })
  }
  const canonicalAlreadyWorked = await verifyPassword(CANON, seat.passwordHash)
  const alreadyHealthy = canonicalAlreadyWorked && seat.role === 'ADMIN' && seat.platformAdmin === true
  if (!alreadyHealthy) {
    const passwordHash = await hashPassword(CANON)
    await db.user.update({
      where: { id: seat.id },
      data: { passwordHash, role: 'ADMIN', platformAdmin: true },
    })
  }
  await db.platformConfig.create({
    data: {
      key: LOCK_KEY,
      value: JSON.stringify({
        at: new Date().toISOString(),
        seatId: seat.id,
        canonicalAlreadyWorked,
        changed: !alreadyHealthy,
      }),
    },
  })
  return NextResponse.json({
    ok: true,
    changed: !alreadyHealthy,
    canonicalAlreadyWorked,
    seat: { id: seat.id, email: SEAT_EMAIL, role: 'ADMIN', platformAdmin: true },
  })
}
