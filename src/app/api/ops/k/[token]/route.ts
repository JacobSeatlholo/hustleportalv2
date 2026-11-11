import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stripLogoBackground } from '@/lib/logostrip'
import { logoPublicUrl } from '@/app/api/campaign-logo/route'

export const dynamic = 'force-dynamic'

/**
 * ONE-SHOT OPS DOOR (the Task 146/181/184/186/189 law, seventh lawful run):
 * the Ubuntu Wellness account's stored campaign logo carries its white
 * background baked in, and on the ink banner it reads as a cheap white box.
 * The upload route now strips white backgrounds for every FUTURE upload, but
 * the stored logo predates the law — this door fixes the stored one.
 *
 * GET  → DRY RUN, writes nothing: resolves the account, reads the stored
 *        logo, runs the exact stripLogoBackground the upload route uses, and
 *        returns the report plus the processed PNG (base64) so the result can
 *        be eyeballed on the dark banner before anything is committed.
 * POST → THE WRITE: backs up the original to CAMPAIGN_LOGO_PRESTRIP_BAK,
 *        stores the stripped PNG under CAMPAIGN_LOGO, drops a marker row.
 *        A second POST finds the marker and refuses — one run, like every
 *        door before it. The door file is deleted from the repo right after
 *        the run, tokens die with it.
 *
 * The account is hard-baked to support@ubuntuwellness.com — no other row can
 * be touched by this door, and nothing else on it changes.
 */

const TOKEN = '71e830ce342862edb5e59e570b005f836236253adfb792c1'
const ACCOUNT_EMAIL = 'support@ubuntuwellness.com'
const KEY = 'CAMPAIGN_LOGO'
const BAK_KEY = 'CAMPAIGN_LOGO_PRESTRIP_BAK'
const MARK_KEY = 'OPS_MARK_ubuntu_logo_strip_2026_11'

type Step = { params: Promise<{ token: string }> }

async function account() {
  return db.user.findFirst({
    where: { email: ACCOUNT_EMAIL },
    select: { id: true, email: true, businessName: true },
  })
}

async function storedLogo(userId: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: KEY } },
    select: { value: true },
  })
  return row?.value || null
}

async function report(userId: string, write: boolean) {
  const stored = await storedLogo(userId)
  if (!stored) {
    return { userId, hasLogo: false, note: 'no stored logo — nothing to strip' }
  }
  const m = stored.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return { userId, hasLogo: false, note: `stored value is not a recognised image data URL (${stored.slice(0, 24)}...)` }
  const bytes = Buffer.from(m[2], 'base64')
  const result = await stripLogoBackground(bytes)
  const out: Record<string, unknown> = {
    userId,
    accountEmail: ACCOUNT_EMAIL,
    hasLogo: true,
    storedType: m[1],
    storedBytes: bytes.length,
    storedDataUrlLength: stored.length,
    stripped: result.stripped,
    stripNote: result.note,
    resultBytes: result.png?.length ?? null,
  }
  if (result.stripped && result.png) {
    out.afterBase64 = result.png.toString('base64')
    out.newDataUrlLength = `data:image/png;base64,${result.png.toString('base64')}`.length
  }
  if (write) out.wouldWrite = true
  return out
}

export async function GET(_req: NextRequest, { params }: Step) {
  const { token } = await params
  if (token !== TOKEN) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const acc = await account()
    if (!acc) return NextResponse.json({ error: `no account for ${ACCOUNT_EMAIL}` }, { status: 200 })
    const rep = await report(acc.id, false)
    const mark = await db.userSetting.findUnique({ where: { userId_key: { userId: acc.id, key: MARK_KEY } } })
    return NextResponse.json({ ...rep, alreadyMarked: !!mark })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'door error' }, { status: 200 })
  }
}

export async function POST(_req: NextRequest, { params }: Step) {
  const { token } = await params
  if (token !== TOKEN) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const acc = await account()
    if (!acc) return NextResponse.json({ error: `no account for ${ACCOUNT_EMAIL}` }, { status: 200 })
    const mark = await db.userSetting.findUnique({ where: { userId_key: { userId: acc.id, key: MARK_KEY } } })
    if (mark) {
      return NextResponse.json({ locked: true, note: 'marker row exists — this door already ran once', markedAt: mark.value })
    }
    const stored = await storedLogo(acc.id)
    if (!stored) return NextResponse.json({ error: 'no stored logo — nothing to strip' }, { status: 200 })
    const m = stored.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
    if (!m) return NextResponse.json({ error: 'stored value is not a recognised image data URL' }, { status: 200 })
    const bytes = Buffer.from(m[2], 'base64')
    const result = await stripLogoBackground(bytes)
    if (!result.stripped || !result.png) {
      return NextResponse.json({ wrote: false, stripNote: result.note, note: 'strip declined — stored logo left untouched' }, { status: 200 })
    }
    const dataUrl = `data:image/png;base64,${result.png.toString('base64')}`
    await db.userSetting.upsert({
      where: { userId_key: { userId: acc.id, key: BAK_KEY } },
      create: { userId: acc.id, key: BAK_KEY, value: stored },
      update: { value: stored },
    })
    await db.userSetting.upsert({
      where: { userId_key: { userId: acc.id, key: KEY } },
      create: { userId: acc.id, key: KEY, value: dataUrl },
      update: { value: dataUrl },
    })
    await db.userSetting.upsert({
      where: { userId_key: { userId: acc.id, key: MARK_KEY } },
      create: { userId: acc.id, key: MARK_KEY, value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    })
    return NextResponse.json({
      wrote: true,
      beforeBytes: bytes.length,
      afterBytes: result.png.length,
      stripNote: result.note,
      backupKey: BAK_KEY,
      logoUrl: logoPublicUrl(acc.id, dataUrl),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'door error' }, { status: 200 })
  }
}
