import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stripLogoBackground } from '@/lib/logostrip'
import { logoPublicUrl } from '@/app/api/campaign-logo/route'

export const dynamic = 'force-dynamic'

/**
 * ONE-SHOT OPS DOOR (the Task 146/181/184/186/189 law, seventh lawful run):
 * the Ubuntu Wellness campaign's banner logo wore a white box on the ink
 * banner (the boss's screenshot), and the version under the state's current
 * url is cached by mail clients for a day. v5 truth, after four dry-runs:
 *   - the stored logo now on the account is a clean transparent-border RGBA
 *     upload (the account owner re-uploaded mid-task);
 *   - the state (platformConfig campaign_state:u-ubuntu-november-offer) still
 *     points at ?v=4hwe — the url that served the white-boxed bytes.
 * THE WRITE: strip the stored logo if (and only if) it carries an opaque flat
 * background, store the clean mark, and repoint the state's brand at a fresh
 * cache-busting url of the stored bytes — previews and the 522 still-queued
 * sends all re-read the state at render/send time. Backups + marker row first,
 * door deleted from the repo right after the run, tokens die with it.
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

/** The campaign state row — the brand the queue's mail actually wears.
 *  v3: the state row does NOT have to live on the Ubuntu account (the queue
 *  was created through an exec door, so the state may sit on the exec seat
 *  with ownerUserId pointing at the member). Look it up by KEY across all
 *  accounts and remember which row it is. */
async function campaignState(): Promise<{ state: Record<string, unknown> } | null> {
  // v4 TRUTH: campaign state lives in platformConfig (the global config store),
  // keyed campaign_state:<tag> — see src/lib/campaignqueue.ts line 12. Not a
  // userSetting row on any account.
  const row = await db.platformConfig.findUnique({ where: { key: STATE_KEY }, select: { value: true } })
  if (!row?.value) return null
  try {
    return { state: JSON.parse(row.value) as Record<string, unknown> }
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
  const found = await campaignState()
  const state = found?.state || null
  const brand = (state?.brand as Record<string, unknown> | undefined) || null
  const out: Record<string, unknown> = {
    userId,
    campaignTag: CAMPAIGN_TAG,
    hasState: !!state,
    campaignStatus: (state?.status as string) || null,
    ownerUserId: (state?.ownerUserId as string) || null,
    stateFrom: (state?.from as string) || null,
    brand: brand ? { name: brand.name || null, initials: brand.initials || null, logoUrl: brand.logoUrl || null } : null,
  }
  if (brand) {
    out.strip = await brandReport(brand)
  } else {
    out.note = state ? 'campaign state carries no brand object' : 'no campaign state row anywhere'
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
    const found = await campaignState()
    const state = found?.state || null
    const brand = (state?.brand as Record<string, unknown> | undefined) || null
    if (!found || !state || !brand) {
      return NextResponse.json({ wrote: false, error: 'campaign state or brand missing — nothing to fix' }, { status: 200 })
    }
    const logoUrl = typeof brand.logoUrl === 'string' ? brand.logoUrl : ''
    if (!logoUrl) {
      return NextResponse.json({ wrote: false, error: 'brand carries no logoUrl — nothing to fix' }, { status: 200 })
    }
    const stored = await storedLogo(acc.id)
    if (!stored) {
      return NextResponse.json({ wrote: false, error: 'no stored CAMPAIGN_LOGO behind the brand url — nothing to fix' }, { status: 200 })
    }
    const sm = stored.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
    if (!sm) {
      return NextResponse.json({ wrote: false, error: 'stored logo is not a recognised data url' }, { status: 200 })
    }
    const storedBytes = Buffer.from(sm[2], 'base64')
    // Strip ONLY when the stored logo actually carries an opaque flat
    // background (the white-boxed export the boss screenshotted). The current
    // upload already has a transparent border — the stripper honestly declines
    // and the stored bytes ride unchanged.
    let finalStored = stored
    let stripNote = 'not attempted'
    let strippedBytes: number | null = null
    const result = await stripLogoBackground(storedBytes)
    stripNote = result.note
    if (result.stripped && result.png) {
      finalStored = `data:image/png;base64,${result.png.toString('base64')}`
      strippedBytes = result.png.length
    }
    // Backups first: the exact state JSON plus the pre-fix stored logo.
    await db.userSetting.upsert({
      where: { userId_key: { userId: acc.id, key: BAK_KEY } },
      create: { userId: acc.id, key: BAK_KEY, value: JSON.stringify({ state, oldLogoUrl: logoUrl, oldStoredLogo: stored }) },
      update: { value: JSON.stringify({ state, oldLogoUrl: logoUrl, oldStoredLogo: stored }) },
    })
    // 1. The clean mark is what the account's hosted route serves.
    await db.userSetting.upsert({
      where: { userId_key: { userId: acc.id, key: KEY } },
      create: { userId: acc.id, key: KEY, value: finalStored },
      update: { value: finalStored },
    })
    // 2. The state's brand rides a FRESH cache-busting url of those bytes —
    //    the inbox caches that saw the white-boxed export under the old url
    //    get a miss and fetch the clean mark. Previews and still-queued sends
    //    both re-read the state at render/send time.
    const bust = logoPublicUrl(acc.id, finalStored) + `&r=${Date.now().toString(36)}`
    const newBrand = { ...brand, logoUrl: bust }
    const newState = { ...state, brand: newBrand }
    await db.platformConfig.update({
      where: { key: STATE_KEY },
      data: { value: JSON.stringify(newState) },
    })
    await db.userSetting.upsert({
      where: { userId_key: { userId: acc.id, key: MARK_KEY } },
      create: { userId: acc.id, key: MARK_KEY, value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    })
    return NextResponse.json({
      wrote: true,
      strippedApplied: !!strippedBytes,
      stripNote,
      storedBytesChanged: finalStored !== stored,
      oldLogoUrl: logoUrl,
      newLogoUrl: newBrand.logoUrl,
      backupKey: BAK_KEY,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'door error' }, { status: 200 })
  }
}
