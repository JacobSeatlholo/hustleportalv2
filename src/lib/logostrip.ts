/**
 * The white-box killer — campaign logos arrive with their background baked in.
 *
 * A member uploads the logo their designer exported: a great mark sitting on a
 * flat white rectangle. In the email banner (ink band) that rectangle renders
 * as a white box — cheap, lazy, exactly the look the boss refused. Gmail and
 * Outlook render transparent PNGs perfectly, so the fix is to strip the flat
 * near-white background and hand every banner a clean transparent PNG.
 *
 * Algorithm (conservative by design):
 *  1. Decode to raw RGBA (sharp — already in the dependency tree).
 *  2. Look at the BORDER ring. A logo-on-white has a near-white border; a logo
 *     designed on colour does not. If the border is not predominantly
 *     near-white, the image is left untouched — nobody's brand gets rewritten.
 *  3. Flood-fill from the border across near-white pixels only (BFS, 4-way).
 *     White INSIDE the mark (an enclosed counter, a snowflake's middle) is
 *     never reached, so it stays exactly as the designer drew it.
 *  4. One halo pass: pixels adjacent to the stripped area that are ALMOST
 *     white (anti-aliased JPEG edges) join the transparent zone, so no grey
 *     fringe rides the mark onto the dark banner.
 *  5. Trim transparent margins (the mark fills its 40px slot, not float in
 *     padding), cap the size, re-encode as a compact PNG.
 *
 * Pure module: buffer in, result out, no db, no env — the upload route, the
 * ops door and the local QA scripts all run the exact same code.
 */
import sharp from 'sharp'

export interface StripResult {
  /** true when the border was near-white and the background was stripped. */
  stripped: boolean
  /** The processed PNG when stripped, null when left untouched. */
  png: Buffer | null
  width: number
  height: number
  /** Share of pixels that ended up fully transparent (0..1), post-trim. */
  transparentPct: number
  /** One-line human note for logs and the ops report. */
  note: string
}

const DEFAULT_TOL = 28 // 255-28 = 227: catches #F7F7F7-class whites + JPEG noise, never a cream brand colour (#FFFDF7 sits at 253/253/247 → dist 8, would strip — but that IS the white we are killing)
const MAX_BYTES = 290_000 // stays under the storage law's 300 KB
const MAX_W = 640 // renders at height 40 in the banner; 640w is generous retina headroom
const MAX_H = 320

/** A pixel is "near-white" when every channel is within tol of 255. */
function isNearWhite(r: number, g: number, b: number, tol: number): boolean {
  return r >= 255 - tol && g >= 255 - tol && b >= 255 - tol
}

export async function stripLogoBackground(
  buf: Buffer,
  opts: { tol?: number } = {},
): Promise<StripResult> {
  const tol = opts.tol ?? DEFAULT_TOL
  let img = sharp(buf, { failOn: 'none' }).ensureAlpha()
  const meta = await img.metadata().catch(() => null)
  if (!meta || !meta.width || !meta.height || meta.width < 8 || meta.height < 8) {
    return { stripped: false, png: null, width: 0, height: 0, transparentPct: 0, note: 'not a usable raster image' }
  }
  const w = meta.width
  const h = meta.height
  const raw = await img.raw().toBuffer() // w*h*4

  const at = (x: number, y: number) => (y * w + x) * 4

  // --- Step 1: is the border predominantly near-white? ---
  let borderTotal = 0
  let borderWhite = 0
  const check = (x: number, y: number) => {
    const i = at(x, y)
    borderTotal++
    if (isNearWhite(raw[i], raw[i + 1], raw[i + 2], tol)) borderWhite++
  }
  for (let x = 0; x < w; x++) {
    check(x, 0)
    check(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    check(0, y)
    check(w - 1, y)
  }
  const borderShare = borderWhite / borderTotal
  if (borderShare < 0.55) {
    return {
      stripped: false,
      png: null,
      width: w,
      height: h,
      transparentPct: 0,
      note: `border is only ${Math.round(borderShare * 100)}% white — logo designed on colour, left untouched`,
    }
  }

  // --- Step 2: flood-fill the background from every near-white border pixel ---
  const visited = new Uint8Array(w * h)
  const stack: number[] = []
  const pushIfWhite = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const p = y * w + x
    if (visited[p]) return
    const i = p * 4
    if (!isNearWhite(raw[i], raw[i + 1], raw[i + 2], tol)) return
    visited[p] = 1
    stack.push(p)
  }
  for (let x = 0; x < w; x++) {
    pushIfWhite(x, 0)
    pushIfWhite(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    pushIfWhite(0, y)
    pushIfWhite(w - 1, y)
  }
  while (stack.length) {
    const p = stack.pop() as number
    const x = p % w
    const y = (p - x) / w
    pushIfWhite(x + 1, y)
    pushIfWhite(x - 1, y)
    pushIfWhite(x, y + 1)
    pushIfWhite(x, y - 1)
  }

  // --- Step 3: halo pass — anti-aliased fringe joins the transparent zone ---
  // Two gentle rounds: any unvisited pixel with a whiteDist under tol*2 that
  // touches a stripped pixel becomes transparent too. Kills the grey ring.
  const whiteDist = (p: number) => {
    const i = p * 4
    return 255 - Math.min(raw[i], raw[i + 1], raw[i + 2])
  }
  for (let round = 0; round < 2; round++) {
    const joins: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (visited[p]) continue
        if (whiteDist(p) > tol * 2) continue
        const touches =
          (x > 0 && visited[p - 1]) ||
          (x < w - 1 && visited[p + 1]) ||
          (y > 0 && visited[p - w]) ||
          (y < h - 1 && visited[p + w])
        if (touches) joins.push(p)
      }
    }
    if (joins.length === 0) break
    for (const p of joins) visited[p] = 1
  }

  // --- Step 4: write alpha and trim to the mark's bounding box ---
  let strippedCount = 0
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    if (visited[p]) {
      raw[i + 3] = 0
      strippedCount++
    } else {
      const x = p % w
      const y = (p - x) / w
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0 || strippedCount >= w * h * 0.98) {
    return { stripped: false, png: null, width: w, height: h, transparentPct: 0, note: 'image would vanish — left untouched' }
  }
  const cw = maxX - minX + 1
  const ch = maxY - minY + 1

  let out = sharp(raw, { raw: { width: w, height: h, channels: 4 } }).extract({ left: minX, top: minY, width: cw, height: ch })
  if (cw > MAX_W || ch > MAX_H) {
    out = out.resize(MAX_W, MAX_H, { fit: 'inside', withoutEnlargement: true })
  }
  let png = await out.png({ compressionLevel: 9 }).toBuffer()
  // The 300 KB storage law: shrink until it fits, or hand the original back.
  let scale = 1
  while (png.length > MAX_BYTES && scale > 0.3) {
    scale *= 0.8
    png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: minX, top: minY, width: cw, height: ch })
      .resize(Math.max(24, Math.round(cw * scale)), Math.max(24, Math.round(ch * scale)), { fit: 'inside' })
      .png({ compressionLevel: 9 })
      .toBuffer()
  }
  if (png.length > MAX_BYTES) {
    return { stripped: false, png: null, width: w, height: h, transparentPct: 0, note: 'stripped png would break the size cap — left untouched' }
  }

  const finalMeta = await sharp(png).metadata()
  return {
    stripped: true,
    png,
    width: finalMeta.width || cw,
    height: finalMeta.height || ch,
    transparentPct: strippedCount / (w * h), // honest share of the original frame
    note: `background stripped (${Math.round((strippedCount / (w * h)) * 100)}% of frame transparent), trimmed ${w}x${h} → ${finalMeta.width}x${finalMeta.height}`,
  }
}
