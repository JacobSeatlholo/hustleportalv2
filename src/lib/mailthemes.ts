/**
 * Email theme engine — the "PostHog look" for HustlePortal mail.
 *
 * Every platform email (campaign lane and system lane) renders the same body
 * content through one of a few branded chrome looks: a dark banner with the
 * BH mark, a full-width illustrated hero with our honey badger mascot, a bold
 * caps accent headline, a bulletproof CTA button and a quiet legal footer.
 * The grammar is the one PostHog nailed: banner -> illustration -> headline ->
 * clean white body. The character and palette are ours: gold #f5c518, ink,
 * navy, and a honey badger who does not quit.
 *
 * Rules of the road:
 *  - Pure functions, no db, no env — same unit-testable convention as
 *    campaignhtml.ts, which owns the body text rendering (renderTextBlocks).
 *  - Email-client safe: nested tables, inline styles only, 600px card,
 *    bulletproof button, images are hosted JPEG/PNGs (SVG is refused by
 *    Outlook/Gmail), every image carries alt text and a sized cell background
 *    so the layout holds even before images load.
 *  - 'plain' is the legacy unbranded look and stays byte-compatible with the
 *    old campaignHtml output — an escape hatch, not the default.
 *  - The mascot and the banner live on the app domain
 *    (/email/mascot-*.jpg, /brand/band.png) so they ride the same CDN the
 *    platform already serves.
 */

import { renderTextBlocks } from './campaignhtml'

export type MailThemeId = 'boardroom' | 'goldrush' | 'nightshift' | 'plain'

/** Where the brand images live in production. */
export const MAIL_ASSET_BASE = 'https://www.hustleportal.online'

interface MailTheme {
  id: MailThemeId
  /** Human label, for the exec dashboard picker. */
  label: string
  /** One line: what this look is for. */
  blurb: string
  pageBg: string
  cardBg: string
  bannerBg: string
  wordmark: string
  chipBg: string
  chipText: string
  /** 4px brand strip under the banner. */
  strip: string
  /** Accent caps headline + emphasis color. */
  accent: string
  link: string
  text: string
  muted: string
  buttonBg: string
  buttonText: string
  /** Soft tinted box behind big values (codes, amounts). */
  softBox: string
  radius: number
  hero?: { src: string; alt: string; bg: string }
  /** Decorative brand band above the footer. */
  band: boolean
}

const INK = '#14161B'
const GOLD = '#f5c518'
const NAVY = '#16305C'

export const THEMES: Record<Exclude<MailThemeId, 'plain'>, MailTheme> & { plain: MailTheme } = {
  boardroom: {
    id: 'boardroom',
    label: 'Boardroom',
    blurb: 'Quiet and professional. Receipts, resets, meeting confirmations, exec notices.',
    pageBg: '#EDF0F4',
    cardBg: '#FFFFFF',
    bannerBg: NAVY,
    wordmark: '#FFFFFF',
    chipBg: GOLD,
    chipText: INK,
    strip: GOLD,
    accent: NAVY,
    link: '#1D4ED8',
    text: '#1F2937',
    muted: '#6B7280',
    buttonBg: NAVY,
    buttonText: '#FFFFFF',
    softBox: '#EEF1F5',
    radius: 10,
    band: false,
  },
  goldrush: {
    id: 'goldrush',
    label: 'Gold Rush',
    blurb: 'Warm and engaging, our mascot up front. Win-back, lifecycle, re-engagement.',
    pageBg: '#FBF3DC',
    cardBg: '#FFFDF7',
    bannerBg: INK,
    wordmark: '#FFFFFF',
    chipBg: GOLD,
    chipText: INK,
    strip: GOLD,
    accent: '#B8900A',
    link: '#A17E09',
    text: '#1F2937',
    muted: '#857B5E',
    buttonBg: GOLD,
    buttonText: INK,
    softBox: '#F8EFD4',
    radius: 14,
    hero: {
      src: '/email/mascot-wave.jpg',
      alt: 'The HustlePortal honey badger, waving with a laptop under his arm',
      bg: '#F8CD6E',
    },
    band: true,
  },
  nightshift: {
    id: 'nightshift',
    label: 'Nightshift',
    blurb: 'Bold and memorable, dark banner, night scene. Big campaign blasts and announcements.',
    pageBg: '#0B0E14',
    cardBg: '#FFFFFF',
    bannerBg: '#05070B',
    wordmark: '#FFFFFF',
    chipBg: GOLD,
    chipText: INK,
    strip: GOLD,
    accent: '#E8590C',
    link: '#C2410C',
    text: '#1F2937',
    muted: '#6B7280',
    buttonBg: GOLD,
    buttonText: INK,
    softBox: '#EEF1F5',
    radius: 14,
    hero: {
      src: '/email/mascot-night.jpg',
      alt: 'The HustlePortal honey badger reading good news on his phone at night',
      bg: '#202E4B',
    },
    band: true,
  },
  plain: {
    id: 'plain',
    label: 'Plain',
    blurb: 'The legacy unbranded look. Kept as an escape hatch.',
    pageBg: '#f6f7f9',
    cardBg: '#ffffff',
    bannerBg: '#ffffff',
    wordmark: '#1f2937',
    chipBg: '#f5c518',
    chipText: '#1f2937',
    strip: '#f5c518',
    accent: '#0b57d0',
    link: '#0b57d0',
    text: '#1f2937',
    muted: '#6b7280',
    buttonBg: '#0b57d0',
    buttonText: '#ffffff',
    softBox: '#f1f3f5',
    radius: 0,
    band: false,
  },
}

export interface ThemedMailOptions {
  theme?: MailThemeId
  /** Invisible 1x1 open tracker (campaign lane). Omitted for system mail. */
  pixelUrl?: string
  /** Caps accent line under the hero, PostHog "SECURITY REQUEST" style. */
  headline?: string
  /** Big bold headline under the eyebrow — PostHog "Are you who you say you are?" style. */
  title?: string
  /** The big highlighted value (a login code, a credit amount) in a soft rounded box. */
  value?: { text: string; caption?: string }
  /** Bulletproof CTA button between body and footer. */
  ctaLabel?: string
  ctaUrl?: string
  /** Hidden preview text in the inbox list, before the reader opens. */
  preheader?: string
  /** One-click unsubscribe link for bulk mail (footer). */
  unsubscribeUrl?: string
  /** Legal footer lines (from mailer.legalFooterLines). */
  footerLines?: string[]
  /** Base for brand images; tests and previews override it. */
  assetBase?: string
}

function banner(t: MailTheme, assetBase: string): string {
  if (t.id === 'plain') return '' // legacy look has no chrome
  const mark =
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td width="34" height="34" bgcolor="${t.chipBg}" style="width:34px;height:34px;background:${t.chipBg};border-radius:7px;text-align:center;vertical-align:middle;font-family:Georgia,'Times New Roman',serif;font-weight:bold;font-size:15px;color:${t.chipText}">BH</td>` +
    `<td style="padding-left:11px;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:${t.wordmark};letter-spacing:0.4px">HustlePortal</td>` +
    `</tr></table>`
  return (
    `<tr><td bgcolor="${t.bannerBg}" style="background:${t.bannerBg};padding:15px 26px" align="left">${mark}</td></tr>` +
    `<tr><td bgcolor="${t.strip}" style="background:${t.strip};font-size:0;line-height:0;height:4px">&nbsp;</td></tr>`
  )
}

function heroRow(t: MailTheme, assetBase: string): string {
  if (!t.hero) return ''
  const src = `${assetBase}${t.hero.src}`
  return (
    `<tr><td bgcolor="${t.hero.bg}" style="background:${t.hero.bg};padding:0">` +
    `<img src="${src}" width="600" alt="${t.hero.alt}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none" />` +
    `</td></tr>`
  )
}

function headlineRow(text: string | undefined, t: MailTheme): string {
  if (!text) return ''
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    `<tr><td align="center" style="padding:24px 30px 0 30px">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;letter-spacing:2.5px;color:${t.accent}">${esc}</div>` +
    `</td></tr>`
  )
}

function titleRow(text: string | undefined, t: MailTheme, hasEyebrow: boolean): string {
  if (!text) return ''
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    `<tr><td align="center" style="padding:${hasEyebrow ? '8px' : '26px'} 30px 0 30px">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;line-height:1.25;color:${t.text}">${esc}</div>` +
    `</td></tr>`
  )
}

function valueRow(value: ThemedMailOptions['value'], t: MailTheme): string {
  if (!value?.text) return ''
  const esc = value.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const spacing = value.text.length <= 6 ? 8 : 2
  const caption = value.caption
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${t.muted};padding-top:10px">${value.caption
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div>`
    : ''
  return (
    `<tr><td align="center" style="padding:20px 30px 4px 30px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td bgcolor="${t.softBox}" style="background:${t.softBox};border-radius:12px;padding:16px 34px;text-align:center">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;letter-spacing:${spacing}px;color:${t.text}">${esc}</div>` +
    caption +
    `</td></tr></table></td></tr>`
  )
}

function ctaRow(label: string | undefined, url: string | undefined, t: MailTheme): string {
  if (!label || !url) return ''
  const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    `<tr><td align="center" style="padding:22px 30px 6px 30px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td bgcolor="${t.buttonBg}" style="background:${t.buttonBg};border-radius:9px">` +
    `<a href="${url}" target="_blank" style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${t.buttonText};text-decoration:none;border-radius:9px">${esc}</a>` +
    `</td></tr></table></td></tr>`
  )
}

function bandRow(t: MailTheme, assetBase: string): string {
  if (!t.band) return ''
  return (
    `<tr><td style="padding:20px 0 0 0">` +
    `<img src="${assetBase}/brand/band.png" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0" />` +
    `</td></tr>`
  )
}

function footerRow(opts: ThemedMailOptions, t: MailTheme): string {
  const lines: string[] = []
  if (opts.unsubscribeUrl) {
    lines.push(
      `Prefer not to hear from us again? <a href="${opts.unsubscribeUrl}" style="color:${t.link}">One tap and you are out</a>.`,
    )
  }
  if (opts.footerLines?.length) lines.push(...opts.footerLines)
  if (lines.length === 0) return ''
  const body = lines
    .map((l) => l.replace(/(https?:\/\/[^\s<]+)/g, (_m, u: string) => `<a href="${u}" style="color:${t.link}">${u}</a>`))
    .join('<br>')
  return (
    `<tr><td style="padding:14px 30px 24px 30px">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:${t.muted};text-align:center">${body}</div>` +
    `</td></tr>`
  )
}

/**
 * The one renderer every branded send goes through. Body text in (the same
 * plain text with [phrase](url) links and "See it in motion:" lines the plain
 * look takes), fully branded html out.
 */
export function themedEmailHtml(text: string, opts: ThemedMailOptions = {}): string {
  const themeId = opts.theme ?? 'goldrush'
  const t = THEMES[themeId] ?? THEMES.goldrush
  const assetBase = (opts.assetBase ?? MAIL_ASSET_BASE).replace(/\/$/, '')

  if (t.id === 'plain') {
    // Legacy look, byte-compatible chrome: text plus tail, pixel at the end.
    const brd = renderTextBlocks(text)
    const pixel = opts.pixelUrl ? `<img src="${opts.pixelUrl}" width="1" height="1" alt="" style="display:none" />` : ''
    return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:640px;margin:0 auto;background:#ffffff;padding:28px;border:1px solid #e3e5e8">${brd}${pixel}</div></body></html>`
  }

  const blocks = renderTextBlocks(text, t.link)
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0">${opts.preheader
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div>`
    : ''
  const pixel = opts.pixelUrl
    ? `<div style="display:none"><img src="${opts.pixelUrl}" width="1" height="1" alt="" style="display:none" /></div>`
    : ''

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${t.pageBg}">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.pageBg};padding:26px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${t.cardBg};border-radius:${t.radius}px;overflow:hidden">
${banner(t, assetBase)}
${heroRow(t, assetBase)}
${headlineRow(opts.headline, t)}
${titleRow(opts.title, t, !!opts.headline)}
<tr><td style="padding:${opts.headline ? '18px' : opts.title ? '12px' : '28px'} 30px 6px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${t.text}">${blocks}</td></tr>
${valueRow(opts.value, t)}
${ctaRow(opts.ctaLabel, opts.ctaUrl, t)}
${bandRow(t, assetBase)}
${footerRow(opts, t)}
</table>
${pixel}
</td></tr></table>
</body></html>`
}
