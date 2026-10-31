/**
 * Photo polish: the free, on device cleanup for product photos.
 *
 * Everything here runs in the browser. The photo only leaves the phone when
 * the user saves the listing, and the background cut (opt in) fetches a small
 * open model once and caches it in the browser; after that it works offline.
 * The laws of the module:
 *   1. Real photos stay real. Levels, tone and sharpening move pixels that
 *      were already there; nothing is invented, no AI repaints the product.
 *   2. Every step is best effort. If the background cut fails or times out
 *      the caller gets null and the photo keeps its original background.
 *   3. The output is a small square JPEG data URL the inventory row can carry,
 *      same size budget the stock table always had.
 */

/** Decode a File into an image element through an object URL. */
async function fileToImage(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('decode'))
      im.src = url
    })
  } finally {
    // The image decodes fully before the promise resolves; revoking now is safe.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * Cover crop to a square with a slight top bias: products are usually shot a
 * little from above, so the crop keeps more of the top than the bottom.
 */
function drawCoverSquare(src: HTMLImageElement, side: number): HTMLCanvasElement {
  const sw = src.naturalWidth || src.width
  const sh = src.naturalHeight || src.height
  const edge = Math.min(sw, sh)
  const sx = (sw - edge) / 2
  const sy = (sh - edge) * 0.35
  const c = makeCanvas(side, side)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(src, sx, sy, edge, edge, 0, 0, side, side)
  return c
}

/**
 * Auto levels: stretch the picture over its full range using a luminance
 * histogram, the same move every camera app makes. A flat or already full
 * range picture is left alone, so clean photos pass through untouched.
 */
function autoLevels(c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d')
  if (!ctx) return
  const w = c.width
  const h = c.height
  const im = ctx.getImageData(0, 0, w, h)
  const d = im.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const l = ((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000) | 0
    hist[l]++
  }
  const cut = Math.max(1, Math.floor(w * h * 0.004))
  let acc = 0
  let lo = 0
  let hi = 255
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break } }
  if (hi - lo < 16 || hi - lo > 250) return
  const scale = 255 / (hi - lo)
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, (v - lo) * scale))
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]]
    d[i + 1] = lut[d[i + 1]]
    d[i + 2] = lut[d[i + 2]]
  }
  ctx.putImageData(im, 0, 0)
}

/** Gentle tone pass: a little saturation, contrast and brightness. */
function tonePass(c: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = c.getContext('2d')
  if (!ctx || !('filter' in ctx)) return c // old browsers keep the levels pass only
  const t = makeCanvas(c.width, c.height)
  const tc = t.getContext('2d')
  if (!tc) return c
  tc.filter = 'saturate(1.1) contrast(1.06) brightness(1.02)'
  tc.drawImage(c, 0, 0)
  return t
}

/**
 * Light unsharp mask: the classic sharpen kernel blended 55 percent over the
 * original, enough to crisp a phone photo without halos around edges.
 */
function sharpen(c: HTMLCanvasElement, blend = 0.55): void {
  const ctx = c.getContext('2d')
  if (!ctx) return
  const w = c.width
  const h = c.height
  const im = ctx.getImageData(0, 0, w, h)
  const d = im.data
  const src = new Uint8ClampedArray(d)
  const stride = w * 4
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * stride + x * 4
      for (let ch = 0; ch < 3; ch++) {
        const p = i + ch
        const lap = 5 * src[p] - src[p - 4] - src[p + 4] - src[p - stride] - src[p + stride]
        d[p] = src[p] + (lap - src[p]) * blend
      }
    }
  }
  ctx.putImageData(im, 0, 0)
}

/** Warm studio paper backdrop the cut out subject lands on. */
function withBackdrop(subject: HTMLCanvasElement, side: number): HTMLCanvasElement {
  const out = makeCanvas(side, side)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('canvas')
  const g = ctx.createLinearGradient(0, 0, 0, side)
  g.addColorStop(0, '#fbf9f5')
  g.addColorStop(1, '#e7e1d6')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, side, side)
  const pad = Math.round(side * 0.08)
  const box = side - pad * 2
  const scale = Math.min(box / subject.width, box / subject.height)
  const w = Math.round(subject.width * scale)
  const h = Math.round(subject.height * scale)
  ctx.drawImage(subject, (side - w) / 2, (side - h) / 2, w, h)
  return out
}

/**
 * The cut out background, opt in because the model is a one time download.
 * Uses the smallest open model (a few megabytes, cached by the browser after
 * the first use). Returns null on any failure or after two minutes, and the
 * caller falls back to the untouched photo.
 */
export async function fetchCutout(file: File): Promise<Blob | null> {
  try {
    const { removeBackground } = await import('@imgly/background-removal')
    const job = removeBackground(file, { model: 'isnet_quint8' })
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 120_000))
    return await Promise.race([job, timeout])
  } catch {
    return null
  }
}

/**
 * File in, small square data URL out. polish=false keeps the plain downscale
 * the stock table always did, so the user can have the original back.
 */
export async function photoToDataUrl(
  file: File,
  opts: { polish?: boolean; cutout?: Blob | null } = {},
): Promise<string> {
  const { polish = true, cutout = null } = opts
  const img = await fileToImage(file)
  const side = 512

  let final: HTMLCanvasElement
  const cutImg = cutout ? await fileToImage(cutout).catch(() => null) : null
  if (cutImg) {
    // Same square crop math keeps the cut out aligned with the source photo.
    const subject = drawCoverSquare(cutImg, side)
    autoLevels(subject)
    sharpen(subject)
    final = withBackdrop(tonePass(subject), side)
  } else if (polish) {
    const work = drawCoverSquare(img, side)
    autoLevels(work)
    sharpen(tonePass(work))
    final = work
  } else {
    final = drawCoverSquare(img, side)
  }

  const out = makeCanvas(256, 256)
  const octx = out.getContext('2d')
  if (!octx) throw new Error('canvas')
  octx.drawImage(final, 0, 0, 256, 256)
  const dataUrl = out.toDataURL('image/jpeg', 0.82)
  if (dataUrl.length > 160_000) throw new Error('size')
  return dataUrl
}
