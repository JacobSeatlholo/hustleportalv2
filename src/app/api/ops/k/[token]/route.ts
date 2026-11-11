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
const CAMPAIGN_TAG = 'u-ubuntu-november-offer'
const STATE_KEY = `campaign_state:${CAMPAIGN_TAG}`
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

/** The campaign state row — the brand the queue's mail actually wears. */
async function campaignState(userId: string): Promise<Record<string, unknown> | null> {
  const row = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: STATE_KEY } },
    select: { value: true },
  })
  if (!row?.value) return null
  try {
    return JSON.parse(row.value) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Fetch the bytes behind a brand logoUrl: site-relative /api/... against the
 *  site base, or an absolute https url. Returns null when unfetchable. */
async function logoBytesFromUrl(url: string): Promise<{ buf: Buffer; type: string } | null> {
  const full = url.startsWith('/') ? `https://www.hustleportal.online${url}` : url
  if (!/^https:\/\//i.test(full)) return null
  try {
    const res = await fetch(full, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const type = res.headers.get('content-type') || 'image/png'
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > 2_000_000) return null
    return { buf, type }
  } catch {
    return null
  }
}

/** The report for one brand: strip it, return the processed png for eyeballing. */
async function brandReport(brand: Record<string, unknown>) {
  const logoUrl = typeof brand.logoUrl === 'string' ? brand.logoUrl : ''
  if (!logoUrl) return { hasLogoUrl: false, note: 'brand carries no logoUrl — the mail wears initials/name only' }
  const fetched = await logoBytesFromUrl(logoUrl)
  if (!fetched) return { hasLogoUrl: true, logoUrl, note: 'logoUrl unfetchable from this door' }
  const result = await stripLogoBackground(fetched.buf)
  return {
    hasLogoUrl: true,
    logoUrl,
    fetchedType: fetched.type,
    fetchedBytes: fetched.buf.length,
    stripped: result.stripped,
    stripNote: result.note,
    resultBytes: result.png?.length ?? null,
    width: result.width,
    height: result.height,
    transparentPct: result.transparentPct,
    ...(result.stripped && result.png ? { afterBase64: result.png.toString('base64') } : {}),
  }
}

/**
 * v2: the first dry-run showed the account has NO stored CAMPAIGN_LOGO — the
 * white-boxed logo rides the campaign STATE instead
 * (userSetting campaign_state:u-ubuntu-november-offer, brand.logoUrl). The
 * door now reads the state, fetches the logo behind its url, strips it, and
 * the write stores the stripped PNG as the account's CAMPAIGN_LOGO and points
 * the state's brand at the hosted route — previews AND still-queued sends
 * both read the brand from state at render/send time, so one state edit
 * re-skins the whole queue.
 */

async function report(userId: string) {
  const state = await campaignState(userId)
  const brand = (state?.brand as Record<string, unknown> | undefined) || null
  const out: Record<string, unknown> = {
    userId,
    campaignTag: CAMPAIGN_TAG,
    hasState: !!state,
    campaignStatus: (state?.status as string) || null,
    brand: brand ? { name: brand.name || null, initials: brand.initials || null, logoUrl: brand.logoUrl || null } : null,
  }
  if (brand) {
    out.strip = await brandReport(brand)
  } else {
    out.note = state ? 'campaign state carries no brand object' : 'no campaign state row'
  }
  return out
}

export async function GET(_req: NextRequest, { params }: Step) {
  const { token } = await params
  if (token !== TOKEN) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const acc = await account()
    if (!acc) return NextResponse.json({ error: `no account for ${ACCOUNT_EMAIL}` }, { status: 200 })
    const rep = await report(acc.id)
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
    const state = await campaignState(acc.id)
    const brand = (state?.brand as Record<string, unknown> | undefined) || null
    if (!state || !brand) {
      return NextResponse.json({ wrote: false, error: 'campaign state or brand missing — nothing to fix' }, { status: 200 })
    }
    const logoUrl = typeof brand.logoUrl === 'string' ? brand.logoUrl : ''
    if (!logoUrl) {
      return NextResponse.json({ wrote: false, error: 'brand carries no logoUrl — nothing to strip' }, { status: 200 })
    }
    const fetched = await logoBytesFromUrl(logoUrl)
    if (!fetched) {
      return NextResponse.json({ wrote: false, error: `could not fetch the logo behind ${logoUrl}` }, { status: 200 })
    }
    const result = await stripLogoBackground(fetched.buf)
    if (!result.stripped || !result.png) {
      return NextResponse.json({ wrote: false, stripNote: result.note, note: 'strip declined — logo left untouched' }, { status: 200 })
    }
    const dataUrl = `data:image/png;base64,${result.png.toString('base64')}`
    // Backups first: the exact state JSON and the current logo bytes behind
    // the old url (fetched already — keep them).
    await db.userSetting.upsert({
      where: { userId_key: { userId: acc.id, key: BAK_KEY } },
      create: { userId: acc.id, key: BAK_KEY, value: JSON.stringify({ state, oldLogoUrl: logoUrl, oldLogoBase64: fetched.buf.toString('base64') }) },
      update: { value: JSON.stringify({ state, oldLogoUrl: logoUrl, oldLogoBase64: fetched.buf.toString('base64') }) },
    })
    // 1. The stripped mark becomes the account's hosted campaign logo.
    await db.userSetting.upsert({
      where: { userId_key: { userId: acc.id, key: KEY } },
      create: { userId: acc.id, key: KEY, value: dataUrl },
      update: { value: dataUrl },
    })
    // 2. The state's brand points at the hosted route — site-relative, resolved
    //    against the asset base at render time. Previews and queued sends both
    //    re-read this at render/send time.
    const newBrand = { ...brand, logoUrl: `/api/campaign-logo/${acc.id}` }
    const newState = { ...state, brand: newBrand }
    await db.userSetting.update({
      where: { userId_key: { userId: acc.id, key: STATE_KEY } },
      data: { value: JSON.stringify(newState) },
    })
    await db.userSetting.upsert({
      where: { userId_key: { userId: acc.id, key: MARK_KEY } },
      create: { userId: acc.id, key: MARK_KEY, value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    })
    return NextResponse.json({
      wrote: true,
      oldLogoUrl: logoUrl,
      newLogoUrl: newBrand.logoUrl,
      beforeBytes: fetched.buf.length,
      afterBytes: result.png.length,
      stripNote: result.note,
      backupKey: BAK_KEY,
      logoUrl: logoPublicUrl(acc.id, dataUrl),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'door error' }, { status: 200 })
  }
}
