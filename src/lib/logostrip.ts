/**
 * The white-box killer — campaign logos arrive with their background baked in.
 *
 * A member uploads the logo their designer exported: a great mark sitting on a
 * flat background rectangle (white, black — whatever the export gave them).
 * On the email banner that rectangle reads as a cheap box — exactly the look
 * the boss refused. Gmail and Outlook render transparent PNGs perfectly, so
 * the fix is to strip the flat background and hand every banner a clean
 * transparent PNG.
 *
 * Algorithm (conservative by design):
 *  1. Decode to raw RGBA (sharp — already in the dependency tree).
 *  2. Look at the BORDER ring and take its per-channel MEDIAN colour. If the
 *     border is not predominantly near that one colour, the image is left
 *     untouched — nobody's brand gets rewritten. (A logo designed on a photo,
 *     a gradient or a coloured panel keeps its background; a flat white or
 *     black export gets cleaned.)
 *  3. Flood-fill from the border across pixels near that colour only (BFS,
 *     4-way). Colour INSIDE the mark (an enclosed counter, a snowflake's
 *     middle) is never reached, so it stays exactly as the designer drew it.
 *  4. One halo pass: pixels adjacent to the stripped area that are ALMOST the
 *     background colour (anti-aliased edges) join the transparent zone, so no
 *     fringe rides the mark onto the banner.
 *  5. Trim transparent margins (the mark fills its 40px slot instead of
 *     floating in padding), cap the size, re-encode as a compact PNG.
 *
 * Pure module: buffer in, result out, no db, no env — the upload route, the
 * ops door and the local QA scripts all run the exact same code.
 */
import sharp from 'sharp'

export interface StripResult {
  /** true when the border was flat and the background was stripped. */
  stripped: boolean
  /** The processed PNG when stripped, null when left untouched. */
  png: Buffer | null
  width: number
  height: number
  /** Share of pixels that ended up fully transparent (0..1). */
  transparentPct: number
  /** One-line human note for logs and the ops report. */
  note: string
}

const DEFAULT_TOL = 28 // per-channel distance from the background colour: catches off-whites + JPEG noise, never a real brand colour
const MAX_BYTES = 290_000 // stays under the storage law's 300 KB
const MAX_W = 640 // renders at height 40 in the banner; 640w is generous retina headroom
const MAX_H = 320

/** Per-channel distance between two colours (Chebyshev — every channel must
 *  be close, so a grey can never masquerade as black nor cream as white). */
function colourDist(r: number, g: number, b: number, c: [number, number, number]): number {
  return Math.max(Math.abs(r - c[0]), Math.abs(g - c[1]), Math.abs(b - c[2]))
}

function median3(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export async function stripLogoBackground(
  buf: Buffer,
  opts: { tol?: number } = {},
): Promise<StripResult> {
  const tol = opts.tol ?? DEFAULT_TOL
  const img = sharp(buf, { failOn: 'none' }).ensureAlpha()
  const meta = await img.metadata().catch(() => null)
  if (!meta || !meta.width || !meta.height || meta.width < 8 || meta.height < 8) {
    return { stripped: false, png: null, width: 0, height: 0, transparentPct: 0, note: 'not a usable raster image' }
  }
  const w = meta.width
  const h = meta.height
  const raw = await img.raw().toBuffer() // w*h*4

  const at = (x: number, y: number) => (y * w + x) * 4

  // --- Step 1: the border ring decides the background colour ---
  // Fully transparent border pixels are ignored: a logo already exported with
  // transparency must pass through untouched (and its (0,0,0) rgb husk must
  // never read as a "flat black background").
  const br: number[] = []
  const bg: number[] = []
  const bb: number[] = []
  let opaqueBorder = 0
  let borderTotal = 0
  const sample = (x: number, y: number) => {
    const i = at(x, y)
    borderTotal++
    if (raw[i + 3] < 128) return
    opaqueBorder++
    br.push(raw[i])
    bg.push(raw[i + 1])
    bb.push(raw[i + 2])
  }
  for (let x = 0; x < w; x++) {
    sample(x, 0)
    sample(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    sample(0, y)
    sample(w - 1, y)
  }
  if (opaqueBorder < borderTotal * 0.3) {
    return { stripped: false, png: null, width: w, height: h, transparentPct: 0, note: 'border already transparent — logo left untouched' }
  }
  const bgColour: [number, number, number] = [median3(br), median3(bg), median3(bb)]
  let borderMatch = 0
  for (let i = 0; i < br.length; i++) {
    if (colourDist(br[i], bg[i], bb[i], bgColour) <= tol) borderMatch++
  }
  const borderShare = borderMatch / br.length
  if (borderShare < 0.55) {
    return {
      stripped: false,
      png: null,
      width: w,
      height: h,
      transparentPct: 0,
      note: `border is only ${Math.round(borderShare * 100)}% uniform (${bgColour.join(',')}) — no flat background to strip`,
    }
  }

  // --- Step 2: flood-fill the background from every matching border pixel ---
  const visited = new Uint8Array(w * h)
  const stack: number[] = []
  const pushIfBg = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const p = y * w + x
    if (visited[p]) return
    const i = p * 4
    if (raw[i + 3] < 128) return // transparent gaps never bridge the fill into the mark
    if (colourDist(raw[i], raw[i + 1], raw[i + 2], bgColour) > tol) return
    visited[p] = 1
    stack.push(p)
  }
  for (let x = 0; x < w; x++) {
    pushIfBg(x, 0)
    pushIfBg(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    pushIfBg(0, y)
    pushIfBg(w - 1, y)
  }
  while (stack.length) {
    const p = stack.pop() as number
    const x = p % w
    const y = (p - x) / w
    pushIfBg(x + 1, y)
    pushIfBg(x - 1, y)
    pushIfBg(x, y + 1)
    pushIfBg(x, y - 1)
  }

  // --- Step 3: halo pass — anti-aliased fringe joins the transparent zone ---
  // Two gentle rounds: any unvisited pixel within tol*2 of the background
  // colour that touches a stripped pixel becomes transparent too. Kills the
  // light ring on white exports and the dark ring on black ones.
  for (let round = 0; round < 2; round++) {
    const joins: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (visited[p]) continue
        const i = p * 4
        if (raw[i + 3] < 128) continue
        if (colourDist(raw[i], raw[i + 1], raw[i + 2], bgColour) > tol * 2) continue
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
    note: `flat background (${bgColour.join(',')}) stripped, ${Math.round((strippedCount / (w * h)) * 100)}% of frame transparent, trimmed ${w}x${h} → ${finalMeta.width}x${finalMeta.height}`,
  }
}
