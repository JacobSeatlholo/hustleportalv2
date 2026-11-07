/**
 * Campaign mail HTML rendering — pure functions, no db, no env, no side
 * effects, so they can be unit tested without standing anything up.
 *
 * campaignHtml renders a plain text body as clean readable mail (short lines,
 * clickable links, no images that can break) plus the invisible 1x1 open
 * tracker. Two link shapes are supported:
 *
 *   bare URLs          "have a look: https://example.com"  -> whole URL clickable
 *   phrase links       "put [HustlePortal](https://example.com) to work"
 *                                                          -> the phrase is the link
 *
 * Phrase links are stashed before escaping so the anchor survives, and the
 * plain text side flattens them ("HustlePortal (https://example.com)") so the
 * text version never shows raw markdown. The marker line "See it in motion:
 * <url>" renders as a big clickable video thumbnail instead of a text line,
 * email clients refuse inline <video>, so the poster opens the clip in the
 * browser. Reading clients that load images fire the pixel; plain-text only
 * readers do not, so open counts are a floor, never a ceiling.
 */

export const CAMPAIGN_VIDEO_POSTER = 'https://www.hustleportal.online/campaign/blackbiz-intro-video.jpg'

const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g

/** Plain text side of a markdown phrase link: "HustlePortal (https://...)" */
export function flattenMarkdownLinks(text: string): string {
  return text.replace(MD_LINK, (_m, t: string, u: string) => `${t} (${u})`)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function campaignHtml(text: string, pixelUrl: string): string {
  // Stash phrase links before escaping/linkify can mangle them.
  const links: { text: string; url: string }[] = []
  const stashed = text.replace(MD_LINK, (_m, t: string, u: string) => {
    links.push({ text: t, url: u })
    return `\u0000${links.length - 1}\u0000`
  })
  const blocks: string[] = []
  for (const line of stashed.split('\n')) {
    const video = line.match(/^See it in motion: (https:\/\/\S+)$/)
    if (video) {
      blocks.push(
        `<a href="${video[1]}" target="_blank" style="text-decoration:none">` +
        `<img src="${CAMPAIGN_VIDEO_POSTER}" width="640" alt="Watch: HustlePortal in motion. Tap to play." ` +
        `style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:10px;margin:18px 0" /></a>`,
      )
      continue
    }
    let esc = escapeHtml(line)
    esc = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0b57d0">$1</a>')
    esc = esc.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => {
      const l = links[Number(i)]
      if (!l) return ''
      return `<a href="${l.url}" style="color:#0b57d0">${escapeHtml(l.text)}</a>`
    })
    blocks.push(esc)
  }
  const brd = blocks.join('<br>\n')
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:640px;margin:0 auto;background:#ffffff;padding:28px;border:1px solid #e3e5e8">${brd}<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" /></div></body></html>`
}
